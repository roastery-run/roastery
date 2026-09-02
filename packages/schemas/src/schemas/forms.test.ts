import { describe, expect, it } from "vitest";
import { type FormField, firstResponseProblem, formFieldSchema, templateToZod } from "./forms";

const field = (
  partial: Partial<FormField> & Pick<FormField, "key" | "label" | "type">,
): FormField => partial as FormField;

describe("formFieldSchema", () => {
  it("rejects a key that cannot be a stable response key", () => {
    expect(
      formFieldSchema.safeParse({ key: "Gut Feeling", label: "x", type: "text" }).success,
    ).toBe(false);
    expect(
      formFieldSchema.safeParse({ key: "gut_feeling", label: "x", type: "text" }).success,
    ).toBe(true);
  });

  it("rejects a select with no options, which would render an empty dropdown", () => {
    expect(formFieldSchema.safeParse({ key: "a", label: "A", type: "select" }).success).toBe(false);
  });

  it("rejects an inverted range rather than accepting a field nothing can satisfy", () => {
    const inverted = { key: "a", label: "A", type: "number", min: 10, max: 1 };
    expect(formFieldSchema.safeParse(inverted).success).toBe(false);
  });
});

describe("templateToZod", () => {
  it("enforces a number's declared range", () => {
    const schema = templateToZod([
      field({ key: "gut", label: "Gut feeling", type: "number", min: 1, max: 5, required: true }),
    ]);
    expect(schema.safeParse({ gut: 3 }).success).toBe(true);
    expect(schema.safeParse({ gut: 9 }).success).toBe(false);
  });

  it("requires only the fields marked required", () => {
    const schema = templateToZod([
      field({ key: "a", label: "A", type: "text", required: true }),
      field({ key: "b", label: "B", type: "text" }),
    ]);
    expect(schema.safeParse({ a: "yes" }).success).toBe(true);
    expect(schema.safeParse({ b: "only optional" }).success).toBe(false);
  });

  it("rejects a select value outside its options instead of coercing it", () => {
    const schema = templateToZod([
      field({ key: "roast", label: "Roast", type: "select", options: ["light", "dark"] }),
    ]);
    expect(schema.safeParse({ roast: "light" }).success).toBe(true);
    expect(schema.safeParse({ roast: "medium" }).success).toBe(false);
  });

  it("keeps answers to fields a later version removed", () => {
    // A template edit that drops a field must not destroy responses already
    // recorded against it — the sheet still has to render as it was filled.
    const v4 = templateToZod([field({ key: "kept", label: "Kept", type: "text" })]);
    const parsed = v4.parse({ kept: "here", dropped_in_v4: "still here" });
    expect(parsed.dropped_in_v4).toBe("still here");
  });

  it("accepts an empty template, so a kind with no custom fields is not an error", () => {
    expect(templateToZod([]).safeParse({}).success).toBe(true);
  });
});

describe("firstResponseProblem", () => {
  const fields = [
    field({ key: "gut", label: "Gut feeling", type: "number", min: 1, max: 5, required: true }),
    field({ key: "note", label: "Buyer note", type: "text" }),
  ];

  it("names the field rather than repeating Zod at the cupper", () => {
    // "expected number, received undefined" is true and unactionable.
    expect(firstResponseProblem(fields, {})).toBe("Gut feeling is required");
  });

  it("reports a value that is present but out of range as a correction", () => {
    expect(firstResponseProblem(fields, { gut: 9 })).toMatch(/^Gut feeling: /);
  });

  it("is silent when the answers are good", () => {
    expect(firstResponseProblem(fields, { gut: 4 })).toBeNull();
  });

  it("is silent when a template has no custom fields at all", () => {
    expect(firstResponseProblem([], {})).toBeNull();
  });
});
