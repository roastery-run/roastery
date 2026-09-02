/**
 * The marketing site must stay light.
 *
 * The console carries TanStack Table, a virtualizer and uPlot — roughly 190 kB
 * of vendor code a marketing visitor has no use for. The apps are split
 * precisely so that weight never reaches them, and the barrel export from
 * `@roastery/ui` makes it easy to reintroduce by accident: one import of
 * `DataTable` in a landing page drags the lot back in.
 *
 * This reads the BUILT output rather than the source, because tree-shaking is
 * what actually decides and only the bundler knows.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The SSR build emits dist/client (browser) and dist/server. Only the first ships. */
const CLIENT = join(import.meta.dirname, "..", "dist", "client", "assets");

/** Symbols that prove a console-only library was pulled in. */
const FORBIDDEN: [string, string][] = [
  ["uPlot", "the charting library"],
  ["getCoreRowModel", "TanStack Table"],
  ["useVirtualizer", "TanStack Virtual"],
];

/**
 * Read lazily. A `describe` body runs at collection time even when the suite is
 * skipped, so doing this at the top level throws before the skip applies.
 */
function readClientBundle(): string {
  if (!existsSync(CLIENT)) return "";
  return readdirSync(CLIENT)
    .filter((name) => name.endsWith(".js"))
    .map((name) => readFileSync(join(CLIENT, name), "utf8"))
    .join("\n");
}

function clientBytes(): number {
  if (!existsSync(CLIENT)) return 0;
  return readdirSync(CLIENT)
    .filter((name) => name.endsWith(".js"))
    .reduce((sum, name) => sum + readFileSync(join(CLIENT, name)).byteLength, 0);
}

// Nothing to check before a build. Skipped rather than failed, so `pnpm test`
// on a clean checkout is not a false alarm; CI builds before it tests.
describe.skipIf(!existsSync(CLIENT))("marketing client bundle", () => {
  it.each(FORBIDDEN)("does not ship %s (%s)", (symbol, label) => {
    expect(
      readClientBundle().includes(symbol),
      `${label} reached the marketing bundle. A page imported something from ` +
        "@roastery/ui that drags it in — import the specific component instead.",
    ).toBe(false);
  });

  it("keeps the total JavaScript payload modest", () => {
    // Uncompressed; roughly a third of this over the wire after gzip.
    expect(clientBytes()).toBeLessThan(750_000);
  });
});
