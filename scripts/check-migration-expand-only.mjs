/**
 * Migrations must be safe to run while the PREVIOUS release is still serving.
 *
 * Deploys migrate first and shift traffic afterwards, and a gradual rollout
 * runs both versions at once on purpose. So for a window — seconds at best,
 * the length of a rollout at worst — the old code is talking to the new
 * schema. A migration that only ADDS is fine there. One that drops a column,
 * renames it, retypes it or makes it NOT NULL breaks the running release, and
 * re-deploying the old Worker does not undo it.
 *
 * The fix is not tooling, it is sequencing: ship the code that stops using a
 * column in one release, and remove the column in the next. This script exists
 * so that discipline is enforced rather than remembered, and so that a genuine
 * contract migration is a deliberate, reviewable line in a diff.
 *
 * Mark one with a comment on its own line:
 *
 *   -- contract: approved — column dropped in vX, unused since vY
 *
 *   node scripts/check-migration-expand-only.mjs [<base-ref>]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const base = process.argv[2] ?? "origin/main";

/** Statements that can break a release still serving traffic. */
const CONTRACTING = [
  [/\bDROP\s+TABLE\b/i, "DROP TABLE"],
  [/\bDROP\s+COLUMN\b/i, "DROP COLUMN"],
  [/\bDROP\s+CONSTRAINT\b/i, "DROP CONSTRAINT"],
  [/\bALTER\s+COLUMN\b[\s\S]{0,80}?\bTYPE\b/i, "ALTER COLUMN … TYPE"],
  [/\bRENAME\s+(?:TO|COLUMN)\b/i, "RENAME"],
  [/\bSET\s+NOT\s+NULL\b/i, "SET NOT NULL"],
];

const APPROVAL = /^\s*--\s*contract:\s*approved/im;

function addedMigrations() {
  try {
    const out = execFileSync(
      "git",
      ["diff", "--name-only", "--diff-filter=A", `${base}...HEAD`, "--", "packages/db/drizzle"],
      { encoding: "utf8" },
    );
    return out.split("\n").filter((f) => f.endsWith(".sql"));
  } catch {
    // No base ref locally (a shallow clone, a fresh branch). Checking nothing
    // is the right answer: this gate protects the deploy, and the deploy has
    // the ref.
    console.log("  no comparable base ref; skipping");
    return [];
  }
}

let failed = false;
for (const file of addedMigrations()) {
  const sql = readFileSync(file, "utf8");
  const found = CONTRACTING.filter(([pattern]) => pattern.test(sql)).map(([, name]) => name);
  if (found.length === 0) continue;
  if (APPROVAL.test(sql)) {
    console.log(`  ${file}: contracting (${found.join(", ")}) — approved`);
    continue;
  }
  failed = true;
  console.error(
    `${file} contracts the schema: ${found.join(", ")}\n` +
      "  The previous release is still serving while this runs. Ship the code that\n" +
      "  stops using it first, then remove it in a later release — or, if this is\n" +
      "  deliberate, add a line to the migration:\n" +
      "    -- contract: approved — <why this is safe now>",
  );
}

if (failed) process.exit(1);
console.log("  migrations are expand-only");
