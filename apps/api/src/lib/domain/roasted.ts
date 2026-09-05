import {
  blendComponents,
  blends,
  greenLots,
  roastedLots,
  roastedLotTransactions,
} from "@roastery/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { BadRequest, NotFound } from "../api/errors";
import { isUniqueViolation } from "../db/db";
import type { OrgDb } from "../db/org-db";
import { kg } from "./inventory";

/**
 * The single write path for roasted inventory.
 *
 * Deliberately a mirror of lib/inventory.ts rather than a shared generic: the
 * two ledgers move different things, and the one place a shared abstraction
 * would have to differ — what a balance means, and which statuses are
 * reachable — is exactly where a bug would be invisible. The DISCIPLINE is
 * shared; the code is not, and the exact-decimal helper is.
 */

const MAX_RETRIES = 3;

export type RoastedMovement = {
  roastedLotId: string;
  eventType: (typeof roastedLotTransactions.$inferInsert)["eventType"];
  deltaKg: string;
  locationId?: string | null;
  groupId?: string | null;
  orderLineId?: string | null;
  comment?: string | null;
  allowNegative?: boolean;
};

export async function applyRoastedTransaction(
  db: OrgDb,
  input: RoastedMovement,
): Promise<{ id: string; seq: number; weightAfterKg: string }> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async (tx) => applyOnce(tx, input));
    } catch (err) {
      // Lost the race on the per-lot sequence: the balance has moved, so the
      // correct new value differs from the one just computed.
      if (isUniqueViolation(err) && attempt < MAX_RETRIES) continue;
      throw err;
    }
  }
}

async function applyOnce(tx: OrgDb, input: RoastedMovement) {
  const delta = kg.normalize(input.deltaKg);

  const [lot] = await tx.query(async (t, scope) =>
    t
      .select({ id: roastedLots.id, currentWeightKg: roastedLots.currentWeightKg })
      .from(roastedLots)
      // Serializes concurrent writers on this lot.
      .for("update")
      .where(and(scope(roastedLots), eq(roastedLots.id, input.roastedLotId)))
      .limit(1),
  );
  if (!lot) throw new NotFound("Roasted lot not found");

  const before = kg.normalize(lot.currentWeightKg);
  const after = kg.add(before, delta);
  if (!input.allowNegative && kg.isNegative(after)) {
    throw new BadRequest(
      `Insufficient roasted stock: lot holds ${before} kg, this movement needs ${kg.sub("0", delta)} kg.`,
    );
  }

  const [next] = await tx.query(async (t, scope) =>
    t
      .select({ seq: sql<number>`coalesce(max(${roastedLotTransactions.seq}), 0) + 1` })
      .from(roastedLotTransactions)
      .where(
        and(
          scope(roastedLotTransactions),
          eq(roastedLotTransactions.roastedLotId, input.roastedLotId),
        ),
      ),
  );
  const seq = next?.seq ?? 1;

  const [row] = await tx.insert(roastedLotTransactions, {
    roastedLotId: input.roastedLotId,
    seq,
    eventType: input.eventType,
    locationId: input.locationId ?? null,
    weightBeforeKg: before,
    deltaKg: delta,
    weightAfterKg: after,
    groupId: input.groupId ?? null,
    orderLineId: input.orderLineId ?? null,
    comment: input.comment ?? null,
    createdBy: tx.actor.userId,
  });
  if (!row) throw new Error("Ledger insert returned no row");

  await tx.update(
    roastedLots,
    {
      currentWeightKg: after,
      ...(kg.cmp(after, "0") === 0 ? { status: "depleted" as const } : {}),
      updatedAt: new Date(),
    },
    eq(roastedLots.id, input.roastedLotId),
  );

  return { id: row.id, seq, weightAfterKg: after };
}

/**
 * How much green a blend needs, and whether it is actually there.
 *
 * Answered per component rather than as a single yes/no, because "you are
 * short" is not actionable — "you are 12.4 kg short of the Ethiopian" is. This
 * runs BEFORE production rather than discovering the shortfall with the drum
 * already hot.
 */
