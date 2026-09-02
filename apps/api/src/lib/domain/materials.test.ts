import { describe, expect, it } from "vitest";
import { explodeRequirements } from "./materials";

describe("BOM explosion", () => {
  it("multiplies each line by the number of runs", () => {
    const out = explodeRequirements(
      [
        { materialId: "bag", quantity: "1", scrapPct: "0" },
        { materialId: "label", quantity: "2", scrapPct: "0" },
      ],
      500,
    );
    expect(out).toEqual([
      { materialId: "bag", requiredQty: "500.0000" },
      { materialId: "label", requiredQty: "1000.0000" },
    ]);
  });

  it("applies scrap per line, not per run", () => {
    // 1000 labels at 2% waste needs 1020, whether that is one run or a hundred.
    const out = explodeRequirements([{ materialId: "label", quantity: "10", scrapPct: "2" }], 100);
    expect(out[0]?.requiredQty).toBe("1020.0000");
  });

  it("handles fractional quantities without drift", () => {
    // 0.25 m of tape per unit, 4000 units.
    const out = explodeRequirements(
      [{ materialId: "tape", quantity: "0.25", scrapPct: "0" }],
      4000,
    );
    expect(out[0]?.requiredQty).toBe("1000.0000");
  });

  it("returns zero requirements for a zero-run plan", () => {
    const out = explodeRequirements([{ materialId: "bag", quantity: "1", scrapPct: "5" }], 0);
    expect(out[0]?.requiredQty).toBe("0.0000");
  });
});
