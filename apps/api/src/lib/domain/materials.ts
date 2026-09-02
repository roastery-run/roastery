import { materials, materialTransactions } from "@roastery/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { BadRequest, NotFound } from "../api/errors";
import { isUniqueViolation } from "../db/db";
import type { OrgDb } from "../db/org-db";
import { kg as dec } from "./inventory";

/**
 * The single write path for material stock.
 *
 * Same discipline as the green ledger, for the same reason: an append-only
 * record plus a cached balance, updated together, with a per-material sequence
 * as the concurrency guard. Materials are fungible where green lots are not,
 * but "how did we end up with 40 boxes" is just as much an audit question as
 * it is for coffee.
 *
 * The arithmetic helper is shared with the green ledger deliberately —
 * quantities are decimal for the same reason weights are, and two independent
 * implementations would be two things to keep exact.
 */

const MAX_RETRIES = 3;

export type MaterialMovement = {
  materialId: string;
  eventType: (typeof materialTransactions.$inferInsert)["eventType"];
  deltaQty: string;
  locationId?: string | null;
  comment?: string | null;
  allowNegative?: boolean;
};

export async function applyMaterialTransaction(
  db: OrgDb,
  input: MaterialMovement,
): Promise<{ id: string; seq: number; qtyAfter: string }> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async (tx) => applyOnce(tx, input));
    } catch (err) {
      if (isUniqueViolation(err) && attempt < MAX_RETRIES) continue;
      throw err;
    }
  }
}

async function applyOnce(tx: OrgDb, input: MaterialMovement) {
  const delta = dec.normalize(input.deltaQty);

  const [material] = await tx.query(async (t, scope) =>
    t
      .select({ id: materials.id, onHandQty: materials.onHandQty })
      .from(materials)
      .for("update")
      .where(and(scope(materials), eq(materials.id, input.materialId)))
      .limit(1),
  );
  if (!material) throw new NotFound("Material not found");

  const before = dec.normalize(material.onHandQty);
  const after = dec.add(before, delta);
  if (!input.allowNegative && dec.isNegative(after)) {
    throw new BadRequest(
      `Insufficient stock: ${before} on hand, this movement needs ${dec.sub("0", delta)}.`,
    );
  }

  const [next] = await tx.query(async (t, scope) =>
    t
      .select({ seq: sql<number>`coalesce(max(${materialTransactions.seq}), 0) + 1` })
      .from(materialTransactions)
      .where(
        and(scope(materialTransactions), eq(materialTransactions.materialId, input.materialId)),
      ),
  );
  const seq = next?.seq ?? 1;

  const [row] = await tx.insert(materialTransactions, {
    materialId: input.materialId,
    seq,
    eventType: input.eventType,
    locationId: input.locationId ?? null,
    qtyBefore: before,
    deltaQty: delta,
    qtyAfter: after,
    comment: input.comment ?? null,
    createdBy: tx.actor.userId,
  });
  if (!row) throw new Error("Ledger insert returned no row");

  await tx.update(
    materials,
    { onHandQty: after, updatedAt: new Date() },
    eq(materials.id, input.materialId),
  );
  return { id: row.id, seq, qtyAfter: after };
}

/**
 * How much of each material a production run needs.
 *
 * Scrap is applied per line, because it is a property of the material and the
 * process, not of the run: a label with 2% waste wastes 2% whether you make
 * ten or ten thousand.
 */
export function explodeRequirements(
  lines: { materialId: string; quantity: string; scrapPct: string }[],
  runs: number,
): { materialId: string; requiredQty: string }[] {
  return lines.map((line) => {
    const perRun = dec.normalize(line.quantity);
    const scrap = dec.normalize(line.scrapPct);
    // quantity × runs × (1 + scrap%)
    let total = "0";
    for (let i = 0; i < runs; i++) total = dec.add(total, perRun);
    const waste = percentOf(total, scrap);
    return { materialId: line.materialId, requiredQty: dec.add(total, waste) };
  });
}

/** value × pct/100, exact, rounded to the shared 4-decimal scale. */
function percentOf(value: string, pct: string): string {
  const units = BigInt(value.replace(".", "")) * BigInt(pct.replace(".", ""));
  // value has 4 decimals, pct has 4 decimals, /100 for the percentage.
  const scaled = units / (10n ** 4n * 100n);
  const asString = scaled.toString().padStart(5, "0");
  return dec.normalize(`${asString.slice(0, -4) || "0"}.${asString.slice(-4)}`);
}
