/**
 * Weight, and the units a roastery actually speaks.
 *
 * Canonical storage is kilograms at four decimal places. Display is whatever
 * the person is holding: a green buyer thinks in bags, a barista in grams, a
 * US wholesale customer in pounds.
 */
import { type Decimal, divide, multiply, round } from "./decimal";

export type WeightUnit = "kg" | "g" | "lb" | "oz" | "bag" | "mt";

/**
 * Kilograms per unit — except `bag`, which is deliberately absent.
 *
 * A bag is NOT a mass unit. A Colombian bag is 70 kg, a Brazilian 60, an
 * Ethiopian 60, and a modern Kenyan 50. The factor belongs to the LOT, which
 * is why `bagWeightKg` is a column on `green_lots` and why converting bags
 * without one is an error rather than a guess.
 */
const KG_PER_UNIT: Record<Exclude<WeightUnit, "bag">, Decimal> = {
  kg: "1",
  g: "0.001",
  lb: "0.45359237",
  oz: "0.028349523125",
  mt: "1000",
};

export const WEIGHT_UNIT_LABEL: Record<WeightUnit, string> = {
  kg: "kg",
  g: "g",
  lb: "lb",
  oz: "oz",
  bag: "bags",
  mt: "t",
};

export type BagContext = { bagWeightKg: Decimal | null };

/** Converts to canonical kilograms. Null when bags are used with no bag weight. */
export function toKg(
  value: Decimal,
  unit: WeightUnit,
  context: BagContext = { bagWeightKg: null },
): Decimal | null {
  if (unit === "bag") {
    if (!context.bagWeightKg) return null;
    return round(multiply(value, context.bagWeightKg, 8), 4);
  }
  return round(multiply(value, KG_PER_UNIT[unit], 8), 4);
}

export function fromKg(
  kg: Decimal,
  unit: WeightUnit,
  context: BagContext = { bagWeightKg: null },
): Decimal | null {
  if (unit === "bag") {
    if (!context.bagWeightKg) return null;
    const bags = divide(kg, context.bagWeightKg, 6);
    return bags === null ? null : round(bags, 2);
  }
  const converted = divide(kg, KG_PER_UNIT[unit], 8);
  // Grams get two decimals because that is what a bar scale reads; everything
  // else gets four, matching the canonical precision.
  return converted === null ? null : round(converted, unit === "g" ? 2 : 4);
}

/**
 * Picks the unit a number reads best in.
 *
 * 0.0185 kg is a dose and should say 18.5 g; 4,200 kg is a container and should
 * say 4.2 t. Only ever for DISPLAY — the stored value never changes.
 */
export function naturalWeightUnit(kg: Decimal): WeightUnit {
  const magnitude = Math.abs(Number.parseFloat(kg));
  if (magnitude > 0 && magnitude < 1) return "g";
  if (magnitude >= 1000) return "mt";
  return "kg";
}

/** Roast loss as a percentage of the charge weight. */
export function weightLossPct(chargeKg: Decimal, dropKg: Decimal): Decimal | null {
  const lost = divide(
    multiply(
      // charge − drop, without importing subtract into every caller.
      String(Number.parseFloat(chargeKg) - Number.parseFloat(dropKg)),
      "100",
      6,
    ),
    chargeKg,
    4,
  );
  return lost === null ? null : round(lost, 2);
}

/**
 * How much green a roasted requirement needs.
 *
 * Grossing up, not scaling down: 100 kg roasted at 15% loss needs 117.6471 kg
 * green, not 115. Getting this backwards under-charges every batch, and the
 * error compounds across a production day.
 */
export function grossUpForLoss(roastedKg: Decimal, lossPct: Decimal): Decimal | null {
  const remaining = String(1 - Number.parseFloat(lossPct) / 100);
  if (Number.parseFloat(remaining) <= 0) return null;
  const green = divide(roastedKg, remaining, 6);
  return green === null ? null : round(green, 4);
}
