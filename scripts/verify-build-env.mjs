/**
 * Asserts a built bundle targets the environment it is about to be deployed to.
 *
 * Vite bakes `VITE_*` values in at build time, so the ARTIFACT — not the
 * command — decides which API a deployed front end calls. `vite build` with no
 * `--mode` means "production", and turbo's `test` task depends on `build`, so
 * running the gate after building for staging silently replaces dist with a
 * production build. That is how the staging console shipped calling
 * api.roastery.run, which answered 503 and left every screen empty while
 * looking like a working deploy.
 *
 * Checking the artifact catches that however it happened: wrong mode, stale
 * dist, or a gate run in between.
 *
 *   node scripts/verify-build-env.mjs <dist-dir> <staging|production>
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const [dir, environment] = process.argv.slice(2);

/**
 * An app legitimately references several origins — the console links at the
 * public site for its QR targets, the marketing site links at all three — so
 * the rule is not "one origin" but "all from one environment".
 */
const ENVIRONMENTS = {
  production: [
    "https://roastery.run",
    "https://app.roastery.run",
    "https://api.roastery.run",
    "https://docs.roastery.run",
  ],
  staging: [
    "https://staging.roastery.run",
    "https://app-staging.roastery.run",
    "https://api-staging.roastery.run",
    "https://docs-staging.roastery.run",
  ],
};

if (!dir || !ENVIRONMENTS[environment]) {
  console.error(`usage: verify-build-env.mjs <dist-dir> <${Object.keys(ENVIRONMENTS).join("|")}>`);
  process.exit(1);
}

function files(root) {
  return readdirSync(root).flatMap((entry) => {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(js|html|css)$/.test(entry) ? [full] : [];
  });
}

const source = files(dir)
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

// A trailing boundary, so "https://roastery.run" does not also match
// "https://roastery.run.example" and, more importantly, so the production
// apex is not reported for a bundle that only contains a staging subdomain.
const present = (origins) =>
  origins.filter((o) => new RegExp(`${o.replace(/\./g, "\\.")}(?![a-z0-9-])`).test(source));

const mine = present(ENVIRONMENTS[environment]);
const foreign = Object.entries(ENVIRONMENTS)
  .filter(([name]) => name !== environment)
  .flatMap(([name, origins]) => present(origins).map((o) => `${o} (${name})`));

if (foreign.length > 0) {
  console.error(
    `${dir} references another environment: ${foreign.join(", ")}\n` +
      `  Rebuild with --mode ${environment}; a bare "vite build" means production.`,
  );
  process.exit(1);
}

if (mine.length === 0) {
  console.error(
    `${dir} references no ${environment} origin at all.\n` +
      `  Expected one of: ${ENVIRONMENTS[environment].join(", ")}`,
  );
  process.exit(1);
}

console.log(`  ${dir} → ${environment} (${mine.length} origin${mine.length === 1 ? "" : "s"})`);
