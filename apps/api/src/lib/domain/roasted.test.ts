import { describe, expect, it } from "vitest";
import { grossUpForLoss, percentOf } from "./roasted";

/**
 * Blend sizing.
 *
 * The mistake this guards against is sizing a blend against its ROASTED target
 * without grossing up for roast loss — which under-orders green on every
 * single run, by exactly the loss percentage.
 */
describe("grossing up for roast loss", () => {
  it("asks for more green than the roasted target", () => {
    // 100 kg of roasted coffee at 15% loss needs ~117.6 kg of green, not 100
    // and not 115: the loss is a fraction of the GREEN weight, not the roasted.
    expect(grossUpForLoss("100", "15")).toBe("117.6471");
  });

  it("round-trips: losing 15% of the grossed-up figure returns the target", () => {
    const green = grossUpForLoss("100", "15");
    const roasted = Number.parseFloat(green) * 0.85;
    expect(roasted).toBeCloseTo(100, 3);
  });

  it("is a no-op when no loss is configured", () => {
    expect(grossUpForLoss("100", "0")).toBe("100.0000");
  });

  it("ignores a nonsensical loss rather than dividing by zero", () => {
    expect(grossUpForLoss("100", "100")).toBe("100.0000");
    expect(grossUpForLoss("100", "-5")).toBe("100.0000");
  });
});

describe("component proportions", () => {
  it("splits a blend by ratio", () => {
    expect(percentOf("117.6471", "60")).toBe("70.5883");
    expect(percentOf("117.6471", "30")).toBe("35.2941");
    expect(percentOf("117.6471", "10")).toBe("11.7647");
  });

  it("keeps fractional ratios exact enough to re-total", () => {
    const total = ["33.3333", "33.3333", "33.3334"]
      .map((pct) => Number.parseFloat(percentOf("300", pct)))
      .reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(300, 3);
  });
});
