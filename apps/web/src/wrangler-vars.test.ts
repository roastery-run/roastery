import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The API origin this Worker will call at runtime.
 *
 * `API_URL` is a Worker var, not a `VITE_` value, because the trace page fetches
 * it server-side and the browser must never learn the internal API host. That
 * has a cost: `verify-build-env.mjs` reads the built bundle, so it cannot see
 * this value at all, and a config that omits it would send every QR scan — the
 * most-loaded page in the product, opened from a printed bag — to a host that
 * does not exist.
 *
 * So the config is what gets checked, and the origin has to belong to the same
 * environment as the Worker's own route, since a staging site rendering
 * production certificates is the other half of the same mistake.
 */

const APP_DIR = join(import.meta.dirname, "..");

const ORIGINS = {
  production: { api: "https://api.roastery.run", route: "roastery.run" },
  staging: { api: "https://api-staging.roastery.run", route: "staging.roastery.run" },
};

function parse(file: string) {
  const raw = readFileSync(join(APP_DIR, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  return JSON.parse(raw) as {
    vars?: Record<string, string>;
    routes?: { pattern: string }[];
  };
}

const deployed = readdirSync(APP_DIR)
  .filter((f) => /^wrangler\.(staging|production)\.jsonc$/.test(f))
  .map((file) => ({ file, environment: file.split(".")[1] as keyof typeof ORIGINS }));

describe("web worker vars", () => {
  it("exist for both deployed environments", () => {
    expect(deployed.map((d) => d.environment).sort()).toEqual(["production", "staging"]);
  });

  it.each(deployed)("$file sets API_URL to its own environment's API", ({ file, environment }) => {
    const config = parse(file);
    expect(config.vars?.API_URL).toBe(ORIGINS[environment].api);
    expect(config.routes?.[0]?.pattern).toBe(ORIGINS[environment].route);
  });
});
