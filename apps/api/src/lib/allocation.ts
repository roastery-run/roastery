import { allocations, roastedLots, salesOrderLines } from "@roastery/db/schema";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { BadRequest, NotFound } from "./errors";
import { kg } from "./inventory";
import type { OrgDb } from "./org-db";

/**
 * Committing roasted stock to an order line.
 *
 * FEFO — first expiry, first out — is the default, and the choice matters.
 * Roasted coffee has a usable window measured in weeks, so the lot that should
 * ship first is the one that goes stale first. FIFO would ship whatever was
 * roasted earliest, which stops being the same thing the moment two batches
 * are roasted on different days with different best-before dates.
 *
 * Allocation moves NO stock. It records a claim, so the same kilogram cannot
 * be promised to two customers; the weight leaves inventory at fulfilment.
 * Deducting at allocation would make the ledger claim a movement that has not
 * happened and the physical count stop matching the system.
 */

export type AllocationResult = {
  orderLineId: string;
  requestedKg: string;
  allocatedKg: string;
  shortfallKg: string;
  picks: { roastedLotId: string; lotCode: string; weightKg: string; bestBeforeAt: string | null }[];
};

export async function allocateOrderLine(
  db: OrgDb,
  orderLineId: string,
  options: { strategy?: "fefo" | "fifo"; blendId?: string | null } = {},
): Promise<AllocationResult> {
  const line = await db.findOne(salesOrderLines, eq(salesOrderLines.id, orderLineId));
  if (!line) throw new NotFound("Order line not found");

  const outstanding = kg.sub(line.weightKg, line.allocatedWeightKg);
  if (kg.cmp(outstanding, "0") <= 0) {
    throw new BadRequest("This line is already fully allocated");
  }

  const strategy = options.strategy ?? "fefo";
  const blendId = options.blendId ?? line.blendId;

  const candidates = await db.query(async (t, scope) =>
    t
      .select({
        id: roastedLots.id,
        lotCode: roastedLots.lotCode,
        currentWeightKg: roastedLots.currentWeightKg,
        reservedWeightKg: roastedLots.reservedWeightKg,
        bestBeforeAt: roastedLots.bestBeforeAt,
        roastedAt: roastedLots.roastedAt,
      })
      .from(roastedLots)
      .where(
        and(
          scope(roastedLots),
          eq(roastedLots.status, "available"),
          blendId ? eq(roastedLots.blendId, blendId) : sql`true`,
          sql`${roastedLots.currentWeightKg} > ${roastedLots.reservedWeightKg}`,
        ),
      )
      .orderBy(
        // FEFO puts the soonest expiry first. NULLS LAST so a lot with no
        // recorded best-before is used only after the dated ones — an unknown
        // date must not jump the queue ahead of coffee that is about to spoil.
        strategy === "fefo"
          ? sql`${roastedLots.bestBeforeAt} asc nulls last`
          : asc(roastedLots.roastedAt),
      ),
  );

  let remaining = outstanding;
  const picks: AllocationResult["picks"] = [];

  for (const lot of candidates) {
    if (kg.cmp(remaining, "0") <= 0) break;
    const free = kg.sub(lot.currentWeightKg, lot.reservedWeightKg);
    if (kg.cmp(free, "0") <= 0) continue;

    const take = kg.cmp(free, remaining) < 0 ? free : remaining;
    await db.insert(allocations, {
      orderLineId,
      roastedLotId: lot.id,
      weightKg: take,
      strategy,
    });
    // The reservation is what stops the same kilogram being promised twice.
    await db.update(
      roastedLots,
      { reservedWeightKg: kg.add(lot.reservedWeightKg, take), updatedAt: new Date() },
      eq(roastedLots.id, lot.id),
    );

    picks.push({
      roastedLotId: lot.id,
      lotCode: lot.lotCode,
      weightKg: take,
      bestBeforeAt: lot.bestBeforeAt?.toISOString() ?? null,
    });
    remaining = kg.sub(remaining, take);
  }

  const allocated = kg.sub(outstanding, remaining);
  await db.update(
    salesOrderLines,
    {
      allocatedWeightKg: kg.add(line.allocatedWeightKg, allocated),
    },
    eq(salesOrderLines.id, orderLineId),
  );

  return {
    orderLineId,
    requestedKg: outstanding,
    allocatedKg: allocated,
    // A partial allocation is reported, never silently treated as complete:
    // the gap is what production planning has to close.
    shortfallKg: remaining,
    picks,
  };
}

/** Releases open allocations for a line and returns the stock to available. */
export async function releaseOrderLine(db: OrgDb, orderLineId: string): Promise<string> {
  const open = await db.query(async (t, scope) =>
    t
      .select()
      .from(allocations)
      .where(
        and(
          scope(allocations),
          eq(allocations.orderLineId, orderLineId),
          isNull(allocations.releasedAt),
        ),
      ),
  );

  let released = "0";
  for (const a of open) {
    const lot = await db.findOne(roastedLots, eq(roastedLots.id, a.roastedLotId));
    if (lot) {
      await db.update(
        roastedLots,
        {
          reservedWeightKg: kg.sub(lot.reservedWeightKg, a.weightKg),
          updatedAt: new Date(),
        },
        eq(roastedLots.id, lot.id),
      );
    }
    await db.update(allocations, { releasedAt: new Date() }, eq(allocations.id, a.id));
    released = kg.add(released, a.weightKg);
  }

  const line = await db.findOne(salesOrderLines, eq(salesOrderLines.id, orderLineId));
  if (line) {
    await db.update(
      salesOrderLines,
      { allocatedWeightKg: kg.sub(line.allocatedWeightKg, released) },
      eq(salesOrderLines.id, orderLineId),
    );
  }
  return released;
}
