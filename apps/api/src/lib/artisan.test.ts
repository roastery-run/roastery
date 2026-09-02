import { describe, expect, it } from "vitest";
import { convertRateOfRise, convertTemp, parseArtisan, parseArtisanJson } from "./artisan";

/**
 * The three mistakes a naive Artisan importer makes. Each one is silent: the
 * import succeeds, the curve looks plausible, and every statistic derived from
 * it is wrong.
 */
describe("Artisan JSON", () => {
  /** The recorder ran for 30 s on an empty drum before the beans went in. */
  const doc = {
    mode: "C",
    timex: [0, 10, 20, 30, 40, 50, 60, 70],
    temp1: [180, 150, 120, 200, 150, 120, 140, 170],
    temp2: [200, 170, 140, 205, 120, 95, 110, 150],
    // charge at index 3 (t=30), dry end at index 6, drop at index 7.
    // Positions 2, 4, 5 are 0 — meaning UNSET, not "at time zero".
    timeindex: [3, 6, 0, 0, 0, 0, 7, 0],
    roastisodate: "2026-03-01T09:15:00Z",
    beans: "Ethiopia Yirgacheffe",
    weight: [12000, 10200, "g"],
  };

  it("rebases every sample against the charge index, not the file start", () => {
    const out = parseArtisanJson(JSON.stringify(doc));
    // Charge is at timex[3] = 30, so the first kept sample is t = 0.
    expect(out.samples[0]?.t).toBe(0);
    expect(out.samples.map((s) => s.t)).toEqual([0, 10, 20, 30, 40]);
    // The 30 seconds of empty drum before charge are dropped, not imported as
    // negative time or as part of the roast.
    expect(out.samples.every((s) => s.t >= 0)).toBe(true);
  });

  it("treats a zero timeindex entry as unset, except for charge", () => {
    const out = parseArtisanJson(JSON.stringify(doc));
    const kinds = out.events.map((e) => e.kind);

    expect(kinds).toContain("charge");
    expect(kinds).toContain("dry_end");
    expect(kinds).toContain("drop");
    // Positions 2-5 were 0. Read literally, this roast would gain a phantom
    // first crack AT CHARGE, which then poisons every development statistic.
    expect(kinds).not.toContain("first_crack_start");
    expect(kinds).not.toContain("second_crack_start");
  });

  it("places charge at zero and later events after it", () => {
    const out = parseArtisanJson(JSON.stringify(doc));
    expect(out.events.find((e) => e.kind === "charge")?.t).toBe(0);
    expect(out.events.find((e) => e.kind === "dry_end")?.t).toBe(30);
    expect(out.events.find((e) => e.kind === "drop")?.t).toBe(40);
  });

  it("reads bean temperature from temp2 and environment from temp1", () => {
    const out = parseArtisanJson(JSON.stringify(doc));
    // At charge (index 3): temp2 = 205 is the bean probe, temp1 = 200 the env.
    expect(out.samples[0]?.bt).toBe(205);
    expect(out.samples[0]?.et).toBe(200);
  });

  it("converts weights to kilograms whatever unit the file used", () => {
    const out = parseArtisanJson(JSON.stringify(doc));
    expect(out.weightInKg).toBe(12);
    expect(out.weightOutKg).toBe(10.2);

    const lbs = parseArtisanJson(JSON.stringify({ ...doc, weight: [26.5, 22.4, "lb"] }));
    expect(lbs.weightInKg).toBeCloseTo(12.02, 2);
  });

  it("treats -1 as a missing reading rather than a temperature", () => {
    const out = parseArtisanJson(
      JSON.stringify({ ...doc, temp1: [180, -1, 120, 200, 150, 120, 140, 170] }),
    );
    // -1 is a plausible Celsius value, which is exactly why it must be
    // recognised as Artisan's missing-reading sentinel.
    expect(out.samples.some((s) => s.et === -1)).toBe(false);
  });

  it("refuses a .alog file with an actionable message", () => {
    expect(() => parseArtisan("[{'mode': 'C'}]")).toThrow(/re-export it as JSON/i);
  });

  it("rejects an export with no time series", () => {
    expect(() => parseArtisanJson(JSON.stringify({ mode: "C", timex: [] }))).toThrow(
      /no time series/i,
    );
  });
});

describe("Fahrenheit conversion", () => {
  it("converts a temperature with the offset", () => {
    expect(convertTemp(392, "F")).toBe(200);
    expect(convertTemp(212, "F")).toBe(100);
    expect(convertTemp(200, "C")).toBe(200);
  });

  it("converts a rate of rise WITHOUT the offset", () => {
    // A rate of rise is a difference per minute. Applying the 32-degree offset
    // would turn a 18 F/min rise into a -7.8 C/min FALL.
    expect(convertRateOfRise(18, "F")).toBe(10);
    expect(convertRateOfRise(0, "F")).toBe(0);
    expect(convertTemp(0, "F")).toBe(-17.78);
  });

  it("converts a whole Fahrenheit export", () => {
    const out = parseArtisanJson(
      JSON.stringify({
        mode: "F",
        timex: [0, 10, 20],
        temp1: [392, 400, 410],
        temp2: [392, 401, 420],
        timeindex: [0, 0, 0, 0, 0, 0, 2, 0],
      }),
    );
    expect(out.samples[0]?.bt).toBe(200);
    expect(out.samples[0]?.et).toBe(200);
  });
});

describe("Artisan CSV", () => {
  const csv = [
    "Date:2026-03-01\tUnit:C",
    "Time1\tTime2\tBT\tET\tEvent",
    "00:00\t00:00\t205.0\t200.0\tCharge",
    "00:30\t00:30\t120.5\t180.0\t",
    "01:00\t01:00\t135.2\t190.0\t",
    "10:30\t10:30\t205.8\t225.0\tDrop",
  ].join("\n");

  it("parses mm:ss times into seconds", () => {
    const out = parseArtisan(csv);
    expect(out.samples.map((s) => s.t)).toEqual([0, 30, 60, 630]);
  });

  it("reads bean and environment columns", () => {
    const out = parseArtisan(csv);
    expect(out.samples[0]?.bt).toBe(205);
    expect(out.samples[3]?.bt).toBe(205.8);
    expect(out.samples[0]?.et).toBe(200);
  });

  it("detects Fahrenheit from the header", () => {
    const f = csv.replace("BT\tET", "BT (F)\tET (F)").replace("205.0\t200.0", "392.0\t392.0");
    const out = parseArtisan(f);
    expect(out.samples[0]?.bt).toBe(200);
  });
});
