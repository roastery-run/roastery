import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHOT_SPEC,
  detectAnomalies,
  hourBucket,
  judgeShot,
  rollUp,
  shotRatio,
  type WindowShot,
} from "./espresso";

const shot = (doseG: number | null, yieldG: number | null, durationS: number | null) => ({
  doseG,
  yieldG,
  durationS,
});

describe("judgeShot", () => {
  it("passes a textbook shot", () => {
    expect(judgeShot(shot(18, 36, 28))).toBe("in_spec");
  });

  it("calls channeling before it calls the shot fast", () => {
    // Fast AND a high ratio: water found a path through the puck rather than
    // going through the coffee. Reporting this as "fast" sends a barista to
    // the grinder when the fault is distribution or a worn basket.
    expect(judgeShot(shot(18, 52, 15))).toBe("channeling");
  });

  it("calls a merely fast shot fast", () => {
    expect(judgeShot(shot(18, 32, 18))).toBe("fast");
  });

  it("catches dose before timing, because dose explains timing", () => {
    expect(judgeShot(shot(14, 28, 28))).toBe("under_dosed");
    expect(judgeShot(shot(24, 48, 28))).toBe("over_dosed");
  });

  it("calls a slow shot slow", () => {
    expect(judgeShot(shot(18, 36, 42))).toBe("slow");
  });

  it("discards a shot with nothing measured rather than passing it", () => {
    // A shot we know nothing about must not count as evidence the bar is
    // running well.
    expect(judgeShot(shot(null, null, null))).toBe("discarded");
    expect(judgeShot(shot(18, null, 28))).toBe("discarded");
  });

  it("honours a house spec over the default", () => {
    const tight = { ...DEFAULT_SHOT_SPEC, durationS: { min: 27, max: 30 } };
    expect(judgeShot(shot(18, 36, 25))).toBe("in_spec");
    expect(judgeShot(shot(18, 36, 25), tight)).toBe("fast");
  });

  it("does not divide by a zero dose", () => {
    expect(shotRatio(shot(0, 36, 28))).toBeNull();
    expect(judgeShot(shot(0, 36, 28))).toBe("discarded");
  });
});

describe("detectAnomalies", () => {
  const w = (groupNumber: number, verdict: WindowShot["verdict"], i: number): WindowShot => ({
    pulledAt: 1_000_000 + i * 1000,
    verdict,
    groupNumber,
  });

  it("says nothing about a bar that is running well", () => {
    expect(detectAnomalies([0, 1, 2, 3, 4].map((i) => w(1, "in_spec", i)))).toEqual([]);
  });

  it("does not fire on two bad shots — that is a barista having a moment", () => {
    const shots = [
      w(1, "channeling", 0),
      w(1, "channeling", 1),
      w(1, "in_spec", 2),
      w(1, "in_spec", 3),
    ];
    expect(detectAnomalies(shots)).toEqual([]);
  });

  it("fires on three of the last five, which is the equipment", () => {
    const shots = [
      w(1, "channeling", 0),
      w(1, "in_spec", 1),
      w(1, "channeling", 2),
      w(1, "channeling", 3),
      w(1, "in_spec", 4),
    ];
    const found = detectAnomalies(shots);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("channeling");
    expect(found[0]?.groupNumber).toBe(1);
  });

  it("isolates ONE failing group instead of averaging the machine", () => {
    // The most common real fault, and the one a machine-level average hides
    // behind two groups that are fine.
    const shots = [
      ...[0, 1, 2].map((i) => w(2, "channeling", i)),
      ...[0, 1, 2, 3, 4].map((i) => w(1, "in_spec", i)),
      ...[0, 1, 2, 3, 4].map((i) => w(3, "in_spec", i)),
    ];
    const found = detectAnomalies(shots);
    expect(found).toHaveLength(1);
    expect(found[0]?.groupNumber).toBe(2);
  });

  it("reports one fault per group, not the same fault twice", () => {
    const shots = [0, 1, 2, 3, 4].map((i) => w(1, "channeling", i));
    const found = detectAnomalies(shots);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("channeling");
  });

  it("reports general drift when shots are bad but not channeling", () => {
    const shots = [w(1, "slow", 0), w(1, "slow", 1), w(1, "over_dosed", 2), w(1, "in_spec", 3)];
    const found = detectAnomalies(shots);
    expect(found[0]?.kind).toBe("drifting");
  });

  it("only looks at the most recent five, so a bad hour ago does not alert now", () => {
    const shots = [
      ...[0, 1, 2].map((i) => w(1, "channeling", i)),
      ...[3, 4, 5, 6, 7].map((i) => w(1, "in_spec", i)),
    ];
    expect(detectAnomalies(shots)).toEqual([]);
  });
});

describe("rollUp", () => {
  const r = (doseG: number, yieldG: number, durationS: number, verdict = "in_spec" as const) => ({
    doseG,
    yieldG,
    durationS,
    ratio: yieldG / doseG,
    verdict,
  });

  it("counts and averages", () => {
    const out = rollUp([r(18, 36, 28), r(18, 36, 30), r(18, 36, 26)]);
    expect(out.shotCount).toBe(3);
    expect(out.inSpecCount).toBe(3);
    expect(out.avgDurationS).toBe(28);
    expect(out.avgRatio).toBe(2);
  });

  it("reports the spread, which is what separates a good bar from a lucky one", () => {
    const steady = rollUp([r(18, 36, 28), r(18, 36, 28), r(18, 36, 28)]);
    const erratic = rollUp([r(18, 36, 20), r(18, 36, 28), r(18, 36, 36)]);
    expect(steady.avgDurationS).toBe(erratic.avgDurationS);
    expect(steady.stddevDurationS).toBe(0);
    expect(erratic.stddevDurationS).toBeGreaterThan(7);
  });

  it("does not claim perfect consistency from a single shot", () => {
    expect(rollUp([r(18, 36, 28)]).stddevDurationS).toBeNull();
  });

  it("converts dose to canonical kilograms so it can net against inventory", () => {
    const out = rollUp(Array.from({ length: 100 }, () => r(18, 36, 28)));
    expect(out.coffeeUsedKg).toBe(1.8);
  });

  it("ignores unmeasured values rather than treating them as zero", () => {
    const out = rollUp([
      r(18, 36, 28),
      { doseG: null, yieldG: null, durationS: null, ratio: null, verdict: "discarded" },
    ]);
    expect(out.shotCount).toBe(2);
    expect(out.discardedCount).toBe(1);
    // Averaging a missing dose as 0 would report the bar using half as much
    // coffee as it did.
    expect(out.avgDoseG).toBe(18);
    expect(out.coffeeUsedKg).toBe(0.018);
  });

  it("handles an empty hour", () => {
    const out = rollUp([]);
    expect(out.shotCount).toBe(0);
    expect(out.avgDoseG).toBeNull();
    expect(out.coffeeUsedKg).toBe(0);
  });
});

describe("hourBucket", () => {
  it("floors to the hour in UTC", () => {
    expect(hourBucket(new Date("2026-09-01T14:37:52.412Z")).toISOString()).toBe(
      "2026-09-01T14:00:00.000Z",
    );
  });
});
