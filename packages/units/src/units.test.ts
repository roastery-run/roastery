import { describe, expect, it } from "vitest";
import { add, compare, divide, multiply, parseDecimal, round, subtract, sum } from "./decimal";
import { developmentRatio, formatElapsed, parseElapsed } from "./duration";
import { formatCountry, formatRelative, formatWeight, humanize } from "./format";
import { formatUnitPrice } from "./money";
import { convertRateOfRise, fromCelsius, toCelsius } from "./temperature";
import { fromKg, grossUpForLoss, naturalWeightUnit, toKg, weightLossPct } from "./weight";

describe("decimal", () => {
  it("adds without floating-point drift", () => {
    // The reason this module exists at all.
    expect(add("0.1", "0.2")).toBe("0.3");
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it("keeps a long running total exact", () => {
    const values = Array.from({ length: 10_000 }, () => "0.0001");
    expect(sum(values)).toBe("1.0000");
  });

  it("preserves the wider scale", () => {
    expect(add("1.5", "2.25")).toBe("3.75");
    expect(subtract("10", "0.0001")).toBe("9.9999");
  });

  it("multiplies at the requested scale", () => {
    expect(multiply("18.5", "2", 4)).toBe("37.0000");
    expect(multiply("4.4825", "19000", 4)).toBe("85167.5000");
  });

  it("divides and rounds once, not twice", () => {
    expect(divide("1", "3", 6)).toBe("0.333333");
    expect(divide("2", "3", 6)).toBe("0.666667");
  });

  it("refuses to divide by zero rather than returning Infinity", () => {
    expect(divide("1", "0")).toBeNull();
  });

  it("rounds half UP, the way an invoice does", () => {
    // Not banker's rounding: "we round to even" is not an explanation anyone
    // accepts on an invoice.
    expect(round("2.5", 0)).toBe("3");
    expect(round("3.5", 0)).toBe("4");
    expect(round("-2.5", 0)).toBe("-3");
    expect(round("1.005", 2)).toBe("1.01");
  });

  it("compares by value, not by string", () => {
    expect(compare("10", "9")).toBe(1);
    expect(compare("1.50", "1.5")).toBe(0);
    expect(compare("-1", "1")).toBe(-1);
  });

  it("parses what a person types, and rejects what it cannot", () => {
    expect(parseDecimal(" 1,250.5 ")).toBe("1250.5");
    expect(parseDecimal("18.5")).toBe("18.5");
    expect(parseDecimal("abc")).toBeNull();
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("-")).toBeNull();
  });
});

describe("weight", () => {
  it("converts pounds using the exact factor", () => {
    expect(toKg("100", "lb")).toBe("45.3592");
  });

  it("treats grams as the bar unit they are", () => {
    expect(toKg("18.5", "g")).toBe("0.0185");
    expect(fromKg("0.0185", "g")).toBe("18.50");
  });

  it("refuses to convert bags without a bag weight", () => {
    // A bag is not a mass unit. A Colombian bag is 70 kg and a Brazilian 60;
    // assuming either would misreport a lot by 17%.
    expect(toKg("275", "bag")).toBeNull();
    expect(toKg("275", "bag", { bagWeightKg: "69" })).toBe("18975.0000");
    expect(toKg("275", "bag", { bagWeightKg: "60" })).toBe("16500.0000");
  });

  it("picks a readable unit for display only", () => {
    expect(naturalWeightUnit("0.0185")).toBe("g");
    expect(naturalWeightUnit("42.5")).toBe("kg");
    expect(naturalWeightUnit("4200")).toBe("mt");
  });

  it("computes roast loss from charge, not from drop", () => {
    expect(weightLossPct("60", "51")).toBe("15.00");
  });

  it("grosses UP for roast loss rather than scaling down", () => {
    // 100 kg roasted at 15% loss needs 117.6471 kg green, not 115. Getting
    // this backwards under-charges every batch of a production day.
    expect(grossUpForLoss("100", "15")).toBe("117.6471");
    expect(grossUpForLoss("100", "15")).not.toBe("115.0000");
  });

  it("refuses an impossible loss rather than returning a negative charge", () => {
    expect(grossUpForLoss("100", "100")).toBeNull();
  });
});

describe("temperature", () => {
  it("converts points", () => {
    expect(toCelsius(392, "F")).toBeCloseTo(200, 6);
    expect(fromCelsius(200, "F")).toBeCloseTo(392, 6);
  });

  it("converts rate of rise by SCALE ONLY", () => {
    // The offset cancels in a difference. Using the point formula turns a
    // 10 °C/min ramp into 50 °F/min instead of 18 — the most common bug in
    // roast-logging software.
    expect(convertRateOfRise(10, "F")).toBeCloseTo(18, 6);
    expect(convertRateOfRise(10, "F")).not.toBeCloseTo(50, 6);
    expect(convertRateOfRise(10, "C")).toBe(10);
  });
});

describe("duration", () => {
  it("formats roast time as mm:ss, never decimal minutes", () => {
    expect(formatElapsed(522)).toBe("8:42");
    expect(formatElapsed(675)).toBe("11:15");
    expect(formatElapsed(60)).toBe("1:00");
    expect(formatElapsed(null)).toBe("—:—");
  });

  it("round-trips what a roaster types", () => {
    expect(parseElapsed("8:42")).toBe(522);
    expect(parseElapsed("522")).toBe(522);
    expect(parseElapsed("nonsense")).toBeNull();
  });

  it("computes development time ratio", () => {
    expect(developmentRatio(522, 675)).toBeCloseTo(22.67, 2);
  });

  it("refuses a first crack after the drop", () => {
    expect(developmentRatio(700, 675)).toBeNull();
  });
});

describe("formatting", () => {
  it("shows a unit price at the precision it was quoted at", () => {
    // Truncating to two decimals hides the differential entirely; showing six
    // on every price makes a table unreadable.
    expect(formatUnitPrice("4.500000", "USD")).toBe("$4.50");
    expect(formatUnitPrice("4.4825", "USD")).toBe("$4.4825");
  });

  it("falls back to kilograms rather than inventing a bag weight", () => {
    expect(formatWeight("18975", { unit: "bag" })).toBe("18,975.00 kg");
    expect(formatWeight("18975", { unit: "bag", context: { bagWeightKg: "69" } })).toBe(
      "275.0 bags",
    );
  });

  it("shows a partial bag rather than rounding it away", () => {
    // 1,000 kg at 69 kg a bag is 14.49 bags. Rendered as "14" it loses a third
    // of a bag — 34 kg — on the column somebody counts a pallet against.
    expect(formatWeight("1000", { unit: "bag", context: { bagWeightKg: "69" } })).toBe("14.5 bags");
  });

  it("renders a missing value as an em dash, not as zero", () => {
    // Zero is a fact; "we do not know" is not, and a report that shows 0.00 kg
    // for an unmeasured lot is lying.
    expect(formatWeight(null)).toBe("—");
    expect(formatWeight("0")).toBe("0.00 kg");
  });

  it("humanizes enum values", () => {
    expect(humanize("in_progress")).toBe("In progress");
    expect(humanize(null)).toBe("—");
  });

  it("formats a relative time", () => {
    expect(formatRelative(new Date(Date.now() + 3 * 86_400_000))).toContain("3 days");
  });
});

describe("formatCountry", () => {
  it("shows a country name, not the code a customer cannot read", () => {
    // "CO" on a retail bag means nothing to the person holding it.
    expect(formatCountry("CO")).toBe("Colombia");
    expect(formatCountry("ET")).toBe("Ethiopia");
    expect(formatCountry("br")).toBe("Brazil");
  });

  it("falls back to the code rather than to an em dash", () => {
    // An em dash would imply the origin was never recorded, which is a
    // different and worse claim than "we cannot name this code". QQ is
    // genuinely unassigned; ZZ is not — ICU defines it as "Unknown Region".
    expect(formatCountry("QQ")).toBe("QQ");
    expect(formatCountry("Colombia")).toBe("Colombia");
  });

  it("shows an em dash only when there is genuinely nothing", () => {
    expect(formatCountry(null)).toBe("—");
    expect(formatCountry("")).toBe("—");
  });
});

describe("humanize acronyms", () => {
  it("does not lowercase an acronym into a word", () => {
    // "Api" and "Dtr pct" read as bugs in the product rather than as labels.
    expect(humanize("api")).toBe("API");
    expect(humanize("dtr_pct")).toBe("DTR %");
    expect(humanize("pos_reconciliation")).toBe("POS reconciliation");
  });

  it("capitalizes only the first word", () => {
    // Title Case On Every Word reads as a different product.
    expect(humanize("green_contracts")).toBe("Green contracts");
    expect(humanize("in_progress")).toBe("In progress");
  });
});

describe("humanize", () => {
  it("hyphenates the compounds whose underscore is not a space", () => {
    // A blend is pre-roast or post-roast: one adjective, not two words.
    expect(humanize("pre_roast")).toBe("Pre-roast");
    expect(humanize("post_roast")).toBe("Post-roast");
  });

  it("still spaces the ones that are two words", () => {
    // Same underscore, different job. This is why the compounds are listed
    // rather than derived from the shape.
    expect(humanize("write_off")).toBe("Write off");
    expect(humanize("roast_consume")).toBe("Roast consume");
    expect(humanize("in_progress")).toBe("In progress");
  });

  it("keeps acronyms as acronyms", () => {
    expect(humanize("sca")).toBe("SCA");
    expect(humanize("dtr_pct")).toBe("DTR %");
  });
});
