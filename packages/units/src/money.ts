/**
 * Money.
 *
 * Amounts are exact decimal strings; only formatting turns them into something
 * a person reads. Unit PRICES carry six decimals rather than two because a
 * coffee differential quotes to four or more, and rounding a price to cents
 * before multiplying it by 19,000 kg loses real money.
 */
import type { Decimal } from "./decimal";
import { multiply, round } from "./decimal";

export function formatMoney(
  amount: Decimal | null | undefined,
  currency: string,
  options: { locale?: string; digits?: number } = {},
): string {
  if (amount === null || amount === undefined) return "—";
  const value = Number.parseFloat(amount);
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(options.locale ?? "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: options.digits ?? 2,
    maximumFractionDigits: options.digits ?? 2,
  }).format(value);
}

/**
 * A unit price, shown at the precision it was quoted at.
 *
 * Trailing zeros are trimmed past two decimals so 4.500000 reads as 4.50 while
 * 4.4825 keeps its digits — showing six decimals on every price makes a table
 * unreadable, and truncating to two hides the differential entirely.
 */
export function formatUnitPrice(price: Decimal | null | undefined, currency: string): string {
  if (price === null || price === undefined) return "—";
  const trimmed = price.includes(".") ? price.replace(/(\.\d\d[1-9]*)0+$/, "$1") : price;
  const digits = Math.max(2, (trimmed.split(".")[1] ?? "").length);
  return formatMoney(trimmed, currency, { digits });
}

/** Converts at a stated rate. The rate is always passed in, never looked up —
 *  a report must use the rate recorded at the time, not today's. */
export function convertCurrency(amount: Decimal, fxRate: Decimal): Decimal {
  return round(multiply(amount, fxRate, 8), 4);
}

export function formatPercent(value: number | Decimal | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "—";
  const numeric = typeof value === "string" ? Number.parseFloat(value) : value;
  if (!Number.isFinite(numeric)) return "—";
  return `${numeric.toFixed(digits)}%`;
}
