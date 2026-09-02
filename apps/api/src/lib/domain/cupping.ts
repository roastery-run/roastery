/**
 * Cupping score arithmetic.
 *
 * Kept as pure functions so the parts that must be defensible to a supplier —
 * how a total is derived, and how much the panel disagreed — are testable
 * without a database.
 */

/** The ten SCA attributes, each scored 6.00-10.00 in quarter points. */
export const SCA_ATTRIBUTES = [
  "fragrance",
  "flavor",
  "aftertaste",
  "acidity",
  "body",
  "balance",
  "uniformity",
  "cleanCup",
  "sweetness",
  "overall",
] as const;

export type ScaAttribute = (typeof SCA_ATTRIBUTES)[number];
export type ScaScores = Partial<Record<ScaAttribute, number>>;

export const SCA_MIN = 6;
export const SCA_MAX = 10;
/** Scores are recorded in quarter points; anything finer is false precision. */
export const SCA_STEP = 0.25;

/**
 * The SCA total: the ten attributes summed, less defects.
 *
 * Uniformity, clean cup and sweetness are scored out of 10 as five cups of 2,
 * which is why they appear on the same scale as the sensory attributes and are
 * summed the same way.
 */
export function scaTotal(scores: ScaScores, defectsPenalty = 0): number {
  const sum = SCA_ATTRIBUTES.reduce((acc, key) => acc + (scores[key] ?? 0), 0);
  return round2(sum - defectsPenalty);
}

export type ScoreValidation = { ok: true } | { ok: false; errors: string[] };

/**
 * Rejects a score sheet that cannot be defended.
 *
 * Out-of-range or off-step values are not a formatting nicety: an SCA score is
 * a claim about a coffee that a supplier may dispute, and a 7.3 on a
 * quarter-point scale means the sheet was not filled the way the standard
 * requires.
 */
export function validateScaScores(scores: ScaScores): ScoreValidation {
  const errors: string[] = [];
  for (const key of SCA_ATTRIBUTES) {
    const value = scores[key];
    if (value === undefined) continue;
    if (!Number.isFinite(value)) {
      errors.push(`${key} is not a number`);
      continue;
    }
    if (value < SCA_MIN || value > SCA_MAX) {
      errors.push(`${key} must be between ${SCA_MIN} and ${SCA_MAX}`);
    }
    // Compare in quarter-point units to avoid float modulo surprises.
    if (Math.round(value * 4) !== value * 4) {
      errors.push(`${key} must be in ${SCA_STEP} steps`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

export type PanelResult = {
  /** Mean of the cuppers' totals. */
  average: number;
  /** Population standard deviation: how much the panel disagreed. */
  stdDev: number;
  count: number;
  min: number;
  max: number;
  /** Cuppers more than two standard deviations from the mean. */
  outliers: { cupper: string; total: number; deviation: number }[];
};

/**
 * Aggregates a panel's scores for one coffee.
 *
 * The spread matters as much as the mean. A sample averaging 85 with every
 * cupper within half a point is a confident result; the same 85 from scores of
 * 80 and 90 means the panel disagreed and the number should not be quoted
 * without saying so.
 */
export function aggregatePanel(entries: { cupper: string; total: number }[]): PanelResult | null {
  const valid = entries.filter((e) => Number.isFinite(e.total));
  if (!valid.length) return null;

  const totals = valid.map((e) => e.total);
  const average = totals.reduce((a, b) => a + b, 0) / totals.length;
  // Population rather than sample standard deviation: these ARE all the
  // cuppers, not a sample drawn from a larger panel.
  const variance = totals.reduce((acc, t) => acc + (t - average) ** 2, 0) / totals.length;
  const stdDev = Math.sqrt(variance);

  return {
    average: round2(average),
    stdDev: round3(stdDev),
    count: valid.length,
    min: round2(Math.min(...totals)),
    max: round2(Math.max(...totals)),
    // Flagged rather than discarded: an outlier is a conversation for
    // calibration, not a data point to quietly drop.
    outliers: findOutliers(valid, average),
  };
}

/**
 * Cuppers whose score is far from the panel.
 *
 * Uses the median absolute deviation rather than the standard deviation, and
 * the reason is not fussiness: a single extreme score inflates the standard
 * deviation enough to hide ITSELF. A panel of 85, 85.5, 84.5, 85.25 and 74 has
 * a standard deviation of 4.4, so the 74 sits 8.85 from the mean against a
 * two-sigma threshold of 8.87 — and the one score anybody would call an
 * outlier goes unflagged.
 *
 * MAD is built from the median, so an extreme value cannot pull the yardstick
 * out with it. 0.6745 rescales MAD to be comparable to a standard deviation
 * for normally distributed data, and 3.5 is the conventional cut-off.
 */
function findOutliers(
  entries: { cupper: string; total: number }[],
  average: number,
): { cupper: string; total: number; deviation: number }[] {
  if (entries.length < 3) return [];

  const totals = entries.map((e) => e.total);
  const med = median(totals);
  const mad = median(totals.map((t) => Math.abs(t - med)));

  // Every cupper agreeing exactly gives a MAD of zero; anything differing at
  // all is then trivially "far", so fall back to an absolute point spread.
  if (mad === 0) {
    return entries
      .filter((e) => Math.abs(e.total - med) >= 2)
      .map((e) => ({
        cupper: e.cupper,
        total: round2(e.total),
        deviation: round2(e.total - average),
      }));
  }

  return entries
    .filter((e) => Math.abs((0.6745 * (e.total - med)) / mad) > 3.5)
    .map((e) => ({
      cupper: e.cupper,
      total: round2(e.total),
      deviation: round2(e.total - average),
    }));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Blind codes for a session.
 *
 * Deliberately not sequential letters in sample order — a cupper who notices
 * that A is always the house coffee is no longer blind. Seeded by session id
 * so the assignment is reproducible for an audit.
 */
export function assignBlindCodes(count: number, seed: string): string[] {
  const codes = Array.from({ length: count }, (_, i) => threeLetterCode(i));
  // Fisher-Yates with a seeded PRNG, so the same session always produces the
  // same assignment and a dispute can be re-examined.
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  const rnd = () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), h | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = codes.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const a = codes[i] as string;
    const b = codes[j] as string;
    codes[i] = b;
    codes[j] = a;
  }
  return codes;
}

function threeLetterCode(index: number): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O: they read as 1 and 0
  const a = letters[Math.floor(index / (letters.length * letters.length)) % letters.length] ?? "A";
  const b = letters[Math.floor(index / letters.length) % letters.length] ?? "A";
  const c = letters[index % letters.length] ?? "A";
  return `${a}${b}${c}`;
}

/**
 * SCA full defect equivalents.
 *
 * A primary defect (a full black bean, a pod) counts far more heavily than a
 * secondary one (a broken bean, a small stick), because it does more damage to
 * the cup. Counting them equally is how a lot passes a grading it should fail.
 */
export function fullDefectEquivalents(primary: number, secondary: number): number {
  // SCA specialty grade: primary defects are disqualifying, so they weigh 1
  // each; secondary defects are grouped, with roughly 5 to a full defect.
  return round2(primary + secondary / 5);
}

/** SCA specialty grade allows no primary defects and at most 5 full equivalents. */
export function gradePasses(primary: number, secondary: number, maxEquivalents = 5): boolean {
  if (primary > 0) return false;
  return fullDefectEquivalents(primary, secondary) <= maxEquivalents;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
