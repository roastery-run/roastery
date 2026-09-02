/**
 * Applies the authorization vocabulary — permissions, roles, grants, plans and
 * plan entitlements — to the database this DATABASE_URL points at.
 *
 * Runs on EVERY migrate, not once. The vocabulary is reference data: a new
 * permission slug added to seed-authz.ts has to reach databases that were
 * migrated last month, or `can()` returns false for a permission no row backs
 * and the operation denies for everyone, owners included. A one-shot migration
 * cannot do that; this can, because every statement is an upsert.
 */
import { config } from "dotenv";
import pg from "pg";
import { AUTHZ_COUNTS, buildAuthzSql } from "./generate-authz-migration.mjs";

config({ path: "../../.env", quiet: true });
config({ path: "../../../.env", quiet: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  // One transaction: a half-applied vocabulary is a role holding grants to
  // permissions that do not exist yet.
  await client.query("BEGIN");
  await client.query(buildAuthzSql());
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}

const { permissions, roles, plans } = AUTHZ_COUNTS;
console.log(`authz seeded (${permissions} permissions, ${roles} roles, ${plans} plans)`);
