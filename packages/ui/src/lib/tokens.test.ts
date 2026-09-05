/**
 * The accessibility claims in styles.css, verified against the actual file.
 *
 * Written this way on purpose: a comment saying "verified AA" rots the moment
 * someone nudges a token, and nobody re-checks a palette by hand. This parses
 * the real stylesheet, so changing a colour either keeps the guarantee or
 * fails the build.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, lightness, parseOklch } from "./color";

const CSS = readFileSync(join(import.meta.dirname, "..", "styles.css"), "utf8");

/** Reads a token out of `:root` or `.dark`. */
function token(name: string, theme: "light" | "dark"): string {
  const blockStart = theme === "light" ? CSS.indexOf(":root {") : CSS.indexOf(".dark {");
  const block = CSS.slice(blockStart, CSS.indexOf("}", blockStart));
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  if (!match?.[1]) throw new Error(`Token --${name} not found in ${theme}`);
  return match[1].trim();
}

const THEMES = ["light", "dark"] as const;

describe("Kiln palette", () => {
  it.each(THEMES)("body text clears AA in %s", (theme) => {
    const ratio = contrastRatio(token("foreground", theme), token("background", theme));
    expect(ratio).not.toBeNull();
    // 7:1 is AAA. Body text is the one thing read for hours at a stretch.
    expect(ratio ?? 0).toBeGreaterThanOrEqual(7);
  });

  it.each(THEMES)("muted text still clears AA in %s", (theme) => {
    // The token most likely to be nudged too light "because it looks nicer",
    // and the one that carries every secondary label in the product.
    const ratio = contrastRatio(token("muted-foreground", theme), token("background", theme));
    expect(ratio ?? 0).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)("every status colour is legible against its own foreground in %s", (theme) => {
    for (const status of ["primary", "success", "warning", "destructive", "info"]) {
      const ratio = contrastRatio(token(status, theme), token(`${status}-foreground`, theme));
      expect(ratio ?? 0, `--${status} in ${theme}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEMES)("warning is dark enough to read in %s", (theme) => {
    // Yellow-on-white is the most common AA failure in operations dashboards.
    // This is why --warning is deliberately past the "nice yellow" range.
    const ratio = contrastRatio(token("warning", theme), token("warning-foreground", theme));
    expect(ratio ?? 0).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)("borders are visible without being loud in %s", (theme) => {
    const ratio = contrastRatio(token("border", theme), token("background", theme));
    // Not an AA text requirement — a hairline rule is decoration — but a
    // border nobody can see is a table with no columns.
    expect(ratio ?? 0).toBeGreaterThanOrEqual(1.2);
  });
});

describe("chart series", () => {
  const series = (theme: "light" | "dark") =>
    [1, 2, 3, 4, 5].map((n) => token(`chart-${n}`, theme));

  it.each(THEMES)("each series is distinguishable from the ground in %s", (theme) => {
    for (const [i, colour] of series(theme).entries()) {
      const ratio = contrastRatio(colour, token("background", theme));
      expect(ratio ?? 0, `--chart-${i + 1} in ${theme}`).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(THEMES)("series separate in greyscale in %s", (theme) => {
    // QC reports get printed, and a dichromat reader sees roughly this.
    // Colour is never the only signal — the chart components also vary dash
    // pattern — but the palette should not rely on that rescue.
    const lightnesses = series(theme)
      .map((c) => lightness(c) ?? 0)
      .sort((a, b) => a - b);
    for (let i = 1; i < lightnesses.length; i++) {
      const gap = (lightnesses[i] ?? 0) - (lightnesses[i - 1] ?? 0);
      expect(gap, `series ${i} and ${i - 1} in ${theme}`).toBeGreaterThanOrEqual(0.04);
    }
  });
});

describe("warmth", () => {
  it.each(THEMES)("the neutral ground is warm, not blue-gray, in %s", (theme) => {
    // Coffee is a warm product. The cold neutral every B2B template ships with
    // is the specific thing this palette exists to leave behind.
    for (const name of ["background", "foreground", "muted", "border"]) {
      const parsed = parseOklch(token(name, theme));
      expect(parsed, name).not.toBeNull();
      // Hue 70–80 is the warm end; chroma stays low so it reads as neutral.
      expect(parsed?.h ?? 0, `--${name} hue in ${theme}`).toBeGreaterThanOrEqual(60);
      expect(parsed?.h ?? 0, `--${name} hue in ${theme}`).toBeLessThanOrEqual(95);
      expect(parsed?.c ?? 1, `--${name} chroma in ${theme}`).toBeLessThanOrEqual(0.008);
    }
  });

  it("keeps the maia radius base", () => {
    // The whole radius scale is derived from this value, and the maia
    // components' `rounded-4xl` pills only read as pills from 0.625rem up. A
    // preset re-apply or a "tidy" nudge here quietly flattens every control.
    expect(CSS).toMatch(/--radius:\s*0\.625rem/);
  });
});
