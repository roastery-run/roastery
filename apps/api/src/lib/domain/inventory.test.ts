import { describe, expect, it } from "vitest";
import { kg } from "./inventory";

/**
 * The weight arithmetic underpins every balance in the product, and the
 * auditability argument rests on it being EXACT. These are the cases where
 * floating point would quietly disagree.
 */
describe("kg arithmetic is exact", () => {
  it("adds values that float cannot represent", () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE 754.
    expect(kg.add("0.1", "0.2")).toBe("0.3000");
  });

  it("stays exact across many small additions", () => {
    let total = "0";
    for (let i = 0; i < 1000; i++) total = kg.add(total, "0.0001");
    expect(total).toBe("0.1000");
  });

  it("handles container-scale weights without losing grams", () => {
    // A 40-tonne container, minus one 0.1 g sample draw.
    expect(kg.sub("40000.0000", "0.0001")).toBe("39999.9999");
  });

  it("subtracts to exactly zero", () => {
    expect(kg.sub("69.0000", "69")).toBe("0.0000");
    expect(kg.cmp(kg.sub("69", "69"), "0")).toBe(0);
  });

  it("keeps sign on negative results", () => {
    expect(kg.sub("1", "3.5")).toBe("-2.5000");
    expect(kg.isNegative(kg.sub("1", "3.5"))).toBe(true);
    expect(kg.isNegative("0.0000")).toBe(false);
  });

  it("compares without float drift", () => {
    expect(kg.cmp("0.3", kg.add("0.1", "0.2"))).toBe(0);
    expect(kg.cmp("10", "9.9999")).toBe(1);
    expect(kg.cmp("9.9999", "10")).toBe(-1);
  });

  it("normalizes whatever the database returns", () => {
    expect(kg.normalize("5")).toBe("5.0000");
    expect(kg.normalize("5.1")).toBe("5.1000");
    expect(kg.normalize("5.12345")).toBe("5.1234");
    expect(kg.normalize(5.5)).toBe("5.5000");
  });

  it("does not lose precision on a realistic bag calculation", () => {
    // 275 bags at 69 kg — the figure that must not render as 18974.9999.
    let total = "0";
    for (let i = 0; i < 275; i++) total = kg.add(total, "69");
    expect(total).toBe("18975.0000");
  });
});

/**
 * Multiplication and division, which the ledger and the valuation reports both
 * depend on being exact.
 *
 * The float versions these replace looked right in every hand-checked example
 * and were wrong in aggregate — the failure only shows up when the parts have
 * to add back up to the whole.
 */
describe("kg.mul, kg.div and kg.mulDiv", () => {
  it("multiplies without drifting", () => {
    expect(kg.mul("12.5000", "3.0000")).toBe("37.5000");
    // 0.1 * 0.2 is the canonical float embarrassment: 0.020000000000000004.
    expect(kg.mul("0.1000", "0.2000")).toBe("0.0200");
  });

  it("divides and rounds half-up at the shared scale", () => {
    expect(kg.div("10.0000", "4.0000")).toBe("2.5000");
    expect(kg.div("1.0000", "3.0000")).toBe("0.3333");
    expect(kg.div("2.0000", "3.0000")).toBe("0.6667");
  });

  it("rounds symmetrically for negative weights, which are ordinary here", () => {
    // A consumption is a negative delta; it must not round differently from
    // the receipt that balances it.
    expect(kg.div("-1.0000", "3.0000")).toBe("-0.3333");
    expect(kg.mul("-2.5000", "2.0000")).toBe("-5.0000");
  });

  it("refuses to divide by zero rather than returning Infinity", () => {
    expect(() => kg.div("1.0000", "0")).toThrow(/zero/i);
    expect(() => kg.mulDiv("1.0000", "1.0000", "0")).toThrow(/zero/i);
  });

  it("rounds mulDiv once, so parts still sum to the whole", () => {
    // Composing mul and div rounds twice and loses 0.03 kg on this split —
    // green the ledger would then record as consumed by nothing.
    const parts = ["33.3333", "33.3333", "33.3334"].map((pct) => kg.mulDiv("300.0000", pct, "100"));
    expect(parts.reduce((total, part) => kg.add(total, part), "0")).toBe("300.0000");
  });

  it("keeps a percentage split of an awkward total exact", () => {
    const parts = ["60.0000", "40.0000"].map((pct) => kg.mulDiv("7.7777", pct, "100"));
    expect(parts.reduce((total, part) => kg.add(total, part), "0")).toBe("7.7777");
  });
});
