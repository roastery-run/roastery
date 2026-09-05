import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * `next` is a path on this origin, or it is nothing.
 *
 * The value is handed to navigate() after a session is already established, so
 * an unvalidated one turns the login route into an open redirect for exactly
 * the visitor whose trust is worth the most. A protocol-relative
 * "//evil.example" is the case that matters: it looks like a path, and the
 * browser reads it as another origin.
 *
 * Mirrors the schema in login.tsx; the redirect it guards is one line away
 * from the parse, so the parse is what there is to test.
 */
const nextSchema = z
  .string()
  .refine((v) => v.startsWith("/") && !v.startsWith("//"))
  .catch("/")
  .default("/");

describe("login next parameter", () => {
  it("keeps an ordinary path", () => {
    expect(nextSchema.parse("/inventory/green")).toBe("/inventory/green");
    expect(nextSchema.parse("/")).toBe("/");
  });

  it("refuses another origin", () => {
    for (const hostile of [
      "//evil.example",
      "//evil.example/inventory",
      "https://evil.example",
      "http://evil.example",
      "javascript:alert(1)",
    ]) {
      expect(nextSchema.parse(hostile), hostile).toBe("/");
    }
  });

  it("falls back rather than throwing on rubbish", () => {
    expect(nextSchema.parse("")).toBe("/");
    expect(nextSchema.parse("inventory")).toBe("/");
  });
});