export type BlendAvailability = {
  blendId: string;
  requestedKg: string;
  /** Green needed, grossed up for the expected roast loss. */
  greenRequiredKg: string;
  feasible: boolean;
  components: {
    componentId: string;
    greenLotId: string | null;
    lotName: string;
    targetRatioPct: string;
    requiredKg: string;
    availableKg: string;
    shortfallKg: string;
  }[];
};

export async function validateBlendAvailability(
  db: OrgDb,
  blendId: string,
  requestedKg: string,
): Promise<BlendAvailability> {
  const blend = await db.findOne(blends, eq(blends.id, blendId));
  if (!blend) throw new NotFound("Blend not found");

  const rows = await db.query(async (t, scope) =>
    t
      .select({
        componentId: blendComponents.id,
        greenLotId: blendComponents.greenLotId,
        targetRatioPct: blendComponents.targetRatioPct,
        position: blendComponents.position,
        lotName: greenLots.name,
        currentWeightKg: greenLots.currentWeightKg,
        reservedWeightKg: greenLots.reservedWeightKg,
      })
      .from(blendComponents)
      .leftJoin(greenLots, eq(greenLots.id, blendComponents.greenLotId))
      .where(and(scope(blendComponents), eq(blendComponents.blendId, blendId)))
      .orderBy(asc(blendComponents.position)),
  );
  if (!rows.length) throw new BadRequest("This blend has no components");

  const totalRatio = rows.reduce((acc, r) => kg.add(acc, r.targetRatioPct), "0");
  if (kg.cmp(totalRatio, "100") !== 0) {
    throw new BadRequest(`Blend ratios total ${totalRatio}%, not 100%`);
  }

  // Producing N kg of ROASTED blend needs more than N kg of green, because
  // roasting drives off moisture. Sizing against the roasted target without
  // grossing up is how a production run comes up short every time.
  const requested = kg.normalize(requestedKg);
  const lossPct = blend.targetWeightLossPct ?? "0";
  const greenRequired = grossUpForLoss(requested, lossPct);

  const components = rows.map((r) => {
    const required = percentOf(greenRequired, r.targetRatioPct);
    // Reserved stock is committed elsewhere; counting it as available is how a
    // blend is approved against coffee already promised to an order.
    const available = r.currentWeightKg
      ? kg.sub(r.currentWeightKg, r.reservedWeightKg ?? "0")
      : "0";
    const shortfall = kg.sub(required, available);
    return {
      componentId: r.componentId,
      greenLotId: r.greenLotId,
      lotName: r.lotName ?? "(missing lot)",
      targetRatioPct: r.targetRatioPct,
      requiredKg: required,
      availableKg: available,
      shortfallKg: kg.isNegative(shortfall) ? "0.0000" : shortfall,
    };
  });

  return {
    blendId,
    requestedKg: requested,
    greenRequiredKg: greenRequired,
    feasible: components.every((c) => kg.cmp(c.shortfallKg, "0") === 0),
    components,
  };
}

/**
 * roasted / (1 - loss%) — the green needed to yield a roasted target.
 *
 * Exact, because the answer becomes a `roast_consume` ledger row: this decides
 * how much green a roast is recorded as having eaten, and a float here puts
 * its rounding error permanently into the balance.
 */
export function grossUpForLoss(roastedKg: string, lossPct: string): string {
  const loss = kg.normalize(lossPct);
  if (kg.cmp(loss, "0") <= 0 || kg.cmp(loss, "100") >= 0) return kg.normalize(roastedKg);
  // roasted x 100 / (100 - loss), in one rounding rather than three.
  return kg.mulDiv(roastedKg, "100", kg.sub("100", loss));
}

/** value x pct/100, at the shared 4-decimal scale. */
export function percentOf(value: string, pct: string): string {
  return kg.mulDiv(value, pct, "100");
}
