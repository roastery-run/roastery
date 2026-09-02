import type { LabelBlock } from "@roastery/schemas";
import { describe, expect, it } from "vitest";
import {
  estimateLines,
  type LabelData,
  missingRequired,
  qrScannability,
  resolveBinding,
} from "./label-layout";

const data: LabelData = {
  coffee: {
    name: "Kochere",
    lotCode: "ETH-2026-04",
    roastLevel: "medium",
    roastedAt: "2026-08-14T06:30:00.000Z",
  },
  origins: [
    {
      producer: "Worka Cooperative",
      country: "ET",
      region: "Yirgacheffe",
      altitude: "1950",
      process: "washed",
      varieties: ["Kurume", "Wolisho"],
    },
  ],
  roast: { batchNumber: "B-1042" },
  quality: { cuppingScore: "87.25", notes: ["bergamot", "peach"] },
};

function block(partial: Partial<LabelBlock>): LabelBlock {
  return { id: "b", kind: "field", size: "md", weight: "regular", align: "left", ...partial };
}

describe("resolveBinding", () => {
  it("renders a roast date without its time", () => {
    // A bag carries a date. Printing an ISO timestamp claims a precision the
    // roast log has and the bag does not.
    expect(resolveBinding(data, "coffee.roastedAt")).toBe("2026-08-14");
  });

  it("joins varieties and tasting notes rather than dropping all but the first", () => {
    expect(resolveBinding(data, "origin.varieties")).toBe("Kurume, Wolisho");
    expect(resolveBinding(data, "quality.notes")).toBe("bergamot · peach");
  });

  it("returns null for an absent value instead of an empty-looking string", () => {
    const blend: LabelData = { ...data, origins: [], quality: null, roast: null };
    expect(resolveBinding(blend, "origin.producer")).toBeNull();
    expect(resolveBinding(blend, "quality.cuppingScore")).toBeNull();
    expect(resolveBinding(blend, "roast.batchNumber")).toBeNull();
  });
});

describe("estimateLines", () => {
  it("keeps a short name on one line and wraps a long producer", () => {
    expect(estimateLines("Kochere", 50, 4.4)).toBe(1);
    expect(estimateLines("Finca El Paraíso Gesha Natural Anaerobic 96h", 50, 4.4)).toBeGreaterThan(
      2,
    );
  });

  it("counts nothing for an empty value", () => {
    expect(estimateLines("", 50, 3.2)).toBe(0);
  });
});

describe("qrScannability", () => {
  it("calls a 10 mm code carrying a 33-module payload unscannable", () => {
    // 33 modules plus 8 of quiet zone in 10 mm is 0.24 mm per module — well
    // under what a phone camera resolves off matte bag stock.
    expect(qrScannability(33, 10).verdict).toBe("unscannable");
  });

  it("accepts the same payload once it has room", () => {
    expect(qrScannability(33, 22).verdict).toBe("ok");
    expect(qrScannability(33, 18).verdict).toBe("tight");
  });

  it("charges the quiet zone to the code, not to the margin", () => {
    expect(qrScannability(33, 20.5).moduleMm).toBeCloseTo(0.5, 2);
  });
});

describe("missingRequired", () => {
  const compliant: LabelBlock[] = [
    block({ id: "1", binding: "coffee.name" }),
    block({ id: "2", binding: "origin.country" }),
    block({ id: "3", binding: "coffee.roastedAt" }),
    block({ id: "4", kind: "text", text: "Net 250 g" }),
  ];

  it("passes a label carrying identity, origin, roast date and a net weight", () => {
    expect(missingRequired(compliant)).toEqual([]);
  });

  it("flags a missing net weight, which no binding can supply", () => {
    const withoutWeight = compliant.filter((b) => b.kind !== "text");
    expect(missingRequired(withoutWeight).map((r) => r.key)).toEqual(["netWeight"]);
  });

  it("does not accept a bare number as a net weight", () => {
    const bare = [...compliant.slice(0, 3), block({ id: "4", kind: "text", text: "250" })];
    expect(missingRequired(bare).map((r) => r.key)).toEqual(["netWeight"]);
  });

  it("names every gap at once rather than one per save", () => {
    expect(missingRequired([]).map((r) => r.key)).toEqual([
      "identity",
      "origin",
      "roastDate",
      "netWeight",
    ]);
  });
});
