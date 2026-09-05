import { allocations, roastedLots, salesOrderLines } from "@roastery/db/schema";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { BadRequest, NotFound } from "../api/errors";
import type { OrgDb } from "../db/org-db";
import { kg } from "./inventory";

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
 *
 * Both functions REQUIRE a transactional handle and take a row lock on every
 * lot they touch. Neither used to, and the claim above was consequently only
 * true when nothing ran concurrently: two allocations reading the same
 * `reserved_weight_kg` both wrote their own total, and the same kilogram went
 * to two customers with nothing in the data to show it. Unlike the balance,
 * a reservation has no ledger to reconcile against — the roasted lot's
 * counter is checked against open allocation rows by the reconciliation job,
 * which is what turns a lost update here from invisible into reported.
 *
 * The caller opens the transaction, because allocating an ORDER means
 * allocating every line of it: a failure on the third line has to undo the
 * first two rather than leave the order half committed.
 */

export type AllocationResult = {
  orderLineId: string;
  requestedKg: string;
  allocatedKg: string;
  shortfallKg: string;
  picks: { roastedLotId: string; lotCode: string; weightKg: string; bestBeforeAt: string | null }[];
};

export async function allocateOrderLine(
  /** Must be a transactional handle: see the note on locking above. */
  db: OrgDb,
  orderLineId: string,
  options: { strategy?: "fefo" | "fifo"; blendId?: string | null } = {},
): Promise<AllocationResult> {
  // Locked first and held for the whole allocation, so two calls against one
  // line serialise here rather than racing over `allocated_weight_kg`.
  const [line] = await db.query(async (t, scope) =>
    t
      .select()
      .from(salesOrderLines)
      .for("update")
      .where(and(scope(salesOrderLines), eq(salesOrderLines.id, orderLineId)))
      .limit(1),
  );
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
      )
      // Locked in the SAME order they are consumed. Deliberately not SKIP
      // LOCKED: the order is the feature, and skipping a lot another
      // transaction happens to hold would quietly allocate the wrong coffee —
      // fresher stock shipped ahead of the batch that expires first.
      .for("update"),
  );

  let remaining = outstanding;
  const picks: AllocationResult["picks"] = [];

  for (const lot of candidates) {
    if (kg.cmp(remaining, "0") <= 0) break;
    // Read after the lock was granted, so this is the settled figure rather
    // than what was free when the candidate list was built.
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

/**
 * Releases open allocations for a line and returns the stock to available.
 *
 * Requires a transactional handle for the same reason as allocation: the lot
 * counter, the allocation rows and the line's total have to move together or
 * the line ends up claiming stock no allocation row backs.
 */
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
    const [lot] = await db.query(async (t, scope) =>
      t
        .select()
        .from(roastedLots)
        .for("update")
        .where(and(scope(roastedLots), eq(roastedLots.id, a.roastedLotId)))
        .limit(1),
    );
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

  const [line] = await db.query(async (t, scope) =>
    t
      .select()
      .from(salesOrderLines)
      .for("update")
      .where(and(scope(salesOrderLines), eq(salesOrderLines.id, orderLineId)))
      .limit(1),
  );
  if (line) {
    await db.update(
      salesOrderLines,
      { allocatedWeightKg: kg.sub(line.allocatedWeightKg, released) },
      eq(salesOrderLines.id, orderLineId),
    );
  }
  return released;
}
