import {
  greenLots,
  inventoryTransactions,
  lotConsumption,
  lotLocationBalances,
} from "@roastery/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { BadRequest, NotFound } from "../api/errors";
import { isUniqueViolation } from "../db/db";
import type { OrgDb } from "../db/org-db";

/**
 * THE single write path for green inventory.
 *
 * Nothing else in the codebase may write `green_lots.current_weight_kg` or
 * insert an `inventory_transactions` row. That rule is what makes the balance
 * trustworthy, and it is enforced by review plus the reconciliation job — any
 * drift between SUM(delta_kg) and the cached balance means something bypassed
 * this function, which is exactly what we want to be told about.
 *
 * Concurrency is handled two ways, deliberately belt-and-braces:
 *
 *   1. `SELECT ... FOR UPDATE` on the lot row serializes concurrent writers,
 *      so each reads a balance nobody else is about to change.
 *   2. The per-lot `seq` unique index catches anything that reaches the insert
 *      without holding that lock — a code path we missed, or a future writer
 *      in another transaction. The loser gets a unique violation and retries
 *      against the fresh balance rather than silently overwriting it.
 *
 * The lock alone would be enough today. The index is what keeps it true after
 * someone adds a second writer in eighteen months.
 */

/** Exact decimal arithmetic on the string values Drizzle returns for numeric. */
const SCALE = 4;

function toUnits(value: string | number): bigint {
  const s = typeof value === "number" ? value.toString() : value;
  const neg = s.startsWith("-");
  const [whole = "0", frac = ""] = (neg ? s.slice(1) : s).split(".");
  const padded = (frac + "0".repeat(SCALE)).slice(0, SCALE);
  const units = BigInt(whole) * 10n ** BigInt(SCALE) + BigInt(padded || "0");
  return neg ? -units : units;
}

function fromUnits(units: bigint): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const divisor = 10n ** BigInt(SCALE);
  const whole = abs / divisor;
  const frac = (abs % divisor).toString().padStart(SCALE, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

export const kg = {
  add: (a: string, b: string) => fromUnits(toUnits(a) + toUnits(b)),
  sub: (a: string, b: string) => fromUnits(toUnits(a) - toUnits(b)),
  cmp: (a: string, b: string) => {
    const x = toUnits(a);
    const y = toUnits(b);
    return x < y ? -1 : x > y ? 1 : 0;
  },
  isNegative: (a: string) => toUnits(a) < 0n,
  normalize: (a: string | number) => fromUnits(toUnits(a)),
};

export type TransactionInput = {
  greenLotId: string;
  eventType: (typeof inventoryTransactions.$inferInsert)["eventType"];
  /** Signed. Negative removes weight. */
  deltaKg: string;
  locationId?: string | null;
  groupId?: string | null;
  counterpartyLotId?: string | null;
  roastBatchId?: string | null;
  /** The contract line this movement draws down, for traceability. */
  contractLineId?: string | null;
  comment?: string | null;
  occurredAt?: Date;
  /** Skip the non-negative check. Only a recount may legitimately go below. */
  allowNegative?: boolean;
};

export type AppliedTransaction = {
  id: string;
  seq: number;
  weightBeforeKg: string;
  deltaKg: string;
  weightAfterKg: string;
};

const MAX_RETRIES = 3;

/**
 * Applies one movement, atomically, updating the ledger and every cache that
 * follows from it.
 */
export async function applyInventoryTransaction(
  db: OrgDb,
  input: TransactionInput,
): Promise<AppliedTransaction> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async (tx) => applyOnce(tx, input));
    } catch (err) {
      // Lost the race on the per-lot sequence. Retry: the balance has moved,
      // so the correct new value is different from the one just computed.
      if (isUniqueViolation(err) && attempt < MAX_RETRIES) continue;
      throw err;
    }
  }
}

