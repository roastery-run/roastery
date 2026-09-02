/**
 * Exact decimal arithmetic on strings.
 *
 * Weights and money cross the wire as decimal STRINGS because a JSON number is
 * an IEEE double by the time it reaches a client, and `0.1 + 0.2` is where an
 * auditable ledger stops being auditable. Everything here works on scaled
 * BigInt integers and returns strings, so a running total of ten thousand
 * transactions is exactly the sum of them.
 *
 * This mirrors `apps/api/src/lib/domain/inventory.ts`'s `kg` helper on purpose:
 * both sides of the wire must agree on rounding, and the shared package is
 * where that agreement is written down.
 */

export type Decimal = string;

function scaleOf(value: string): number {
  const dot = value.indexOf(".");
  return dot === -1 ? 0 : value.length - dot - 1;
}

function toScaled(value: string, scale: number): bigint {
  const negative = value.startsWith("-");
  const raw = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = raw.split(".");
  const padded = (fraction + "0".repeat(scale)).slice(0, scale);
  const digits = BigInt(`${whole || "0"}${padded || ""}`);
  return negative ? -digits : digits;
}

function fromScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale) || "0";
  const fraction = scale > 0 ? `.${digits.slice(digits.length - scale)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/** Parses loosely so a hand-typed "1,250.5" or " 18.5 " is not a silent NaN. */
export function parseDecimal(input: string | number): Decimal | null {
  if (typeof input === "number") {
    return Number.isFinite(input) ? String(input) : null;
  }
  const cleaned = input.trim().replace(/,/g, "");
  if (!/^-?\d*\.?\d*$/.test(cleaned) || cleaned === "" || cleaned === "-" || cleaned === ".") {
    return null;
  }
  return cleaned;
}

export function add(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(scaleOf(a), scaleOf(b));
  return fromScaled(toScaled(a, scale) + toScaled(b, scale), scale);
}

export function subtract(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(scaleOf(a), scaleOf(b));
  return fromScaled(toScaled(a, scale) - toScaled(b, scale), scale);
}

export function multiply(a: Decimal, b: Decimal, scale = 6): Decimal {
  const scaleA = scaleOf(a);
  const scaleB = scaleOf(b);
  const product = toScaled(a, scaleA) * toScaled(b, scaleB);
  return round(fromScaled(product, scaleA + scaleB), scale);
}

export function divide(a: Decimal, b: Decimal, scale = 6): Decimal | null {
  const working = scale + 2;
  const divisor = toScaled(b, working);
  if (divisor === 0n) return null;
  // Scaled up before dividing so the quotient keeps `working` digits, then
  // rounded once at the end — dividing first and rounding after would lose the
  // digits the rounding is supposed to look at.
  const quotient = (toScaled(a, working) * 10n ** BigInt(working)) / divisor;
  return round(fromScaled(quotient, working), scale);
}

/**
 * Half-up rounding, which is what an invoice does.
 *
 * Not banker's rounding: a customer comparing a line total against a hand
 * calculation expects 2.5 to become 3, and "we round to even" is not an
 * explanation anyone accepts on an invoice.
 */
export function round(value: Decimal, scale: number): Decimal {
  const current = scaleOf(value);
  if (current <= scale) return fromScaled(toScaled(value, scale), scale);

  const scaled = toScaled(value, current);
  const factor = 10n ** BigInt(current - scale);
  const negative = scaled < 0n;
  const magnitude = negative ? -scaled : scaled;
  const remainder = magnitude % factor;
  let quotient = magnitude / factor;
  if (remainder * 2n >= factor) quotient += 1n;
  return fromScaled(negative ? -quotient : quotient, scale);
}

export function compare(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const scale = Math.max(scaleOf(a), scaleOf(b));
  const left = toScaled(a, scale);
  const right = toScaled(b, scale);
  return left < right ? -1 : left > right ? 1 : 0;
}

export const isZero = (value: Decimal): boolean => toScaled(value, scaleOf(value)) === 0n;
export const isNegative = (value: Decimal): boolean => compare(value, "0") < 0;

export function sum(values: Decimal[]): Decimal {
  return values.reduce<Decimal>((total, value) => add(total, value), "0");
}

/**
 * For arithmetic that genuinely needs a number — a chart axis, a percentage
 * for a progress bar. Named so that reaching for it is a visible decision
 * rather than an accident.
 */
export function toNumber(value: Decimal | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
