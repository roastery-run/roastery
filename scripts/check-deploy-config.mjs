/**
 * Refuses to deploy a config that still carries provisioning placeholders.
 *
 * A production config is authored before its Cloudflare resources exist, so
 * the ids start as `TODO_ID_*`. Wrangler accepts an unknown Hyperdrive or KV
 * id at deploy time without complaint and fails at the first query instead —
 * a total outage, discovered by whoever loads the first page rather than by
 * the person deploying.
 *
 * This is a deploy-time gate rather than a test because the ids genuinely do
 * not exist until someone provisions them, and a suite that is red until then
 * is one people learn to run with.
 *
 *   node scripts/check-deploy-config.mjs <config> [<config> ...]
 */
import { readFileSync } from "node:fs";

const configs = process.argv.slice(2);
if (configs.length === 0) {
  console.error("usage: check-deploy-config.mjs <wrangler config> [...]");
  process.exit(1);
}

let failed = false;
for (const config of configs) {
  const raw = readFileSync(config, "utf8");
  const placeholders = [...raw.matchAll(/TODO_ID[A-Z_]*/g)].map((m) => m[0]);
  if (placeholders.length > 0) {
    failed = true;
    console.error(
      `${config} still has placeholder ids: ${[...new Set(placeholders)].join(", ")}\n` +
        "  Provision the resource, then replace the placeholder with its real id.",
    );
  }
}

if (failed) process.exit(1);
console.log(`  ${configs.length} config${configs.length === 1 ? "" : "s"} carry no placeholders`);
