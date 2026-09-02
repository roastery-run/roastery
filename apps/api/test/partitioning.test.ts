/**
 * The espresso_shots partitioning migration cannot drift from the schema.
 *
 * drizzle-kit cannot express `PARTITION BY`, so that table's real DDL lives in
 * a generated migration rather than in the migration drizzle-kit writes. The
 * failure mode is quiet and expensive: someone adds a column to the Drizzle
 * definition, drizzle-kit adds it to a table that is then dropped and
 * recreated without it, and every write of that column fails in production.
 *
 * This test is what makes that impossible.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { espressoShots } from "@roastery/db/schema";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

const MIGRATION = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "packages",
  "db",
  "drizzle",
  "0002_partition_shots.sql",
);

describe("espresso_shots partitioning", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const config = getTableConfig(espressoShots);

  it("declares every column the Drizzle definition has", () => {
    const createBlock = sql.slice(
      sql.indexOf("CREATE TABLE espresso_shots ("),
      sql.indexOf(") PARTITION BY"),
    );
    const missing = config.columns
      .map((c) => c.name)
      .filter((name) => !createBlock.includes(`"${name}"`));
    expect(
      missing,
      `Columns in the schema but not in the migration:\n${missing.join("\n")}\n\n` +
        "Regenerate with: pnpm --filter @roastery/db exec tsx scripts/generate-partition-migration.mjs",
    ).toEqual([]);
  });

  it("declares no column the schema does not have", () => {
    const createBlock = sql.slice(
      sql.indexOf("CREATE TABLE espresso_shots ("),
      sql.indexOf(") PARTITION BY"),
    );
    const declared = [...createBlock.matchAll(/^\s+"([a-z_]+)"/gm)].map((m) => m[1] ?? "");
    const known = new Set(config.columns.map((c) => c.name));
    const extra = declared.filter((name) => !known.has(name));
    expect(extra, `Columns in the migration but not in the schema:\n${extra.join("\n")}`).toEqual(
      [],
    );
  });

  it("partitions by pulled_at", () => {
    expect(sql).toContain("PARTITION BY RANGE (pulled_at)");
  });

  it("keeps the partition key inside every unique constraint", () => {
    // Postgres cannot enforce uniqueness across partitions without it, so a
    // unique index that omits pulled_at is not merely suboptimal — it is
    // rejected at migration time, which is a bad place to find out.
    const uniques = [...sql.matchAll(/CREATE UNIQUE INDEX \w+ ON espresso_shots \(([^)]+)\)/g)];
    expect(uniques.length).toBeGreaterThan(0);
    for (const [, columns] of uniques) {
      expect(columns, `Unique index without the partition key: ${columns}`).toContain("pulled_at");
    }
    expect(sql).toMatch(/PRIMARY KEY \("id", "pulled_at"\)/);
  });

  it("has a default partition, so a bridge with a wrong clock does not lose data", () => {
    expect(sql).toContain("PARTITION OF espresso_shots DEFAULT");
  });

  it("keeps the dedupe constraint that makes a replayed buffer a no-op", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX espresso_shots_dedupe_idx[\s\S]*?"org_id", "machine_id", "external_id", "pulled_at"/,
    );
  });
});
