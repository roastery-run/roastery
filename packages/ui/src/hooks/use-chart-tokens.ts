/**
 * Resolves the design tokens a canvas chart needs.
 *
 * uPlot draws to a canvas, which cannot read a CSS custom property — so the
 * values have to be computed. Reading them from the live computed style rather
 * than hardcoding hex means a chart is correct in both themes, and correct
 * again the instant the theme changes, without the palette existing twice.
 */
import * as React from "react";

export type ChartTokens = {
  series: string[];
  grid: string;
  axis: string;
  foreground: string;
  background: string;
};

const TOKEN_NAMES = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"] as const;

function read(): ChartTokens {
  if (typeof window === "undefined") {
    return { series: [], grid: "#ccc", axis: "#888", foreground: "#111", background: "#fff" };
  }
  const style = getComputedStyle(document.documentElement);
  const value = (name: string) => style.getPropertyValue(name).trim();
  return {
    series: TOKEN_NAMES.map((name) => value(name)),
    grid: `color-mix(in oklch, ${value("--border")} 70%, transparent)`,
    axis: value("--muted-foreground"),
    foreground: value("--foreground"),
    background: value("--card"),
  };
}

export function useChartTokens(): ChartTokens {
  const [tokens, setTokens] = React.useState<ChartTokens>(read);

  React.useEffect(() => {
    const update = () => setTokens(read());
    update();

    // The theme toggles by adding a class to <html>, so that is what to watch.
    // A media-query listener alone would miss an explicit light/dark choice.
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);

    return () => {
      observer.disconnect();
      media.removeEventListener("change", update);
    };
  }, []);

  return tokens;
}

/**
 * Dash patterns, so series are distinguishable without colour.
 *
 * Printed QC reports are greyscale and roughly 8% of male readers cannot
 * separate the red series from the green one. The palette is already tested
 * for lightness separation; this is the second, independent signal.
 */
export const SERIES_DASH: (number[] | undefined)[] = [
  undefined,
  [6, 3],
  [2, 3],
  [10, 3, 2, 3],
  [1, 3],
];
