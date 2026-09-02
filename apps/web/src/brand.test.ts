/**
 * The wordmark is ROASTERY, uppercase.
 *
 * Easy to get wrong, because "Roastery" is also the ordinary English word for
 * the building — so the mistake reads as correct prose rather than as a typo,
 * and nobody flags it in review.
 *
 * Only DISPLAY text is checked. The machine-facing spellings — package names,
 * the `X-Roastery-Org` header, the `roastery.run` domain — are contracts, and
 * uppercasing any of them would break something.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname);

/** Spellings that are deliberately mixed-case, and why. */
const ALLOWED = [
  /@roastery\//, // workspace package names
  /X-Roastery-Org/, // request header
  /Roastery-[A-Z]/, // response headers: Signature, Event-Id, Timestamp…
  /roastery-theme/, // cookie, read by the inline boot script
  /roastery\.run/, // the domain
  /Roastery[A-Z]/, // TypeScript identifiers, e.g. RoasteryColumnMeta
  /createRoasteryAuthClient/,
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(tsx?|html)$/.test(full) && !full.endsWith(".test.ts")) yield full;
  }
}

describe("brand casing", () => {
  it("never writes the wordmark as 'Roastery' in display text", () => {
    const offenders: string[] = [];

    for (const file of walk(SRC)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (!line.includes("Roastery")) return;
        // Comments are not display text, and the comment explaining this very
        // rule has to quote the wrong spelling to explain it.
        if (/^\s*(\/\/|\/?\*)/.test(line)) return;
        if (ALLOWED.some((pattern) => pattern.test(line))) return;
        offenders.push(`${file.replace(SRC, "src")}:${index + 1}: ${line.trim()}`);
      });
    }

    expect(
      offenders,
      `The wordmark is ROASTERY, uppercase, in anything a person reads:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
