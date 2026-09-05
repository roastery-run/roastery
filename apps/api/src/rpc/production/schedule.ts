/**
 * Production scheduling: outstanding demand, and the roast day it becomes.
 *
 * Reads confirmed order lines (../orders/orders.ts) and produces a sequence a
 * roaster can run. It is under `production` rather than `orders` because the
 * audience is the roasting floor, not the sales desk.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import {
  blends,
  machines,
  productionSchedules,
  salesOrderLines,
  salesOrders,
  scheduledBatches,
} from "@roastery/db/schema";
import {
  generateScheduleInput,
  getScheduleInput,
  listDemandInput,
  listDemandOutput,
  productionScheduleSchema,
  releaseScheduleInput,
} from "@roastery/schemas";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { BadRequest, Conflict, NotFound } from "../../lib/api/errors";
import { type RpcAppEnv, type RpcContext, registerRpc } from "../../lib/api/rpc";
import { kg } from "../../lib/domain/inventory";
import {
  aggregateDemand,
  buildSchedule,
  type DemandItem,
  sequenceRank,
} from "../../lib/domain/scheduling";

export const productionSchedule = new OpenAPIHono<RpcAppEnv>();

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
    //
    // A float from here on, deliberately: buildSchedule is a planning
    // heuristic whose output is a suggestion about which batches to roast, not
    // a quantity anything is booked against. The exact figure is the ledger's,
    // and it is what the roast records when it actually happens.
    roastedKg: Number.parseFloat(kg.sub(r.weightKg, r.allocatedWeightKg)),
    dueAt: r.requestedShipAt ?? null,
    roastLevel: (r.roastLevel as "light" | "medium" | "dark" | null) ?? null,
    isDecaf: r.isDecaf ?? false,
  }));
}

registerRpc(
  productionSchedule,
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
  productionSchedule,
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
      available
        // A machine with no stated capacity used to default to 12 kg, which is
        // a plausible drum size and therefore an invisible wrong answer: the
        // schedule would look reasonable and quietly plan batches the machine
        // cannot hold. Left out of the plan instead, so the gap is visible.
        .filter((m) => m.capacityKg !== null)
        .map((m) => ({
          machineId: m.machineId,
          capacityKg: Number.parseFloat(m.capacityKg ?? "0"),
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
  productionSchedule,
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
  productionSchedule,
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

    await ctx.db.transaction(async (tx) => {
      await tx.update(
        productionSchedules,
        {
          status: "released",
          releasedAt: new Date(),
          releasedBy: ctx.actor.userId,
          updatedAt: new Date(),
        },
        eq(productionSchedules.id, input.id),
      );
      await tx.emit({
        type: "production.schedule.released",
        resourceType: "production_schedule",
        resourceId: input.id,
        payload: {
          id: input.id,
          name: schedule.name,
          scheduledDate: schedule.scheduledDate,
          feasibilityNotes: schedule.feasibilityNotes ?? [],
        },
      });
    });
    return loadSchedule(ctx, input.id);
  },
);
