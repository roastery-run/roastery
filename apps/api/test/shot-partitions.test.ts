import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkerDb } from "../src/lib/db/db";
import { ensureShotPartitions } from "../src/lib/domain/shot-ingest";
import { connect, createTestOrg, dropTestOrg, hasTestDb } from "./helpers/db";

/**
 * Keeping the shot table's partition window ahead of real time.
 *
 * The failure worth testing is not "the partition was not created". It is that
 * creating it becomes IMPOSSIBLE, forever, because of one row.
 *
 * `CREATE TABLE ... PARTITION OF` creates and attaches in one statement, and
 * Postgres refuses the attach while the DEFAULT partition holds any row in the
 * new range. The default exists to catch shots from a bar bridge with a wrong
 * clock — so a single mis-dated shot pins next month's partition shut, the
 * nightly cron retries the same failing statement forever, and every shot
 * lands in the default. Partitioning quietly stops working and the only
 * evidence is a log line.
 */
describe.skipIf(!hasTestDb)("shot partitions", () => {
  let db: WorkerDb;
  let close: () => Promise<void>;
  let orgId: string;

  beforeAll(async () => {
    ({ db, close } = connect());
    orgId = await createTestOrg(db);
  });

  afterAll(async () => {
    if (orgId) await dropTestOrg(db, orgId);
    await close?.();
  });

  const monthName = (offset: number) => {
    const now = new Date();
    const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    return `espresso_shots_${m.getUTCFullYear()}_${String(m.getUTCMonth() + 1).padStart(2, "0")}`;
  };

  async function isAttached(name: string): Promise<boolean> {
    const rows = await db.execute<{ attached: boolean }>(sql`
      select exists (
        select 1 from pg_inherits
        join pg_class child on child.oid = pg_inherits.inhrelid
        where child.relname = ${name}
      ) as attached
    `);
    return [...rows][0]?.attached === true;
  }

  async function countIn(table: string): Promise<number> {
    const rows = await db.execute<{ n: string }>(
      sql.raw(`select count(*)::text as n from ${table}`),
    );
    return Number([...rows][0]?.n ?? "0");
  }

  it("creates and attaches the months ahead", async () => {
    await ensureShotPartitions(db, 3);
    for (const offset of [0, 1, 2, 3]) {
      expect(await isAttached(monthName(offset)), monthName(offset)).toBe(true);
    }
  });

  it("is safe to run again", async () => {
    await expect(ensureShotPartitions(db, 3)).resolves.toBeDefined();
  });

  it("attaches a month even when the default partition already holds one of its rows", async () => {
    // Exactly the wedge: a shot arrives dated in a month whose partition does
    // not exist yet, lands in the default, and then blocks that partition from
    // ever being created.
    const far = 8;
    const now = new Date();
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + far, 15));
    const name = monthName(far);

    // The database outlives the test run, so a partition left by a previous
    // run would send the row straight into it and there would be no wedge to
    // reproduce. Start from the state the bug needs: no partition, row in the
    // default.
    await db.execute(sql.raw(`DROP TABLE IF EXISTS ${name}`));

    await db.execute(sql`
      insert into espresso_shots
        (org_id, site_id, machine_id, external_id, pulled_at, dose_g, yield_g, duration_s)
      values (${orgId}::uuid, gen_random_uuid(), gen_random_uuid(), ${`wedge-${Date.now()}`},
              ${month.toISOString()}, 18.0, 36.0, 27.0)
    `);
    expect(await countIn("espresso_shots_overflow")).toBeGreaterThan(0);

    await ensureShotPartitions(db, far);

    expect(await isAttached(name)).toBe(true);
    // The row moved rather than being lost: it is a real shot somebody pulled.
    expect(await countIn(name)).toBe(1);
    expect(await countIn("espresso_shots_overflow")).toBe(0);
  });
});