async function applyOnce(tx: OrgDb, input: TransactionInput): Promise<AppliedTransaction> {
  const delta = kg.normalize(input.deltaKg);

  const [lot] = await tx.query(async (t, scope) =>
    t
      .select({
        id: greenLots.id,
        currentWeightKg: greenLots.currentWeightKg,
        reservedWeightKg: greenLots.reservedWeightKg,
      })
      .from(greenLots)
      // Serializes concurrent writers on this lot. Without it two adjustments
      // read the same balance and the second silently discards the first.
      .for("update")
      .where(and(scope(greenLots), eq(greenLots.id, input.greenLotId)))
      .limit(1),
  );
  if (!lot) throw new NotFound("Lot not found");

  const before = kg.normalize(lot.currentWeightKg);
  const after = kg.add(before, delta);

  if (!input.allowNegative && kg.isNegative(after)) {
    throw new BadRequest(
      `Insufficient stock: lot holds ${before} kg, this movement needs ${kg.sub("0", delta)} kg.`,
    );
  }

  const [next] = await tx.query(async (t, scope) =>
    t
      .select({ seq: sql<number>`coalesce(max(${inventoryTransactions.seq}), 0) + 1` })
      .from(inventoryTransactions)
      .where(
        and(scope(inventoryTransactions), eq(inventoryTransactions.greenLotId, input.greenLotId)),
      ),
  );
  const seq = next?.seq ?? 1;

  const [row] = await tx.insert(inventoryTransactions, {
    greenLotId: input.greenLotId,
    seq,
    eventType: input.eventType,
    locationId: input.locationId ?? null,
    weightBeforeKg: before,
    deltaKg: delta,
    weightAfterKg: after,
    groupId: input.groupId ?? null,
    counterpartyLotId: input.counterpartyLotId ?? null,
    roastBatchId: input.roastBatchId ?? null,
    contractLineId: input.contractLineId ?? null,
    comment: input.comment ?? null,
    occurredAt: input.occurredAt ?? new Date(),
    createdBy: tx.actor.userId,
  });
  if (!row) throw new Error("Ledger insert returned no row");

  await tx.update(
    greenLots,
    {
      currentWeightKg: after,
      // A lot that reaches zero is depleted, not deleted: its history is still
      // referenced by every roast that consumed it.
      ...(kg.cmp(after, "0") === 0 ? { status: "depleted" as const } : {}),
      updatedAt: new Date(),
    },
    eq(greenLots.id, input.greenLotId),
  );

  if (input.locationId) {
    await adjustLocationBalance(tx, input.greenLotId, input.locationId, delta);
  }

  return {
    id: row.id,
    seq,
    weightBeforeKg: before,
    deltaKg: delta,
    weightAfterKg: after,
  };
}

/**
 * Keeps the per-location balance in step, in the same transaction.
 *
 * Upsert rather than read-then-write: the unique index on (lot, location) makes
 * the conflict path exact, and it saves a round trip on the common case.
 */
async function adjustLocationBalance(
  tx: OrgDb,
  greenLotId: string,
  locationId: string,
  deltaKg: string,
): Promise<void> {
  // unscoped-ok: orgId is set explicitly below, and the conflict target is the
  // (lot, location) unique index. The lot itself was already tenant-checked by
  // the FOR UPDATE select in applyOnce, which is what makes this reachable.
  await tx.query(async (t) =>
    t
      .insert(lotLocationBalances)
      .values({
        orgId: tx.orgId,
        greenLotId,
        locationId,
        weightKg: deltaKg,
      })
      .onConflictDoUpdate({
        target: [lotLocationBalances.greenLotId, lotLocationBalances.locationId],
        set: {
          weightKg: sql`${lotLocationBalances.weightKg} + ${deltaKg}`,
          updatedAt: new Date(),
        },
      }),
  );
}

/**
 * Moves weight between two locations as TWO ledger rows sharing a group id.
 *
 * One signed row would leave per-location balances non-additive: you could not
 * sum a location's rows to get its holding, which is the only reason the
 * ledger is worth keeping per location at all.
 */
export async function transferBetweenLocations(
  db: OrgDb,
  input: {
    greenLotId: string;
    fromLocationId: string;
    toLocationId: string;
    weightKg: string;
    comment?: string;
  },
): Promise<{ groupId: string }> {
  if (input.fromLocationId === input.toLocationId) {
    throw new BadRequest("Source and destination locations are the same");
  }
  const weight = kg.normalize(input.weightKg);
  if (kg.cmp(weight, "0") <= 0) throw new BadRequest("Transfer weight must be positive");

  const [held] = await db.query(async (t, scope) =>
    t
      .select({ weightKg: lotLocationBalances.weightKg })
      .from(lotLocationBalances)
      .where(
        and(
          scope(lotLocationBalances),
          eq(lotLocationBalances.greenLotId, input.greenLotId),
          eq(lotLocationBalances.locationId, input.fromLocationId),
        ),
      )
      .limit(1),
  );
  if (!held || kg.cmp(held.weightKg, weight) < 0) {
    throw new BadRequest(
      `The source location holds ${held?.weightKg ?? "0"} kg of this lot; cannot move ${weight} kg.`,
    );
  }

  const groupId = crypto.randomUUID();
  // The lot's total is unchanged, so the two rows net to zero. Only the
  // per-location balances move.
  await applyInventoryTransaction(db, {
    greenLotId: input.greenLotId,
    eventType: "transfer_out",
    deltaKg: kg.sub("0", weight),
    locationId: input.fromLocationId,
    groupId,
    comment: input.comment ?? null,
  });
  await applyInventoryTransaction(db, {
    greenLotId: input.greenLotId,
    eventType: "transfer_in",
    deltaKg: weight,
    locationId: input.toLocationId,
    groupId,
    comment: input.comment ?? null,
  });
  return { groupId };
}

