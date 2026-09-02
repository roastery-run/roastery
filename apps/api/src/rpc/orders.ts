import { OpenAPIHono } from "@hono/zod-openapi";
import {
  blends,
  customers,
  machines,
  productionSchedules,
  salesOrderLines,
  salesOrders,
  scheduledBatches,
} from "@roastery/db/schema";
import {
  allocateOrderInput,
  allocateOrderOutput,
  confirmOrderInput,
  createCustomerInput,
  createOrderInput,
  customerSchema,
  generateScheduleInput,
  getOrderInput,
  getScheduleInput,
  listCustomersInput,
  listCustomersOutput,
  listDemandInput,
  listDemandOutput,
  listOrdersInput,
  listOrdersOutput,
  productionScheduleSchema,
  releaseAllocationInput,
  releaseScheduleInput,
  salesOrderSchema,
} from "@roastery/schemas";
import { and, asc, eq, ilike, lte, type SQL, sql } from "drizzle-orm";
import { allocateOrderLine, releaseOrderLine } from "../lib/allocation";
import { isUniqueViolation } from "../lib/db";
import { BadRequest, Conflict, NotFound } from "../lib/errors";
import { kg } from "../lib/inventory";
import { type RpcAppEnv, type RpcContext, registerRpc } from "../lib/rpc";
import { aggregateDemand, buildSchedule, type DemandItem, sequenceRank } from "../lib/scheduling";

export const orders = new OpenAPIHono<RpcAppEnv>();

/* -------------------------------------------------------------- customers */

