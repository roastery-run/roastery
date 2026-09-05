import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every limiter the code names must exist in every config.
 *
 * The limit a Worker enforces comes from the binding, never from the argument
 * at the call site — so `rateLimit("STREAM_LIMITER", { limit: 60 })` against a
 * config that does not declare STREAM_LIMITER does not fail, and does not
 * limit. It silently falls through to the in-memory dev fallback, which is
 * per-isolate and enforces nothing.
 *
 * Two namespaces sharing a number is the same class of mistake pointed the
 * other way: one shared bucket between two surfaces, where the busier one
 * starves the other. That is how a burst of report downloads locked an office
 * out of signing in.
 *
 * Reads the configs rather than a list somebody maintains, so a new
 * environment is covered the moment the file exists.
 */

const API_DIR = join(import.meta.dirname, "..");
const SRC = join(API_DIR, "src");

function configs() {
  return readdirSync(API_DIR)
    .filter((f) => /^wrangler(\..+)?\.jsonc$/.test(f) && !f.endsWith(".example"))
    .map((file) => {
      const raw = readFileSync(join(API_DIR, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      const parsed = JSON.parse(raw) as {
        ratelimits?: { name: string; namespace_id: string }[];
      };
      return { file, limiters: parsed.ratelimits ?? [] };
    })
    .filter((c) => c.limiters.length > 0);
}

/** Every limiter name passed to `rateLimit(...)` anywhere in src. */
function limitersUsedInSource(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        for (const m of readFileSync(full, "utf8").matchAll(/rateLimit\(\s*"([A-Z_]+)"/g)) {
          if (m[1]) found.add(m[1]);
        }
      }
    }
  };
  walk(SRC);
  return found;
}

describe("rate limit configuration", () => {
  const all = configs();

  it("finds a config to check", () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it.each(all)("$file declares every limiter the code uses", ({ limiters }) => {
    const declared = new Set(limiters.map((l) => l.name));
    const missing = [...limitersUsedInSource()].filter((name) => !declared.has(name));
    expect(missing).toEqual([]);
  });

  it.each(all)("$file gives each limiter its own namespace", ({ limiters }) => {
    const ids = limiters.map((l) => l.namespace_id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  it("agrees on the namespace for a given limiter across environments", () => {
    // A limiter that is namespace 1006 in staging and 1003 in production is a
    // budget nobody rehearsed: staging would pass and production would starve.
    const byName = new Map<string, Set<string>>();
    for (const { limiters } of all) {
      for (const limiter of limiters) {
        const seen = byName.get(limiter.name) ?? new Set();
        seen.add(limiter.namespace_id);
        byName.set(limiter.name, seen);
      }
    }
    const disagreements = [...byName.entries()]
      .filter(([, ids]) => ids.size > 1)
      .map(([name, ids]) => `${name}: ${[...ids].join(", ")}`);
    expect(disagreements).toEqual([]);
  });
});
