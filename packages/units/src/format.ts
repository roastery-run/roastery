/**
 * Display formatting shared by every surface.
 *
 * Numbers are formatted with grouping and a fixed number of decimals so a
 * column of weights lines up. Paired with the tabular-numeral setting in the
 * design system, that is what makes a table scannable — an operator comparing
 * forty lot weights by eye cannot do it if the digits are proportional and the
 * decimal points wander.
 */
import type { Decimal } from "./decimal";
import {
  type BagContext,
  fromKg,
  naturalWeightUnit,
  WEIGHT_UNIT_LABEL,
  type WeightUnit,
} from "./weight";

export const EM_DASH = "—";

export function formatNumber(
  value: number | Decimal | null | undefined,
  options: { digits?: number; locale?: string } = {},
): string {
  if (value === null || value === undefined) return EM_DASH;
  const numeric = typeof value === "string" ? Number.parseFloat(value) : value;
  if (!Number.isFinite(numeric)) return EM_DASH;
  const digits = options.digits ?? 0;
  return new Intl.NumberFormat(options.locale ?? "en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(numeric);
}

export type WeightFormatOptions = {
  unit?: WeightUnit | "auto";
  digits?: number;
  /** Needed only when displaying bags. */
  context?: BagContext;
  withUnit?: boolean;
};

export function formatWeight(
  kg: Decimal | null | undefined,
  options: WeightFormatOptions = {},
): string {
  if (kg === null || kg === undefined) return EM_DASH;
  const unit = !options.unit || options.unit === "auto" ? naturalWeightUnit(kg) : options.unit;
  const converted = fromKg(kg, unit, options.context ?? { bagWeightKg: null });
  // Bags with no bag weight on the lot: showing the kilogram figure is honest,
  // where inventing a 60 kg default would silently misreport a Colombian lot
  // by 17%.
  if (converted === null) return formatWeight(kg, { ...options, unit: "kg" });

  const digits = options.digits ?? (unit === "g" ? 1 : unit === "bag" ? 0 : 2);
  const formatted = formatNumber(converted, { digits });
  return options.withUnit === false ? formatted : `${formatted} ${WEIGHT_UNIT_LABEL[unit]}`;
}

/** A date, without a time, in the reader's locale. */
export function formatDate(value: string | Date | null | undefined, locale = "en-US"): string {
  if (!value) return EM_DASH;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EM_DASH;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined, locale = "en-US"): string {
  if (!value) return EM_DASH;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EM_DASH;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/**
 * "3 days ago", "in 2 weeks".
 *
 * Used only where the distance is the point — a best-before date, when a
 * contract milestone falls due. Absolute dates are the default everywhere
 * else, because "2 months ago" is not something anyone can reconcile against a
 * shipping document.
 */
export function formatRelative(value: string | Date | null | undefined, locale = "en-US"): string {
  if (!value) return EM_DASH;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EM_DASH;

  const seconds = (date.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const divisions: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.34524, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];

  let duration = seconds;
  for (const [amount, unit] of divisions) {
    if (Math.abs(duration) < amount) return rtf.format(Math.round(duration), unit);
    duration /= amount;
  }
  return rtf.format(Math.round(duration), "year");
}

/**
 * Words that are acronyms, not words.
 *
 * Without this, `module:api` renders as "Api" and `dtr_pct` as "Dtr pct" —
 * which reads as a bug in the product rather than as a label.
 */
const ACRONYMS: Record<string, string> = {
  api: "API",
  qc: "QC",
  sca: "SCA",
  dtr: "DTR",
  ror: "RoR",
  pos: "POS",
  sku: "SKU",
  eta: "ETA",
  ea: "EA",
  id: "ID",
  url: "URL",
  fx: "FX",
  aw: "aW",
  kg: "kg",
  pct: "%",
};

/** Turns an enum value into a label: `in_progress` → `In progress`. */
export function humanize(value: string | null | undefined): string {
  if (!value) return EM_DASH;
  const words = value.replace(/[_-]+/g, " ").trim().split(/\s+/);
  return words
    .map((word, index) => {
      const acronym = ACRONYMS[word.toLowerCase()];
      if (acronym) return acronym;
      // Only the first word is capitalized: this is a label, not a title, and
      // Title Case On Every Word reads as a different product.
      return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    })
    .join(" ")
    .trim();
}

/**
 * An ISO-3166 alpha-2 code as a country name.
 *
 * Storage is the code — it is stable, unambiguous and what every trade
 * document uses. Display is the name, because "CO" on a retail bag means
 * nothing to the person holding it. `Intl.DisplayNames` does the translation
 * and localizes it for free.
 */
export function formatCountry(code: string | null | undefined, locale = "en-US"): string {
  if (!code) return EM_DASH;
  if (code.length !== 2) return code;
  try {
    // `fallback: "code"` matters: without it an unrecognized code renders as
    // "Unknown Region", which is worse than the code — it reads as a fact
    // about the coffee rather than a gap in our country table.
    const name = new Intl.DisplayNames([locale], { type: "region", fallback: "code" }).of(
      code.toUpperCase(),
    );
    return name ?? code;
  } catch {
    // Showing the code is more honest than an em dash, which would imply the
    // origin was never recorded.
    return code;
  }
}
