import { describe, expect, it } from "vitest";
import {
  aggregatePanel,
  assignBlindCodes,
  fullDefectEquivalents,
  gradePasses,
  scaTotal,
  validateScaScores,
} from "./cupping";

describe("SCA totals", () => {
  const excellent = {
    fragrance: 8.25,
    flavor: 8.5,
    aftertaste: 8,
    acidity: 8.25,
    body: 8,
    balance: 8.25,
    uniformity: 10,
    cleanCup: 10,
    sweetness: 10,
    overall: 8.5,
  };

  it("sums the ten attributes", () => {
    expect(scaTotal(excellent)).toBe(87.75);
  });

  it("subtracts defects from the total", () => {
    expect(scaTotal(excellent, 4)).toBe(83.75);
  });

  it("does not drift on quarter points", () => {
    // 0.25 steps summed ten times is where float error shows up.
    const quarters = Object.fromEntries(
      [
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
      ].map((k) => [k, 7.25]),
    );
    expect(scaTotal(quarters)).toBe(72.5);
  });
});

describe("score validation", () => {
  it("accepts a well-formed sheet", () => {
    expect(validateScaScores({ flavor: 8.25, body: 7.5 }).ok).toBe(true);
  });

  it("rejects a score outside the SCA range", () => {
    const result = validateScaScores({ flavor: 5.5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/between 6 and 10/);
  });

  it("rejects a score off the quarter-point step", () => {
    // 7.3 means the sheet was not filled the way the standard requires, and a
    // supplier disputing the score would be right to say so.
    const result = validateScaScores({ flavor: 7.3 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/0.25 steps/);
  });

  it("ignores attributes that were not scored", () => {
    expect(validateScaScores({}).ok).toBe(true);
  });
});

describe("panel aggregation", () => {
  it("averages a confident panel and reports a low spread", () => {
    const result = aggregatePanel([
      { cupper: "ada", total: 85 },
      { cupper: "blake", total: 85.5 },
      { cupper: "cara", total: 84.75 },
    ]);
    expect(result?.average).toBe(85.08);
    expect(result?.stdDev).toBeLessThan(0.5);
    expect(result?.outliers).toEqual([]);
  });

  it("reports the same average for a panel that disagreed", () => {
    const tight = aggregatePanel([
      { cupper: "a", total: 85 },
      { cupper: "b", total: 85 },
      { cupper: "c", total: 85 },
    ]);
    const split = aggregatePanel([
      { cupper: "a", total: 80 },
      { cupper: "b", total: 85 },
      { cupper: "c", total: 90 },
    ]);
    expect(tight?.average).toBe(split?.average);
    // The spread is what distinguishes them, which is why it is stored
    // alongside the mean rather than discarded.
    expect(tight?.stdDev).toBe(0);
    expect(split?.stdDev).toBeGreaterThan(4);
  });

  it("flags a cupper far from the panel without discarding them", () => {
    const result = aggregatePanel([
      { cupper: "a", total: 85 },
      { cupper: "b", total: 85.5 },
      { cupper: "c", total: 84.5 },
      { cupper: "d", total: 85.25 },
      { cupper: "outlier", total: 74 },
    ]);
    expect(result?.outliers.map((o) => o.cupper)).toEqual(["outlier"]);
    // Still counted: an outlier is a calibration conversation, not bad data.
    expect(result?.count).toBe(5);
  });

  it("returns null for an unscored sample", () => {
    expect(aggregatePanel([])).toBeNull();
  });
});

describe("blind codes", () => {
  it("gives every sample a distinct code", () => {
    const codes = assignBlindCodes(6, "session-1");
    expect(new Set(codes).size).toBe(6);
  });

  it("does not run in sample order", () => {
    // Sequential codes would let a cupper learn that the first cup is always
    // the house coffee, which is no longer blind.
    const codes = assignBlindCodes(12, "session-1");
    const sequential = assignBlindCodes(12, "session-1").slice().sort();
    expect(codes).not.toEqual(sequential);
  });

  it("is reproducible, so a disputed session can be re-examined", () => {
    expect(assignBlindCodes(8, "abc")).toEqual(assignBlindCodes(8, "abc"));
    expect(assignBlindCodes(8, "abc")).not.toEqual(assignBlindCodes(8, "xyz"));
  });

  it("avoids letters that read as digits", () => {
    const codes = assignBlindCodes(50, "s").join("");
    expect(codes).not.toMatch(/[IO]/);
  });
});

describe("green grading defects", () => {
  it("weighs a primary defect far above a secondary one", () => {
    // Counting them equally is how a lot passes a grading it should fail.
    expect(fullDefectEquivalents(0, 5)).toBe(1);
    expect(fullDefectEquivalents(1, 0)).toBe(1);
    expect(fullDefectEquivalents(0, 15)).toBe(3);
  });

  it("fails specialty grade on any primary defect", () => {
    expect(gradePasses(1, 0)).toBe(false);
    expect(gradePasses(0, 0)).toBe(true);
  });

  it("fails once secondary defects exceed the allowance", () => {
    expect(gradePasses(0, 25)).toBe(true);
    expect(gradePasses(0, 26)).toBe(false);
  });
});

describe("outlier detection is robust to the outlier itself", () => {
  it("catches the score that standard deviation would hide", () => {
    // The case that motivated using MAD: with a two-sigma rule this panel's
    // 74 sits 8.85 from the mean against a threshold of 8.87, so the one
    // score anybody would call an outlier goes unflagged — the outlier
    // inflated the very yardstick meant to catch it.
    const panel = [
      { cupper: "a", total: 85 },
      { cupper: "b", total: 85.5 },
      { cupper: "c", total: 84.5 },
      { cupper: "d", total: 85.25 },
      { cupper: "outlier", total: 74 },
    ];
    const totals = panel.map((p) => p.total);
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    const sd = Math.sqrt(totals.reduce((acc, t) => acc + (t - mean) ** 2, 0) / totals.length);

    // Demonstrate the failure of the naive rule...
    expect(Math.abs(74 - mean) > 2 * sd).toBe(false);
    // ...and that the robust one catches it.
    expect(aggregatePanel(panel)?.outliers.map((o) => o.cupper)).toEqual(["outlier"]);
  });

  it("flags nobody when the panel merely spreads wide but agrees in shape", () => {
    const result = aggregatePanel([
      { cupper: "a", total: 80 },
      { cupper: "b", total: 84 },
      { cupper: "c", total: 88 },
    ]);
    // Wide, but no single cupper is apart from the rest — this is a panel that
    // disagrees, not one with a bad reading. The spread says so.
    expect(result?.outliers).toEqual([]);
    expect(result?.stdDev).toBeGreaterThan(3);
  });

  it("does not flag anyone in a unanimous panel", () => {
    expect(
      aggregatePanel([
        { cupper: "a", total: 85 },
        { cupper: "b", total: 85 },
        { cupper: "c", total: 85 },
      ])?.outliers,
    ).toEqual([]);
  });
});
