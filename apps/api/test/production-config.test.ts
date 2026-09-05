import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { assertProductionBindings } from "../src/env";

/**
 * A config that never says which environment it is.
 *
 * Every production safety check used to hang off `ENVIRONMENT === "production"`,
 * so omitting the var did not fail — it disabled all of them, and the Worker
 * booted onto the caching Hyperdrive where a revoked API key keeps working.
 *
 * The other way a deployed config goes wrong — placeholder resource ids that
 * wrangler accepts and that fail at the first query — is checked by
 * `scripts/check-deploy-config.mjs` at deploy time instead. It cannot live
 * here: the production ids do not exist until someone provisions them, and a
 * test that is red until then is a test everyone learns to ignore.
 */

const API_DIR = join(import.meta.dirname, "..");

const bindings = (over: Partial<Env> = {}) =>
  ({
    HYPERDRIVE_CACHE_DISABLED: {} as Env["HYPERDRIVE_CACHE_DISABLED"],
    WEBHOOK_KEK: "a".repeat(44),
    EMAIL: {} as Env["EMAIL"],
    EMAIL_FROM: "roastery@roastery.run",
    ...over,
  }) as Env;

describe("assertProductionBindings", () => {
  it("treats an ABSENT environment as production rather than skipping the checks", () => {
    expect(() =>
      assertProductionBindings(bindings({ HYPERDRIVE_CACHE_DISABLED: undefined })),
    ).toThrow(/HYPERDRIVE_CACHE_DISABLED/);
  });

  it("skips only development and test", () => {
    const broken = { HYPERDRIVE_CACHE_DISABLED: undefined, WEBHOOK_KEK: undefined };
    expect(() =>
      assertProductionBindings(bindings({ ...broken, ENVIRONMENT: "development" })),
    ).not.toThrow();
    expect(() =>
      assertProductionBindings(bindings({ ...broken, ENVIRONMENT: "test" })),
    ).not.toThrow();
    expect(() =>
      assertProductionBindings(bindings({ ...broken, ENVIRONMENT: "staging" })),
    ).toThrow();
  });

  it("requires a way to send mail, so sign-in links are never only logged", () => {
    expect(() =>
      assertProductionBindings(bindings({ ENVIRONMENT: "production", EMAIL: undefined })),
    ).toThrow(/send mail/);
    // The HTTPS provider is the other accepted path.
    expect(() =>
      assertProductionBindings(
        bindings({
          ENVIRONMENT: "production",
          EMAIL: undefined,
          EMAIL_API_URL: "https://mail.example/send",
          EMAIL_API_KEY: "k",
        }),
      ),
    ).not.toThrow();
  });
});

describe("deployed wrangler configs", () => {
  const deployed = readdirSync(API_DIR).filter((f) =>
    /^wrangler\.(staging|production)\.jsonc$/.test(f),
  );

  it("exist for both deployed environments", () => {
    expect(deployed.sort()).toEqual(["wrangler.production.jsonc", "wrangler.staging.jsonc"]);
  });

  it.each(deployed)("%s declares ENVIRONMENT and is served only on its route", (file) => {
    const raw = readFileSync(join(API_DIR, file), "utf8");
    const parsed = JSON.parse(
      raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1"),
    ) as { vars?: Record<string, string>; workers_dev?: boolean };
    expect(parsed.vars?.ENVIRONMENT).toBeTruthy();
    // A workers.dev hostname bypasses the zone, and with it the WAF and the
    // zone rate-limiting rules that the documented budgets assume.
    expect(parsed.workers_dev).toBe(false);
  });
});
