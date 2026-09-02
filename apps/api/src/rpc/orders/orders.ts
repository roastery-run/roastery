/**
 * Customers, sales orders, and the allocation of finished stock to them.
 *
 * Production scheduling lives in ../production/schedule.ts: turning an order
 * book into a roast day is a different job from taking the orders, and the two
 * are owned by different people in a roastery.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { customers, salesOrderLines, salesOrders } from "@roastery/db/schema";
import {
  allocateOrderInput,
  allocateOrderOutput,
  confirmOrderInput,
  createCustomerInput,
  createOrderInput,
  customerSchema,
  getOrderInput,
  listCustomersInput,
  listCustomersOutput,
  listOrdersInput,
  listOrdersOutput,
  releaseAllocationInput,
  salesOrderSchema,
} from "@roastery/schemas";
import { and, eq, ilike, type SQL, sql } from "drizzle-orm";
import { BadRequest, Conflict, NotFound } from "../../lib/api/errors";
import { type RpcAppEnv, registerRpc } from "../../lib/api/rpc";
import { isUniqueViolation } from "../../lib/db/db";
import { allocateOrderLine, releaseOrderLine } from "../../lib/domain/allocation";
import { kg } from "../../lib/domain/inventory";
import { lineDto, linesOf, orderDto } from "./shared";

export const orders = new OpenAPIHono<RpcAppEnv>();

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
          // Priced against whichever basis the line declares. Multiplying a
          // per-kilogram price by a quantity of 1 is how a 44 kg wholesale
          // line and a 4 kg one both came out at $18.50.
          const basis = l.priceUnit === "kg" ? l.weightKg : l.quantity;
          const lineTotal =
            l.unitPrice !== undefined
              ? (Number.parseFloat(l.unitPrice) * Number.parseFloat(basis)).toFixed(4)
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
            priceUnit: l.priceUnit,
            lineTotal,
          };
        }),
      );

      await tx.update(
        salesOrders,
        { subtotal: total, total, updatedAt: new Date() },
        eq(salesOrders.id, order.id),
      );
      await tx.emit({
        type: "orders.order.created",
        resourceType: "sales_order",
        resourceId: order.id,
        payload: {
          id: order.id,
          orderNumber: order.orderNumber,
          customerId: order.customerId,
          channel: order.channel,
          externalOrderId: order.externalOrderId ?? null,
          lineCount: input.lines.length,
          total,
        },
      });
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

    const updated = await ctx.db.transaction(async (tx) => {
      const [row] = await tx.update(
        salesOrders,
        { status: "confirmed", updatedAt: new Date() },
        eq(salesOrders.id, input.id),
      );
      if (!row) throw new NotFound("Order not found");
      await tx.emit({
        // The event production planning cares about: this is the moment the
        // order stops being a conversation and becomes demand.
        type: "orders.order.confirmed",
        resourceType: "sales_order",
        resourceId: row.id,
        payload: {
          id: row.id,
          orderNumber: row.orderNumber,
          customerId: row.customerId,
          requestedShipAt: row.requestedShipAt ?? null,
        },
      });
      return row;
    });
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

    const shortfall = results.reduce((sum, r) => sum + Number.parseFloat(r.shortfallKg), 0);
    await ctx.db.emit({
      type: "orders.order.allocated",
      resourceType: "sales_order",
      resourceId: order.id,
      payload: {
        id: order.id,
        orderNumber: order.orderNumber,
        strategy: input.strategy ?? "fefo",
        // The shortfall is part of the event, not something a receiver has to
        // infer by comparing numbers. A partial allocation that arrives
        // looking like a success is how a warehouse ships short.
        fullyAllocated: shortfall === 0,
        shortfallKg: shortfall.toFixed(4),
      },
    });
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
