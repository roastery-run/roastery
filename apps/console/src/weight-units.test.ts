/**
 * Every weight on an inventory screen states its unit.
 *
 * `formatWeight` with no `unit` falls through to `naturalWeightUnit`, which
 * returns grams below 1 kg and tonnes at or above 1,000. In prose that is a
 * kindness. In a column it is a trap: two lots at 995 and 1,005 kg render
 * "995.00 kg" and "1.01 mt" one row apart, and the operations manager reading
 * down the column to compare them by eye — the reason numerals are tabular
 * product-wide — misreads by a factor of a thousand and is confident about it.
 *
 * So the unit is never inferred here. Passing `unit: "auto"` is still allowed,
 * because a single figure in prose genuinely reads better in tonnes; the point
 * is that it has to be TYPED, which turns a silent default into a decision
 * somebody made on purpose.
 *
 * Guards the whole console. A column pins its unit and puts the label in
 * `meta.unit`; a single figure in prose may say `unit: "auto"` and let the
 * formatter pick. What is banned is neither — the silent default.
 */
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIRECTORIES = [new URL(".", import.meta.url).pathname];

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
      return [path];
    }),
  );
  return nested.flat();
}

/**
 * Reads a `formatWeight(` call to its closing parenthesis.
 *
 * Depth-counted rather than regexed: half these calls span four lines and
 * contain their own parentheses, and a line-based match reported the tidy ones
 * and missed exactly the ones worth catching.
 */
function callsIn(source: string): string[] {
  const calls: string[] = [];
  const token = "formatWeight(";
  for (let index = source.indexOf(token); index !== -1; index = source.indexOf(token, index + 1)) {
    let depth = 0;
    for (let cursor = index + token.length - 1; cursor < source.length; cursor++) {
      const character = source[cursor];
      if (character === "(") depth++;
      else if (character === ")") {
        depth--;
        if (depth === 0) {
          calls.push(source.slice(index, cursor + 1));
          break;
        }
      }
    }
  }
  return calls;
}

describe("console weights", () => {
  it("never lets formatWeight choose the unit", async () => {
    const offenders: string[] = [];
    let checked = 0;

    for (const directory of DIRECTORIES) {
      for (const file of await sourceFiles(directory)) {
        for (const call of callsIn(readFileSync(file, "utf8"))) {
          checked++;
          if (!/\bunit:\s*["']/.test(call)) {
            offenders.push(`${file.split("/").slice(-1)[0]}: ${call.replace(/\s+/g, " ")}`);
          }
        }
      }
    }

    // A parser that silently matched nothing would make this pass forever.
    expect(checked).toBeGreaterThan(40);
    expect(offenders).toEqual([]);
  });
});
