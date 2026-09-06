/**
 * Every operation the console calls has to exist on the API.
 *
 * Written after `/inventory/costs` was found calling
 * `inventory.costing.getGreenLotLandedCost` — a namespace the API has never
 * registered. That screen 404'd on every visit for its whole life, and nobody
 * noticed, because the failure branch rendered "No cost recorded for this lot":
 * a sentence a person believes.
 *
 * That is the shape worth guarding. An operation string is invisible to the
 * compiler, survives review because it looks like the others, and arrives as a
 * plausible empty state rather than a crash.
 *
 * The API source is read rather than `apps/docs/openapi.snapshot.json` because
 * the snapshot deliberately omits the `console.*` operations marked
 * `internal: true` — checking against it would leave the console's own
 * namespace, the one most likely to be renamed, unguarded.
 */
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CONSOLE_SRC = new URL(".", import.meta.url).pathname;
const API_RPC = new URL("../../api/src/rpc", import.meta.url).pathname;

/** `registerRpc` always states both, adjacent, as literals. */
const REGISTRATION = /namespace:\s*"([^"]+)",\s*\n\s*operation:\s*"([^"]+)"/g;

/**
 * Every function that takes an operation name as its first argument.
 *
 * The direct client, its mutating twin, and the hooks that wrap them. This list
 * is the test's blind spot: a new wrapper hook that is not named here hides its
 * call sites from the check, which is how four freshly-added mutations sat
 * unguarded for the length of one commit. Add the hook here when you write it.
 */
const CALLERS = ["rpc", "rpcMutate", "useListQuery", "useLotAction"] as const;
const CALL_SITE = new RegExp(
  String.raw`\b(?:${CALLERS.join("|")})\s*(?:<[^>(]*>)?\s*\(\s*["']([^"']+)["']`,
  "g",
);

async function sourceFiles(dir: string, skipTests: boolean): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path, skipTests);
      if (!/\.tsx?$/.test(entry.name)) return [];
      if (skipTests && /\.test\.tsx?$/.test(entry.name)) return [];
      return [path];
    }),
  );
  return nested.flat();
}

describe("console RPC operations", () => {
  it("only calls operations the API registers", async () => {
    const registered = new Set<string>();
    for (const file of await sourceFiles(API_RPC, true)) {
      for (const match of readFileSync(file, "utf8").matchAll(REGISTRATION)) {
        registered.add(`${match[1]}.${match[2]}`);
      }
    }
    // A parser that silently matched nothing would make this test pass forever.
    expect(registered.size).toBeGreaterThan(100);

    const called = new Map<string, Set<string>>();
    for (const file of await sourceFiles(CONSOLE_SRC, true)) {
      for (const match of readFileSync(file, "utf8").matchAll(CALL_SITE)) {
        const operation = match[1];
        // The client is used for non-RPC helpers too; an operation always
        // carries a namespace and never a path separator.
        if (!operation?.includes(".") || operation.includes("/")) continue;
        called.set(
          operation,
          (called.get(operation) ?? new Set()).add(file.replace(CONSOLE_SRC, "")),
        );
      }
    }
    expect(called.size).toBeGreaterThan(20);
    // The wrapper hooks are the part most likely to silently stop being
    // scanned, so name one operation that only reaches the API through each.
    expect([...called.keys()]).toContain("inventory.green.adjustGreenLotQuantity");
    expect([...called.keys()]).toContain("inventory.green.listGreenLots");

    const unknown = [...called.entries()]
      .filter(([operation]) => !registered.has(operation))
      .map(([operation, files]) => `${operation} — called from ${[...files].sort().join(", ")}`)
      .sort();

    expect(unknown).toEqual([]);
  });
});
