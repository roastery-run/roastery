/**
 * Judging an espresso shot, and spotting a group head going wrong.
 *
 * All pure. A shot is judged at write time against the specification in force
 * then, and the verdict is stored — re-deriving it later would rewrite history
 * and make last week's quality report disagree with itself once someone
 * adjusts the spec.
 */

export type ShotSpec = {
  /** Grams in the basket. */
  doseG: { min: number; max: number };
  /** Seconds from pump on to cup. */
  durationS: { min: number; max: number };
  /** yield / dose. The number a barista actually dials on. */
  ratio: { min: number; max: number };
};

/**
 * A conventional modern espresso window.
 *
 * Wide on purpose. A house spec is a per-site setting; these are the defaults
 * a bar gets before anyone has configured anything, and a default that flags
 * half of a competent bar's shots trains everyone to ignore the alerts.
 */
export const DEFAULT_SHOT_SPEC: ShotSpec = {
  doseG: { min: 17, max: 21 },
  durationS: { min: 22, max: 34 },
  ratio: { min: 1.6, max: 2.6 },
};

export type ShotMeasurement = {
  doseG: number | null;
  yieldG: number | null;
  durationS: number | null;
};

export type ShotVerdict =
  | "in_spec"
  | "fast"
  | "slow"
  | "under_dosed"
  | "over_dosed"
  | "channeling"
  | "discarded";

export function shotRatio(shot: ShotMeasurement): number | null {
  if (shot.doseG === null || shot.yieldG === null || shot.doseG <= 0) return null;
  return round3(shot.yieldG / shot.doseG);
}

/**
 * One shot's verdict.
 *
 * Order matters. Channeling is checked FIRST because it explains the other
 * symptoms: water finding a path through the puck produces a fast shot at a
 * normal dose, and reporting that as merely "fast" sends a barista to adjust
 * the grinder when the real fault is distribution or a worn basket.
 */
export function judgeShot(shot: ShotMeasurement, spec: ShotSpec = DEFAULT_SHOT_SPEC): ShotVerdict {
  const { doseG, durationS } = shot;
  const ratio = shotRatio(shot);

  // Nothing measured. Not a pass — a shot we know nothing about must not be
  // counted as evidence the bar is running well.
  if (doseG === null || durationS === null || ratio === null) return "discarded";

  // A high ratio reached quickly is water going round the coffee rather than
  // through it: lots of liquid, not much extraction, in not much time.
  if (durationS < spec.durationS.min && ratio > spec.ratio.max) return "channeling";

  if (doseG < spec.doseG.min) return "under_dosed";
  if (doseG > spec.doseG.max) return "over_dosed";
  if (durationS < spec.durationS.min) return "fast";
  if (durationS > spec.durationS.max) return "slow";
  if (ratio < spec.ratio.min || ratio > spec.ratio.max) {
    return ratio < spec.ratio.min ? "slow" : "fast";
  }
  return "in_spec";
}

/* ------------------------------------------------------- anomaly detection */

export type WindowShot = { pulledAt: number; verdict: ShotVerdict; groupNumber: number };

export type Anomaly = {
  kind: "channeling" | "drifting" | "group_down";
  groupNumber: number;
  message: string;
  /** How many of the recent shots support it. */
  evidence: number;
};

/** Consecutive-ish bad shots on one group before it is worth interrupting anyone. */
const CHANNELING_THRESHOLD = 3;
const WINDOW_SIZE = 5;

/**
 * What is going wrong at this bar right now.
 *
 * Judged PER GROUP HEAD, which is the whole point: a single failing group on a
 * three-group machine is the most common real fault, and averaging the machine
 * hides it behind two groups that are fine. Two bad shots are a barista having
 * a moment; three of the last five on one group is the equipment.
 */
export function detectAnomalies(recent: WindowShot[]): Anomaly[] {
  const byGroup = new Map<number, WindowShot[]>();
  for (const shot of recent) {
    const list = byGroup.get(shot.groupNumber) ?? [];
    list.push(shot);
    byGroup.set(shot.groupNumber, list);
  }

  const anomalies: Anomaly[] = [];
  for (const [groupNumber, shots] of byGroup) {
    const window = shots.sort((a, b) => b.pulledAt - a.pulledAt).slice(0, WINDOW_SIZE);
    if (window.length < CHANNELING_THRESHOLD) continue;

    const channeling = window.filter((s) => s.verdict === "channeling").length;
    if (channeling >= CHANNELING_THRESHOLD) {
      anomalies.push({
        kind: "channeling",
        groupNumber,
        message: `Group ${groupNumber} is channeling: ${channeling} of the last ${window.length} shots`,
        evidence: channeling,
      });
      // Already the most specific explanation available for this group; a
      // "drifting" alert on top would just be the same fault reported twice.
      continue;
    }

    const outOfSpec = window.filter((s) => s.verdict !== "in_spec").length;
    if (outOfSpec >= CHANNELING_THRESHOLD) {
      anomalies.push({
        kind: "drifting",
        groupNumber,
        message: `Group ${groupNumber} is off spec: ${outOfSpec} of the last ${window.length} shots`,
        evidence: outOfSpec,
      });
    }
  }
  return anomalies.sort((a, b) => a.groupNumber - b.groupNumber);
}

/* ------------------------------------------------------------- aggregation */

export type RollupInput = {
  doseG: number | null;
  yieldG: number | null;
  durationS: number | null;
  ratio: number | null;
  verdict: ShotVerdict;
};

export type Rollup = {
  shotCount: number;
  inSpecCount: number;
  channelingCount: number;
  discardedCount: number;
  avgDoseG: number | null;
  avgYieldG: number | null;
  avgDurationS: number | null;
  avgRatio: number | null;
  stddevDurationS: number | null;
  coffeeUsedKg: number;
};

export function rollUp(shots: RollupInput[]): Rollup {
  const nums = (pick: (s: RollupInput) => number | null) =>
    shots.map(pick).filter((v): v is number => v !== null && Number.isFinite(v));

  const durations = nums((s) => s.durationS);
  const doses = nums((s) => s.doseG);

  return {
    shotCount: shots.length,
    inSpecCount: shots.filter((s) => s.verdict === "in_spec").length,
    channelingCount: shots.filter((s) => s.verdict === "channeling").length,
    discardedCount: shots.filter((s) => s.verdict === "discarded").length,
    avgDoseG: mean(doses),
    avgYieldG: mean(nums((s) => s.yieldG)),
    avgDurationS: mean(durations),
    avgRatio: mean(nums((s) => s.ratio)),
    // The spread, not just the mean. A bar averaging 28 s with everything
    // within a second is good; the same average from 20 s and 36 s is not, and
    // consistency is what actually distinguishes the two.
    stddevDurationS: stddev(durations),
    // Grams to canonical kilograms, so this can be netted against roasted
    // inventory without a unit conversion at every call site.
    coffeeUsedKg: round4(doses.reduce((a, b) => a + b, 0) / 1000),
  };
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return round3(values.reduce((a, b) => a + b, 0) / values.length);
}

function stddev(values: number[]): number | null {
  // One sample has no spread. Reporting 0 would claim perfect consistency from
  // a single shot, which reads as a very good bar and is meaningless.
  if (values.length < 2) return null;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return round3(Math.sqrt(variance));
}

/** UTC hour bucket, the grain every dashboard reads. */
export function hourBucket(at: Date): Date {
  const d = new Date(at);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