/**
 * Records a transformation edge in the traceability graph.
 *
 * Kept beside the ledger write path on purpose: lineage that is recorded
 * somewhere else, later, is lineage that eventually disagrees with the ledger.
 */
export async function recordTransformation(
  db: OrgDb,
  edge: {
    sourceKind: (typeof lotConsumption.$inferInsert)["sourceKind"];
    sourceId: string;
    targetKind: (typeof lotConsumption.$inferInsert)["targetKind"];
    targetId: string;
    weightKg: string;
    ratioPct?: string | null;
    transactionId?: string | null;
  },
): Promise<void> {
  await db.insert(lotConsumption, {
    sourceKind: edge.sourceKind,
    sourceId: edge.sourceId,
    targetKind: edge.targetKind,
    targetId: edge.targetId,
    weightKg: kg.normalize(edge.weightKg),
    ratioPct: edge.ratioPct ?? null,
    transactionId: edge.transactionId ?? null,
  });
}

/**
 * Moves a lot's reservation counter under a row lock.
 *
 * A reservation is a claim, not a movement: reserving coffee commits it
 * without it leaving the warehouse, so it moves `reserved_weight_kg` and never
 * the balance or the ledger. That is right, and it is why this needs its own
 * guard — there is no ledger row to reconcile a reservation against, so a lost
 * update here is undetectable after the fact rather than merely wrong.
 *
 * It was a read-modify-write with no lock and no transaction. Two reserves
 * arriving together both read `reserved = 0`, both wrote `reserved = want`,
 * and the same kilogram was promised to two orders. The check and the write
 * have to see the same row, so the SELECT takes `FOR UPDATE` and the caller
 * supplies the transaction.
 *
 * `available` deliberately subtracts the reservation from the CURRENT balance
 * rather than the initial one: coffee already roasted is gone, and reserving
 * against it would promise weight that no longer exists.
 */
export async function adjustReservation(
  tx: OrgDb,
  greenLotId: string,
  deltaKg: string,
): Promise<{ reservedWeightKg: string }> {
  const delta = kg.normalize(deltaKg);

  const [lot] = await tx.query(async (t, scope) =>
    t
      .select({
        currentWeightKg: greenLots.currentWeightKg,
        reservedWeightKg: greenLots.reservedWeightKg,
      })
      .from(greenLots)
      .for("update")
      .where(and(scope(greenLots), eq(greenLots.id, greenLotId)))
      .limit(1),
  );
  if (!lot) throw new NotFound("Lot not found");

  const reserved = kg.normalize(lot.reservedWeightKg);
  const next = kg.add(reserved, delta);

  if (kg.isNegative(next)) {
    throw new BadRequest(
      `Only ${reserved} kg is reserved; cannot release ${kg.sub("0", delta)} kg.`,
    );
  }

  const available = kg.sub(lot.currentWeightKg, reserved);
  if (kg.cmp(delta, "0") > 0 && kg.cmp(available, delta) < 0) {
    throw new BadRequest(
      `Only ${available} kg is unreserved on this lot; cannot reserve ${delta} kg.`,
    );
  }

  await tx.update(
    greenLots,
    { reservedWeightKg: next, updatedAt: new Date() },
    eq(greenLots.id, greenLotId),
  );

  return { reservedWeightKg: next };
}

/**
 * The invariant, checked.
 *
 * Returns drift between the ledger and the cached balance. A non-zero result
 * means something wrote the balance without going through this module — which
 * is a bug to find, not a number to quietly fix.
 */
export async function ledgerDrift(
  db: OrgDb,
  greenLotId: string,
): Promise<{ expected: string; actual: string; drift: string }> {
  const [lot] = await db.query(async (t, scope) =>
    t
      .select({ currentWeightKg: greenLots.currentWeightKg })
      .from(greenLots)
      .where(and(scope(greenLots), eq(greenLots.id, greenLotId)))
      .limit(1),
  );
  if (!lot) throw new NotFound("Lot not found");

  const [sum] = await db.query(async (t, scope) =>
    t
      .select({ total: sql<string>`coalesce(sum(${inventoryTransactions.deltaKg}), 0)::text` })
      .from(inventoryTransactions)
      .where(and(scope(inventoryTransactions), eq(inventoryTransactions.greenLotId, greenLotId))),
  );

  const expected = kg.normalize(sum?.total ?? "0");
  const actual = kg.normalize(lot.currentWeightKg);
  return { expected, actual, drift: kg.sub(actual, expected) };
}
