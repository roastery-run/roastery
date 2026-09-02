import { describe, expect, it } from "vitest";
import { costMath } from "./costing";

/**
 * Money arithmetic, like weight arithmetic, must be exact. A landed cost that
 * is a cent out per kilogram is a margin figure nobody can reconcile against
 * an invoice.
 */
describe("cost arithmetic is exact", () => {
  it("multiplies a per-unit rate by a weight", () => {
    // $4.25/kg on 18,975 kg.
    expect(costMath.multiply("4.2500", "18975.0000")).toBe("80643.7500");
  });

  it("divides a total across a weight at unit precision", () => {
    expect(costMath.divide("80643.7500", "18975.0000")).toBe("4.250000");
  });

  it("keeps six decimals, because differentials quote finer than money", () => {
    // A differential of +0.4125 $/lb is the reason unit costs are not 2dp.
    expect(costMath.divide("1.0000", "3.0000")).toBe("0.333333");
  });

  it("rounds half-up on the last digit rather than truncating", () => {
    // 2/3 truncates to 0.666666; correct rounding gives 0.666667.
    expect(costMath.divide("2.0000", "3.0000")).toBe("0.666667");
  });

  it("adds without float drift", () => {
    expect(costMath.add("0.1000", "0.2000")).toBe("0.3000");
    let total = "0.0000";
    for (let i = 0; i < 100; i++) total = costMath.add(total, "0.0100");
    expect(total).toBe("1.0000");
  });

  it("does not divide by a zero weight", () => {
    expect(costMath.divide("100.0000", "0.0000")).toBe("0.000000");
  });

  it("handles a realistic component rollup", () => {
    // FOB + differential + freight + duty on a container.
    const total = ["72000.0000", "8643.7500", "3200.0000", "1150.2500"].reduce(
      costMath.add,
      "0.0000",
    );
    expect(total).toBe("84994.0000");
    expect(costMath.divide(total, "18975.0000")).toBe("4.479262");
  });
});
