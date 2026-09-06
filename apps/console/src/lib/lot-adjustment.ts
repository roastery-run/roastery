/**
 * Turning what a person knows into the delta the ledger needs.
 *
 * `adjustGreenLotQuantity` takes a signed `deltaKg`, which is almost never the
 * number anybody has. Somebody who recounts a lot knows what they COUNTED;
 * somebody writing off a wet bag knows what they LOST. Asking either of them
 * for a delta is asking them to do subtraction they have no reason to do, and
 * the arithmetic error lands in an audit trail.
 *
 * So the reason chooses the question, and this converts the answer. Pure, and
 * on exact decimals rather than floats, because the number produced here is
 * the number that moves stock.
 */
import { add, compare, type Decimal, isZero, parseDecimal, subtract } from "@roastery/units";

/** The API's own enum, in the order the form offers it. */
export const ADJUST_REASONS = [
  "recount",
  "shrinkage",
  "sample_draw",
  "write_off",
  "return",
  "adjust",
] as const;

export type AdjustReason = (typeof ADJUST_REASONS)[number];

/** What the amount field is asking for, which is different per reason. */
export type AmountMeaning = "counted" | "removed" | "added" | "signed";

export const REASONS: Record<
  AdjustReason,
  { label: string; means: AmountMeaning; hint: string; requiresComment: boolean }
> = {
  recount: {
    label: "Recount",
    means: "counted",
    hint: "The weight you actually counted. The change is worked out from it.",
    requiresComment: false,
  },
  shrinkage: {
    label: "Shrinkage",
    means: "removed",
    hint: "Moisture loss and settling, found at a count rather than at an event.",
    requiresComment: false,
  },
  sample_draw: {
    label: "Sample drawn",
    means: "removed",
    hint: "Coffee taken for cupping or grading. Say which session, so the ledger explains itself.",
    requiresComment: true,
  },
  write_off: {
    label: "Write off",
    means: "removed",
    hint: "Coffee that is gone and is not coming back. This is the entry an auditor reads first.",
    requiresComment: true,
  },
  return: {
    label: "Return",
    means: "added",
    hint: "Coffee coming back into this lot.",
    requiresComment: false,
  },
  adjust: {
    label: "Other correction",
    means: "signed",
    hint: "A signed correction where none of the reasons above fit. Negative removes.",
    requiresComment: false,
  },
};

export type Adjustment =
  | { ok: true; deltaKg: Decimal; resultingKg: Decimal }
  | { ok: false; problem: string };

export function buildAdjustment(input: {
  reason: AdjustReason;
  /** Exactly what was typed. */
  amount: string;
  /** The lot's on-hand weight in canonical kilograms. */
  onHandKg: Decimal;
}): Adjustment {
  const parsed = parseDecimal(input.amount);
  if (parsed === null) return { ok: false, problem: "Enter a weight in kilograms." };

  const meaning = REASONS[input.reason].means;
  const deltaKg = deltaFor(meaning, parsed, input.onHandKg);

  if (meaning !== "signed" && meaning !== "counted" && compare(parsed, "0") <= 0) {
    return { ok: false, problem: "Enter a weight above zero." };
  }
  if (meaning === "counted" && compare(parsed, "0") < 0) {
    return { ok: false, problem: "A counted weight cannot be negative." };
  }
  if (isZero(deltaKg)) {
    return {
      ok: false,
      problem:
        meaning === "counted"
          ? "That is what is already recorded, so there is nothing to adjust."
          : "Enter a weight above zero.",
    };
  }

  const resultingKg = add(input.onHandKg, deltaKg);
  if (compare(resultingKg, "0") < 0) {
    return {
      ok: false,
      // Naming what is actually there is the difference between a person
      // fixing their entry and a person guessing again.
      problem: `This lot holds ${input.onHandKg} kg, so it cannot lose that much.`,
    };
  }

  return { ok: true, deltaKg, resultingKg };
}

/**
 * The sign rule, shared with material adjustments.
 *
 * A recount states the destination, not the journey. Everything else states the
 * journey, and the sign belongs to the reason rather than to the typing: asking
 * somebody to remember a minus on a write-off is asking for the one entry that
 * doubles a loss instead of recording it.
 */
export function deltaFor(meaning: AmountMeaning, amount: Decimal, onHand: Decimal): Decimal {
  return meaning === "counted"
    ? subtract(amount, onHand)
    : meaning === "removed"
      ? negate(amount)
      : amount;
}

function negate(value: Decimal): Decimal {
  return subtract("0", value);
}
