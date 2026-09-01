import { costComponents, greenLots, landedCosts } from "@roastery/db/schema";
import { and, eq } from "drizzle-orm";
import { NotFound } from "./errors";
import { kg } from "./inventory";
import type { OrgDb } from "./org-db";

/**
 * Landed cost: what a lot of green coffee actually cost by the time it reached
 * the warehouse.
 *
 * Held as components rather than a single number because the question a
 * roaster asks is not "what did this cost" but "WHY is this expensive" — and
 * the answer is the differential, or the freight, or three months of carry.
 * A single number cannot answer it, and recomputing from components means a
 * corrected freight invoice flows through to every affected lot rather than
 * leaving a stale total nobody trusts.
 *
 * `perKgBase` is what actually gets compared between lots, so it is stored
 * rather than derived at read time: it appears in list views beside dozens of
 * other lots, and dividing per row is the same O(n) problem the balance cache
 * exists to avoid.
 */

/** Money keeps 4 decimals; unit costs keep 6, since differentials quote finer. */
const MONEY_SCALE = 4;
const UNIT_SCALE = 6;

function toUnits(value: string, scale: number): bigint {
  const neg = value.startsWith("-");
  const [whole = "0", frac = ""] = (neg ? value.slice(1) : value).split(".");
  const padded = (frac + "0".repeat(scale)).slice(0, scale);
  const units = BigInt(whole) * 10n ** BigInt(scale) + BigInt(padded || "0");
  return neg ? -units : units;
}

function fromUnits(units: bigint, scale: number): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const divisor = 10n ** BigInt(scale);
  return `${neg ? "-" : ""}${abs / divisor}.${(abs % divisor).toString().padStart(scale, "0")}`;
}

const money = {
  add: (a: string, b: string) =>
    fromUnits(toUnits(a, MONEY_SCALE) + toUnits(b, MONEY_SCALE), MONEY_SCALE),
  zero: "0.0000",
};

/**
 * Which bucket each component rolls into.
 *
 * Deliberately coarse: a roaster reasons in "price, freight, duty, carry,
 * everything else", not in sixteen categories. The full detail stays on the
 * component rows for anyone who wants it.
 */
const BUCKET: Record<string, "base" | "freight" | "duty" | "carry" | "other"> = {
  base_price: "base",
  differential: "base",
  futures: "base",
  fx_adjustment: "base",
  freight: "freight",
  insurance: "freight",
  handling: "freight",
  duty: "duty",
  customs: "duty",
  carry: "carry",
  storage: "carry",
  financing: "carry",
  broker_fee: "other",
  sampling: "other",
  certification: "other",
  other: "other",
};

export type LandedCostResult = {
  greenLotId: string;
  basePriceBase: string;
  freightBase: string;
  dutyBase: string;
  carryBase: string;
  otherBase: string;
  totalBase: string;
  perKgBase: string;
};

/**
 * Recomputes a lot's landed cost from its components and stores the rollup.
 *
 * Idempotent: it derives everything from the component rows, so running it
 * twice produces the same answer, and running it after any change produces the
 * right one. That is what lets it be safely re-run from a queue after a
 * freight correction without tracking what changed.
 */
export async function recomputeLandedCost(
  db: OrgDb,
  greenLotId: string,
): Promise<LandedCostResult> {
  const lot = await db.findOne(greenLots, eq(greenLots.id, greenLotId));
  if (!lot) throw new NotFound("Lot not found");

  const components = await db.query(async (t, scope) =>
    t
      .select({
        kind: costComponents.kind,
        amountBase: costComponents.amountBase,
        perUnit: costComponents.perUnit,
      })
      .from(costComponents)
      .where(and(scope(costComponents), eq(costComponents.greenLotId, greenLotId))),
  );

  const totals = {
    base: money.zero,
    freight: money.zero,
    duty: money.zero,
    carry: money.zero,
    other: money.zero,
  };

  // Costing uses the lot's INITIAL weight, not its current one. A charge was
  // incurred on the whole shipment; dividing it by whatever is left after
  // months of roasting would make the per-kg cost climb as the lot depletes,
  // which is not a real cost movement.
  const weight = kg.normalize(lot.initialWeightKg);
  const hasWeight = kg.cmp(weight, "0") > 0;

  for (const c of components) {
    const bucket = BUCKET[c.kind] ?? "other";
    // A per-unit amount is a rate; multiply it back up to a lot total so the
    // rollup is comparable across flat and per-unit charges.
    const amount = c.perUnit && hasWeight ? multiply(c.amountBase, weight) : c.amountBase;
    totals[bucket] = money.add(totals[bucket], amount);
  }

  const totalBase = [totals.base, totals.freight, totals.duty, totals.carry, totals.other].reduce(
    money.add,
    money.zero,
  );
  const perKgBase = hasWeight ? divide(totalBase, weight) : "0.000000";

  const result: LandedCostResult = {
    greenLotId,
    basePriceBase: totals.base,
    freightBase: totals.freight,
    dutyBase: totals.duty,
    carryBase: totals.carry,
    otherBase: totals.other,
    totalBase,
    perKgBase,
  };

  // unscoped-ok: orgId is set explicitly below and the conflict target is the
  // (orgId, greenLotId) unique index. The lot was tenant-checked by the
  // findOne above, which is what makes this reachable at all.
  await db.query(async (t) =>
    t
      .insert(landedCosts)
      .values({ orgId: db.orgId, ...result, computedAt: new Date() })
      .onConflictDoUpdate({
        target: [landedCosts.orgId, landedCosts.greenLotId],
        set: { ...result, computedAt: new Date() },
      }),
  );

  return result;
}

/** amount × weight, both exact decimals, result at money scale. */
function multiply(amount: string, weightKg: string): string {
  const product = toUnits(amount, MONEY_SCALE) * toUnits(weightKg, 4);
  // Two scaled integers multiply to a value scaled by the sum of the scales.
  return fromUnits(product / 10n ** 4n, MONEY_SCALE);
}

/** total ÷ weight at unit scale, rounded half-up on the last digit. */
function divide(totalBase: string, weightKg: string): string {
  const numerator = toUnits(totalBase, MONEY_SCALE) * 10n ** BigInt(UNIT_SCALE - MONEY_SCALE + 4);
  const denominator = toUnits(weightKg, 4);
  if (denominator === 0n) return "0.000000";
  const quotient = numerator / denominator;
  const remainder = (numerator % denominator) * 2n;
  const rounded = remainder >= denominator ? quotient + 1n : quotient;
  return fromUnits(rounded, UNIT_SCALE);
}

export const costMath = { multiply, divide, add: money.add };