registerRpc(
  orders,
  {
    namespace: "orders",
    operation: "listCustomers",
    summary: "List customers",
    input: listCustomersInput,
    output: listCustomersOutput,
    permission: "orders.read",
    module: "orders",
    cacheable: { maxAgeSeconds: 30 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    if (input.filter?.customerType)
      clauses.push(eq(customers.customerType, input.filter.customerType));
    if (input.filter?.q) clauses.push(ilike(customers.name, `%${input.filter.q}%`));
    const { items, page } = await ctx.db.find(customers, {
      where: clauses.length ? and(...clauses) : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return {
      items: items.map((c) => ({
        id: c.id,
        name: c.name,
        code: c.code,
        customerType: c.customerType,
        currency: c.currency,
        paymentTermsDays: c.paymentTermsDays ?? null,
        contactEmail: c.contactEmail ?? null,
        isActive: c.isActive,
        createdAt: c.createdAt.toISOString(),
      })),
      page,
    };
  },
);

registerRpc(
  orders,
  {
    namespace: "orders",
    operation: "createCustomer",
    summary: "Create a customer",
    input: createCustomerInput,
    output: customerSchema,
    permission: "orders.write",
    module: "orders",
  },
  async (input, ctx) => {
    try {
      const [c] = await ctx.db.insert(customers, { ...input });
      if (!c) throw new Error("Insert returned no row");
      return {
        id: c.id,
        name: c.name,
        code: c.code,
        customerType: c.customerType,
        currency: c.currency,
        paymentTermsDays: c.paymentTermsDays ?? null,
        contactEmail: c.contactEmail ?? null,
        isActive: c.isActive,
        createdAt: c.createdAt.toISOString(),
      };
    } catch (err) {
      if (isUniqueViolation(err)) throw new Conflict(`Customer "${input.code}" already exists`);
      throw err;
    }
  },
);

/* ----------------------------------------------------------------- orders */

function orderDto(o: typeof salesOrders.$inferSelect) {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    customerId: o.customerId,
    channel: o.channel,
    status: o.status,
    currency: o.currency,
    total: o.total,
    orderedAt: o.orderedAt.toISOString(),
    requestedShipAt: o.requestedShipAt ?? null,
  };
}

function lineDto(l: typeof salesOrderLines.$inferSelect) {
  return {
    id: l.id,
    position: l.position,
    productId: l.productId ?? null,
    blendId: l.blendId ?? null,
    description: l.description,
    quantity: l.quantity,
    weightKg: l.weightKg,
    allocatedWeightKg: l.allocatedWeightKg,
    outstandingWeightKg: kg.sub(l.weightKg, l.allocatedWeightKg),
    unitPrice: l.unitPrice ?? null,
  };
}

async function linesOf(ctx: RpcContext, orderId: string) {
  return ctx.db.query(async (t, scope) =>
    t
      .select()
      .from(salesOrderLines)
      .where(and(scope(salesOrderLines), eq(salesOrderLines.orderId, orderId)))
      .orderBy(asc(salesOrderLines.position)),
  );
}

registerRpc(
  orders,
  {
    namespace: "orders",
    operation: "listOrders",
    summary: "List sales orders",
    input: listOrdersInput,
    output: listOrdersOutput,
    permission: "orders.read",
    module: "orders",
    cacheable: { maxAgeSeconds: 15 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    if (input.filter?.status) clauses.push(eq(salesOrders.status, input.filter.status));
    if (input.filter?.customerId) clauses.push(eq(salesOrders.customerId, input.filter.customerId));
    if (input.filter?.openOnly) {
      clauses.push(sql`${salesOrders.status} not in ('fulfilled', 'canceled', 'paid')`);
    }
    const { items, page } = await ctx.db.find(salesOrders, {
      where: clauses.length ? and(...clauses) : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return { items: items.map(orderDto), page };
  },
);

registerRpc(
  orders,
  {
    namespace: "orders",
    operation: "getOrder",
    summary: "Get an order with its lines",
    input: getOrderInput,
    output: salesOrderSchema,
    permission: "orders.read",
    module: "orders",
    cacheable: { maxAgeSeconds: 15 },
  },
  async (input, ctx) => {
    const o = await ctx.db.findOne(salesOrders, eq(salesOrders.id, input.id));
    if (!o) throw new NotFound("Order not found");
    return { ...orderDto(o), lines: (await linesOf(ctx, o.id)).map(lineDto) };
  },
);

registerRpc(
  orders,
  {
    namespace: "orders",
    operation: "createOrder",
    summary: "Create a sales order",
    description:
      "An external order id makes re-importing the same webstore order a no-op rather " +
      "than a duplicate — the failure mode of every integration that polls.",
    input: createOrderInput,
    output: salesOrderSchema,
    permission: "orders.write",
    module: "orders",
  },
  async (input, ctx) => {
    const id = await ctx.db.transaction(async (tx) => {
      let order: typeof salesOrders.$inferSelect | undefined;
      try {
        [order] = await tx.insert(salesOrders, {
          orderNumber: input.orderNumber,
          customerId: input.customerId,
          channel: input.channel,
          externalOrderId: input.externalOrderId ?? null,
          currency: input.currency,
          requestedShipAt: input.requestedShipAt ?? null,
          status: "draft",
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new Conflict(`Order "${input.orderNumber}" already exists`);
        }
        throw err;
      }
      if (!order) throw new Error("Insert returned no row");

      let total = "0";
      await tx.insert(
        salesOrderLines,
        input.lines.map((l, i) => {
          const lineTotal =
            l.unitPrice !== undefined
              ? (Number.parseFloat(l.unitPrice) * Number.parseFloat(l.quantity)).toFixed(4)
              : null;
          if (lineTotal) total = kg.add(total, lineTotal);
          return {
            orderId: order.id,
            position: i,
            productId: l.productId ?? null,
            blendId: l.blendId ?? null,
            description: l.description,
            quantity: l.quantity,
            weightKg: l.weightKg,
            unitPrice: l.unitPrice ?? null,
            lineTotal,
          };
        }),
      );

      await tx.update(
        salesOrders,
        { subtotal: total, total, updatedAt: new Date() },
        eq(salesOrders.id, order.id),
      );
      return order.id;
    });

    const o = await ctx.db.findOne(salesOrders, eq(salesOrders.id, id));
    if (!o) throw new NotFound("Order not found");
    return { ...orderDto(o), lines: (await linesOf(ctx, id)).map(lineDto) };
  },
);

registerRpc(
  orders,
  {
    namespace: "orders",
    operation: "confirmOrder",
    summary: "Confirm an order so it becomes demand",
    description:
      "Only confirmed orders reach production planning. A draft is a conversation; " +
      "scheduling against one would roast coffee nobody has agreed to buy.",
    input: confirmOrderInput,
    output: salesOrderSchema,
    permission: "orders.write",
    module: "orders",
  },
  async (input, ctx) => {
    const o = await ctx.db.findOne(salesOrders, eq(salesOrders.id, input.id));
    if (!o) throw new NotFound("Order not found");
    if (o.status !== "draft") throw new Conflict(`This order is already ${o.status}`);

    const [updated] = await ctx.db.update(
      salesOrders,
      { status: "confirmed", updatedAt: new Date() },
      eq(salesOrders.id, input.id),
    );
    if (!updated) throw new NotFound("Order not found");
    return { ...orderDto(updated), lines: (await linesOf(ctx, input.id)).map(lineDto) };
  },
);

registerRpc(
  orders,
  {
    namespace: "orders",
    operation: "allocateOrder",
    summary: "Commit roasted stock to an order",
    description:
      "Allocates each line by first-expiry-first-out. Allocation moves no stock — it " +
      "records a claim so the same kilogram cannot be promised twice; the weight leaves " +
      "inventory at fulfilment. A partial allocation is reported as a shortfall rather " +
      "than treated as success.",
    input: allocateOrderInput,
    output: allocateOrderOutput,
    permission: "orders.write",
    module: "orders",
  },
  async (input, ctx) => {
    const order = await ctx.db.findOne(salesOrders, eq(salesOrders.id, input.id));
    if (!order) throw new NotFound("Order not found");
    if (order.status === "draft") {
      throw new BadRequest("Confirm this order before allocating stock to it");
    }

    const lines = await linesOf(ctx, order.id);
    const results = [];
    for (const line of lines) {
      if (kg.cmp(kg.sub(line.weightKg, line.allocatedWeightKg), "0") <= 0) continue;
      results.push(await allocateOrderLine(ctx.db, line.id, { strategy: input.strategy }));
    }
    return { orderId: order.id, lines: results };
  },
);

registerRpc(
  orders,
  {
    namespace: "orders",
    operation: "releaseOrderAllocation",
    summary: "Return allocated stock to available",
    input: releaseAllocationInput,
    output: allocateOrderOutput.shape.lines.element.pick({ orderLineId: true, allocatedKg: true }),
    permission: "orders.write",
    module: "orders",
  },
  async (input, ctx) => {
    const released = await releaseOrderLine(ctx.db, input.orderLineId);
    return { orderLineId: input.orderLineId, allocatedKg: released };
  },
);

/* ------------------------------------------------------------ scheduling */

async function collectDemand(ctx: RpcContext, dueBefore?: string): Promise<DemandItem[]> {
  const rows = await ctx.db.query(async (t, scope) =>
    t
      .select({
        lineId: salesOrderLines.id,
        blendId: salesOrderLines.blendId,
        description: salesOrderLines.description,
        weightKg: salesOrderLines.weightKg,
        allocatedWeightKg: salesOrderLines.allocatedWeightKg,
        requestedShipAt: salesOrders.requestedShipAt,
        blendName: blends.name,
        roastLevel: blends.roastLevel,
        isDecaf: blends.isDecaf,
      })
      .from(salesOrderLines)
      .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId))
      .leftJoin(blends, eq(blends.id, salesOrderLines.blendId))
      .where(
        and(
          scope(salesOrderLines),
          // Only CONFIRMED demand. Planning against drafts would roast coffee
          // nobody has agreed to buy.
          sql`${salesOrders.status} in ('confirmed', 'in_production', 'partially_fulfilled')`,
          sql`${salesOrderLines.weightKg} > ${salesOrderLines.allocatedWeightKg}`,
          dueBefore ? lte(salesOrders.requestedShipAt, dueBefore) : sql`true`,
        ),
      ),
  );

  return rows.map((r) => ({
    orderLineId: r.lineId,
    blendId: r.blendId,
    // Without a blend there is no profile to group by, so each such line
    // stands alone rather than being merged with unrelated coffee.
    profileId: r.blendId,
    label: r.blendName ?? r.description,
    // Only the UNALLOCATED remainder is demand; the rest is already covered
    // by stock on the shelf.
    roastedKg: Number.parseFloat(kg.sub(r.weightKg, r.allocatedWeightKg)),
    dueAt: r.requestedShipAt ?? null,
    roastLevel: (r.roastLevel as "light" | "medium" | "dark" | null) ?? null,
    isDecaf: r.isDecaf ?? false,
  }));
}

registerRpc(
  orders,
  {
    namespace: "production.schedule",
    operation: "listDemandAggregate",
    summary: "What production still has to cover",
    description:
      "Confirmed order lines, less what is already allocated from stock, merged by what " +
      "would be roasted together. Twelve customers ordering the house blend is one " +
      "requirement, not twelve.",
    input: listDemandInput,
    output: listDemandOutput,
    permission: "production.schedule.read",
    module: "roasting",
    cacheable: { maxAgeSeconds: 15 },
  },
  async (input, ctx) => {
    const demand = await collectDemand(ctx, input.dueBefore);
    // The SAME merge the scheduler runs. A preview that groups demand
    // differently from the plan it previews is worse than showing nothing.
    const merged = aggregateDemand(demand);

    let total = "0";
    const items = merged
      .slice()
      .sort((a, b) => sequenceRank(a) - sequenceRank(b))
      .map((m) => {
        const roasted = m.roastedKg.toFixed(4);
        total = kg.add(total, roasted);
        return {
          blendId: m.blendId,
          profileId: m.profileId,
          label: m.label,
          roastedKg: roasted,
          dueAt: m.dueAt,
          orderLineCount: m.lineIds.length,
        };
      });

    return { items, totalRoastedKg: total };
  },
);

registerRpc(
  orders,
  {
    namespace: "production.schedule",
    operation: "generateProductionSchedule",
    summary: "Turn demand into a roast sequence",
    description:
      "Merges demand, sizes it into batches the drum can run, and orders the day: " +
      "grouped by profile to avoid changeovers, light before dark because a dark roast " +
      "leaves residue, and decaf last. Produced as a DRAFT — a human releases it.",
    input: generateScheduleInput,
    output: productionScheduleSchema,
    permission: "production.schedule.write",
    module: "roasting",
  },
  async (input, ctx) => {
    const demand = await collectDemand(ctx, input.dueBefore);
    if (!demand.length) throw new BadRequest("There is no outstanding demand to schedule");

    const available = await ctx.db.query(async (t, scope) =>
      t
        .select({
          machineId: machines.id,
          capacityKg: machines.capacityKg,
          minBatchKg: machines.minBatchKg,
          maxBatchKg: machines.maxBatchKg,
        })
        .from(machines)
        .where(
          and(
            scope(machines),
            eq(machines.isActive, true),
            input.locationId ? eq(machines.locationId, input.locationId) : sql`true`,
          ),
        )
        .orderBy(asc(machines.code)),
    );

    const plan = buildSchedule(
      demand,
      available.map((m) => ({
        machineId: m.machineId,
        capacityKg: Number.parseFloat(m.capacityKg ?? "12"),
        minBatchKg: m.minBatchKg ? Number.parseFloat(m.minBatchKg) : null,
        maxBatchKg: m.maxBatchKg ? Number.parseFloat(m.maxBatchKg) : null,
        maxBatches: input.maxBatchesPerMachine,
      })),
    );

    const scheduleId = await ctx.db.transaction(async (tx) => {
      const [schedule] = await tx.insert(productionSchedules, {
        name: input.name,
        scheduledDate: input.scheduledDate,
        locationId: input.locationId ?? null,
        status: "draft",
        // Shortfalls travel WITH the plan rather than being logged elsewhere:
        // a schedule that silently covers less than was ordered is the worst
        // possible output.
        feasibilityNotes: plan.unscheduled.map(
          (u) => `${u.label}: ${u.roastedKg} kg unplanned — ${u.reason}`,
        ),
      });
      if (!schedule) throw new Error("Insert returned no row");

      if (plan.batches.length) {
        await tx.insert(
          scheduledBatches,
          plan.batches.map((b) => ({
            scheduleId: schedule.id,
            machineId: b.machineId,
            profileId: null,
            blendId: b.blendId,
            position: b.position,
            plannedChargeKg: b.plannedChargeKg.toFixed(4),
            plannedYieldKg: b.plannedYieldKg.toFixed(4),
            demandLineIds: b.demandLineIds,
          })),
        );
      }
      return schedule.id;
    });

    return loadSchedule(ctx, scheduleId);
  },
);

async function loadSchedule(ctx: RpcContext, id: string) {
  const schedule = await ctx.db.findOne(productionSchedules, eq(productionSchedules.id, id));
  if (!schedule) throw new NotFound("Schedule not found");
  const batches = await ctx.db.query(async (t, scope) =>
    t
      .select()
      .from(scheduledBatches)
      .where(and(scope(scheduledBatches), eq(scheduledBatches.scheduleId, id)))
      .orderBy(asc(scheduledBatches.position)),
  );
  return {
    id: schedule.id,
    name: schedule.name,
    scheduledDate: schedule.scheduledDate,
    status: schedule.status,
    feasibilityNotes: schedule.feasibilityNotes ?? [],
    batches: batches.map((b) => ({
      id: b.id,
      machineId: b.machineId ?? null,
      profileId: b.profileId ?? null,
      blendId: b.blendId ?? null,
      position: b.position,
      plannedChargeKg: b.plannedChargeKg,
      plannedYieldKg: b.plannedYieldKg ?? null,
      demandLineIds: b.demandLineIds ?? [],
      roastBatchId: b.roastBatchId ?? null,
    })),
    createdAt: schedule.createdAt.toISOString(),
  };
}

registerRpc(
  orders,
  {
    namespace: "production.schedule",
    operation: "getProductionSchedule",
    summary: "Get a schedule and its batches",
    input: getScheduleInput,
    output: productionScheduleSchema,
    permission: "production.schedule.read",
    module: "roasting",
    cacheable: { maxAgeSeconds: 15 },
  },
  async (input, ctx) => loadSchedule(ctx, input.id),
);

registerRpc(
  orders,
  {
    namespace: "production.schedule",
    operation: "releaseScheduleToProduction",
    summary: "Release a schedule to the roasting floor",
    description:
      "A deliberate human step. Generation produces a draft precisely so somebody looks " +
      "at the feasibility notes before a day's work is committed to it.",
    input: releaseScheduleInput,
    output: productionScheduleSchema,
    permission: "production.schedule.approve",
    module: "roasting",
  },
  async (input, ctx) => {
    const schedule = await ctx.db.findOne(
      productionSchedules,
      eq(productionSchedules.id, input.id),
    );
    if (!schedule) throw new NotFound("Schedule not found");
    if (schedule.status !== "draft")
      throw new Conflict(`This schedule is already ${schedule.status}`);

    await ctx.db.update(
      productionSchedules,
      {
        status: "released",
        releasedAt: new Date(),
        releasedBy: ctx.actor.userId,
        updatedAt: new Date(),
      },
      eq(productionSchedules.id, input.id),
    );
    return loadSchedule(ctx, input.id);
  },
);
