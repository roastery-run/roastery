/**
 * The arithmetic between a person and the ledger.
 *
 * Every case here is a number somebody could type at a scale, and the delta it
 * has to become. Exactness matters more than usual: the output of this function
 * is written into an append-only ledger that a balance is derived from, so a
 * rounding error does not get corrected later, it gets accumulated.
 */
import { describe, expect, it } from "vitest";
import { buildAdjustment, REASONS } from "./lot-adjustment";

const ok = (result: ReturnType<typeof buildAdjustment>) => {
  if (!result.ok) throw new Error(`expected ok, got: ${result.problem}`);
  return result;
};

describe("buildAdjustment", () => {
  describe("recount states the destination, not the journey", () => {
    it("derives a negative delta when the count is short", () => {
      const result = ok(
        buildAdjustment({ reason: "recount", amount: "1187.5", onHandKg: "1200.0000" }),
      );
      expect(result.deltaKg).toBe("-12.5000");
      expect(result.resultingKg).toBe("1187.5000");
    });

    it("derives a positive delta when the count is over", () => {
      const result = ok(
        buildAdjustment({ reason: "recount", amount: "1210", onHandKg: "1200.0000" }),
      );
      expect(result.deltaKg).toBe("10.0000");
      expect(result.resultingKg).toBe("1210.0000");
    });

    it("refuses a count that matches, rather than writing a zero row", () => {
      const result = buildAdjustment({ reason: "recount", amount: "1200", onHandKg: "1200.0000" });
      expect(result).toEqual({
        ok: false,
        problem: "That is what is already recorded, so there is nothing to adjust.",
      });
    });

    it("allows counting a lot down to nothing", () => {
      expect(
        ok(buildAdjustment({ reason: "recount", amount: "0", onHandKg: "40.0000" })).deltaKg,
      ).toBe("-40.0000");
    });
  });

  describe("removal reasons carry their own sign", () => {
    it.each(["shrinkage", "write_off", "sample_draw"] as const)(
      "%s negates a positive entry, so nobody types a minus",
      (reason) => {
        const result = ok(buildAdjustment({ reason, amount: "12.5", onHandKg: "1200.0000" }));
        expect(result.deltaKg).toBe("-12.5");
        expect(result.resultingKg).toBe("1187.5000");
      },
    );

    it("refuses to remove more than the lot holds, and says how much there is", () => {
      const result = buildAdjustment({ reason: "write_off", amount: "50", onHandKg: "40.0000" });
      expect(result).toEqual({
        ok: false,
        problem: "This lot holds 40.0000 kg, so it cannot lose that much.",
      });
    });

    it("allows removing the whole lot", () => {
      expect(
        ok(buildAdjustment({ reason: "write_off", amount: "40", onHandKg: "40.0000" })).resultingKg,
      ).toBe("0.0000");
    });
  });

  it("adds on a return", () => {
    const result = ok(buildAdjustment({ reason: "return", amount: "25", onHandKg: "100.0000" }));
    expect(result.deltaKg).toBe("25");
    expect(result.resultingKg).toBe("125.0000");
  });

  describe("the signed escape hatch", () => {
    it("takes a negative as written", () => {
      expect(
        ok(buildAdjustment({ reason: "adjust", amount: "-3.25", onHandKg: "10.0000" })).resultingKg,
      ).toBe("6.7500");
    });

    it("still refuses to drive the lot below zero", () => {
      expect(buildAdjustment({ reason: "adjust", amount: "-30", onHandKg: "10.0000" }).ok).toBe(
        false,
      );
    });
  });

  describe("input the scale room actually produces", () => {
    it("accepts a hand-typed thousands separator", () => {
      expect(
        ok(buildAdjustment({ reason: "recount", amount: "1,187.5", onHandKg: "1200.0000" }))
          .deltaKg,
      ).toBe("-12.5000");
    });

    it.each(["", "   ", "abc", "-", ".", "1.2.3"])("rejects %o without throwing", (amount) => {
      expect(buildAdjustment({ reason: "recount", amount, onHandKg: "1200.0000" })).toEqual({
        ok: false,
        problem: "Enter a weight in kilograms.",
      });
    });

    it("rejects zero and negatives on a removal", () => {
      expect(buildAdjustment({ reason: "shrinkage", amount: "0", onHandKg: "10.0000" }).ok).toBe(
        false,
      );
      expect(buildAdjustment({ reason: "shrinkage", amount: "-5", onHandKg: "10.0000" }).ok).toBe(
        false,
      );
    });

    it("is exact where a float would not be", () => {
      // 0.1 + 0.2 is where an auditable ledger stops being auditable.
      const result = ok(buildAdjustment({ reason: "return", amount: "0.1", onHandKg: "0.2" }));
      expect(result.resultingKg).toBe("0.3");
    });

    it("keeps four-decimal canonical precision through a subtraction", () => {
      const result = ok(
        buildAdjustment({ reason: "recount", amount: "1787.4999", onHandKg: "1787.5000" }),
      );
      expect(result.deltaKg).toBe("-0.0001");
    });
  });

  it("requires a comment for exactly the two reasons a reader will question", () => {
    const required = Object.entries(REASONS)
      .filter(([, meta]) => meta.requiresComment)
      .map(([reason]) => reason)
      .sort();
    expect(required).toEqual(["sample_draw", "write_off"]);
  });
});
