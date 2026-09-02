/**
 * OKLCH → sRGB, and WCAG contrast.
 *
 * Here rather than in a test file because the chart components need the same
 * conversion at runtime: uPlot draws to a canvas and cannot use a CSS custom
 * property, so a resolved colour has to be computed from the token.
 */

export type Oklch = { l: number; c: number; h: number };

export function parseOklch(value: string): Oklch | null {
  const match = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/.exec(value);
  if (!match) return null;
  const [, l, c, h] = match;
  return { l: Number(l), c: Number(c), h: Number(h) };
}

/** OKLCH to linear sRGB, via Oklab. */
export function oklchToLinearRgb({ l, c, h }: Oklch): [number, number, number] {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const lCubed = l_ ** 3;
  const mCubed = m_ ** 3;
  const sCubed = s_ ** 3;

  return [
    4.0767416621 * lCubed - 3.3077115913 * mCubed + 0.2309699292 * sCubed,
    -1.2684380046 * lCubed + 2.6097574011 * mCubed - 0.3413193965 * sCubed,
    -0.0041960863 * lCubed - 0.7034186147 * mCubed + 1.707614701 * sCubed,
  ];
}

const gamma = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function oklchToHex(value: string): string | null {
  const parsed = parseOklch(value);
  if (!parsed) return null;
  const [r, g, b] = oklchToLinearRgb(parsed);
  const channel = (v: number) =>
    Math.round(Math.min(1, Math.max(0, gamma(v))) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** WCAG relative luminance, from LINEAR rgb (no gamma applied). */
export function relativeLuminance(value: string): number | null {
  const parsed = parseOklch(value);
  if (!parsed) return null;
  const [r, g, b] = oklchToLinearRgb(parsed);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);
}

/** WCAG 2.2 contrast ratio, 1–21. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Perceptual lightness, for asserting chart series separate in greyscale. */
export function lightness(value: string): number | null {
  return parseOklch(value)?.l ?? null;
}
