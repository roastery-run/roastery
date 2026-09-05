import { dataExports } from "@roastery/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import type { WorkerDb } from "../src/lib/db/db";
import type { OrgDb } from "../src/lib/db/org-db";
import { type ExportManifest, runExport } from "../src/lib/domain/tenant-lifecycle";
import { testEnv } from "./helpers/app";
import {
  connect,
  createTestLocation,
  createTestOrg,
  dropTestOrg,
  hasTestDb,
  orgDb,
  seedLot,
} from "./helpers/db";

/**
 * The export job, against a bucket that records what it was given.
 *
 * The database half of this is straightforward; the object-storage half is
 * where the risk is, and it had never run. It pages the rows and switches to a
 * multipart upload once a table is large enough — a path with an ordering
 * requirement (parts numbered from one, the last one allowed to be short) that
 * is invisible until a customer with real history asks for their data, which
 * is exactly the customer who most needs it to work.
 */

type Put = { key: string; body: string };

/**
 * Enough of R2 to observe what the export writes.
 *
 * Deliberately not a mock that returns whatever is convenient: parts are
 * concatenated in the order they were uploaded, so a bug in part numbering
 * shows up as a corrupted file rather than as a passing test.
 */
function fakeBucket() {
  const puts: Put[] = [];
  const uploads = new Map<string, string[]>();

  const bucket = {
    put: async (key: string, body: string) => {
      puts.push({ key, body });
      return {};
    },
    createMultipartUpload: async (key: string) => {
      uploads.set(key, []);
      return {
        uploadPart: async (partNumber: number, body: string) => {
          const parts = uploads.get(key) ?? [];
          parts[partNumber - 1] = body;
          uploads.set(key, parts);
          return { partNumber, etag: `etag-${partNumber}` };
        },
        complete: async () => {
          puts.push({ key, body: (uploads.get(key) ?? []).join("") });
          return {};
        },
      };
    },
  };

  return { bucket: bucket as unknown as Env["ROASTERY_R2"], puts };
}

describe.skipIf(!hasTestDb)("data export", () => {
  let db: WorkerDb;
  let close: () => Promise<void>;
  const orgs: string[] = [];
  let orgId: string;
  let scoped: OrgDb;

  beforeAll(async () => {
    ({ db, close } = connect());
  });

  beforeEach(async () => {
    orgId = await createTestOrg(db);
    orgs.push(orgId);
    scoped = orgDb(db, orgId);
  });

  afterAll(async () => {
    for (const id of orgs) await dropTestOrg(db, id);
    await close?.();
  });

  async function queueExport(): Promise<string> {
    const [row] = await scoped.insert(dataExports, { status: "queued" });
    if (!row) throw new Error("no export row");
    return row.id;
  }

  function read(puts: Put[], suffix: string): string | undefined {
    return puts.find((p) => p.key.endsWith(suffix))?.body;
  }

  it("writes a file per table and a manifest that agrees with them", async () => {
    const warehouse = await createTestLocation(db, orgId, "WH");
    await seedLot(scoped, { lotCode: "EXP-1", weightKg: "12.0000", locationId: warehouse });

    const { bucket, puts } = fakeBucket();
    const id = await queueExport();
    await runExport(db, { ...testEnv(), ROASTERY_R2: bucket }, id);

    const manifestBody = read(puts, "manifest.json");
    expect(manifestBody).toBeTruthy();
    const manifest = JSON.parse(manifestBody as string) as ExportManifest;

    // Every table it claims, it wrote.
    for (const table of manifest.tables) {
      expect(read(puts, `/${table.file}`), table.file).toBeDefined();
    }
    expect(manifest.orgId).toBe(orgId);
    expect(manifest.tables.length).toBeGreaterThan(50);

    // And the counts are real, not placeholders.
    const lots = manifest.tables.find((t) => t.table === "green_lots");
    expect(lots?.rows).toBe(1);
    const lotLines = (read(puts, "/green_lots.ndjson") ?? "").trim().split("\n");
    expect(lotLines).toHaveLength(1);
    expect(JSON.parse(lotLines[0] as string)).toMatchObject({ lot_code: "EXP-1" });
  });

  it("writes an empty file rather than omitting a table with no rows", async () => {
    // "Empty" and "not included" are different answers, and only one of them
    // tells a recipient their export is complete.
    const { bucket, puts } = fakeBucket();
    await runExport(db, { ...testEnv(), ROASTERY_R2: bucket }, await queueExport());

    const manifest = JSON.parse(read(puts, "manifest.json") as string) as ExportManifest;
    const empty = manifest.tables.find((t) => t.rows === 0);
    expect(empty).toBeTruthy();
    expect(read(puts, `/${empty?.file}`)).toBe("");
  });

  it("never exports credential material", async () => {
    const { bucket, puts } = fakeBucket();
    await runExport(db, { ...testEnv(), ROASTERY_R2: bucket }, await queueExport());

    const written = puts.map((p) => p.key);
    for (const excluded of [
      "api_keys",
      "oauth_clients",
      "webhook_endpoints",
      "machine_bridge_tokens",
    ]) {
      expect(
        written.some((k) => k.includes(excluded)),
        excluded,
      ).toBe(false);
    }
  });

  it("marks the row ready, with an expiry", async () => {
    const { bucket } = fakeBucket();
    const id = await queueExport();
    await runExport(db, { ...testEnv(), ROASTERY_R2: bucket }, id);

    const [row] = await db.select().from(dataExports).where(eq(dataExports.id, id));
    expect(row?.status).toBe("ready");
    expect(row?.objectKey).toContain(orgId);
    // A complete copy of a business's records does not sit behind a link
    // indefinitely.
    expect(row?.expiresAt?.getTime()).toBeGreaterThan(Date.now());
  });

  it("records a failure on the row rather than only throwing", async () => {
    // Somebody is waiting for this file and has to be told it is not coming.
    const id = await queueExport();
    const withoutStorage = {
      ...testEnv(),
      ROASTERY_R2: undefined as unknown as Env["ROASTERY_R2"],
    };
    await expect(runExport(db, withoutStorage, id)).rejects.toThrow();

    const [row] = await db.select().from(dataExports).where(eq(dataExports.id, id));
    expect(row?.status).toBe("failed");
    expect(row?.error).toBeTruthy();
  });

  it("ignores an export that is not queued", async () => {
    // The maintenance cron re-drives queued exports, so a message delivered
    // twice must not rewrite a finished one.
    const id = await queueExport();
    await db.update(dataExports).set({ status: "ready" }).where(eq(dataExports.id, id));

    const { bucket, puts } = fakeBucket();
    await runExport(db, { ...testEnv(), ROASTERY_R2: bucket }, id);
    expect(puts).toHaveLength(0);
  });

  it("uploads a large table in parts, in order", async () => {
    // The path a customer with real history takes. Exercised with a lowered
    // threshold rather than five megabytes of rows: what is being checked is
    // part numbering and assembly, not R2's actual minimum.
    const warehouse = await createTestLocation(db, orgId, "WH");
    for (let i = 0; i < 40; i++) {
      await seedLot(scoped, {
        lotCode: `BIG-${i}`,
        weightKg: "1.0000",
        locationId: warehouse,
      });
    }

    const { bucket, puts } = fakeBucket();
    await runExport(db, { ...testEnv(), ROASTERY_R2: bucket }, await queueExport(), {
      // Small enough that a page of lots crosses it several times.
      minPartBytes: 512,
    });

    const body = read(puts, "/green_lots.ndjson") ?? "";
    const lines = body.trim().split("\n");
    // Every row present exactly once, and the file still parses line by line —
    // a part boundary landing mid-row would break both.
    expect(lines).toHaveLength(40);
    const codes = lines.map((line) => (JSON.parse(line) as { lot_code: string }).lot_code);
    expect(new Set(codes).size).toBe(40);

    const manifest = JSON.parse(read(puts, "manifest.json") as string) as ExportManifest;
    expect(manifest.tables.find((t) => t.table === "green_lots")?.rows).toBe(40);
  });

  it("exports only the requesting organization's rows", async () => {
    const otherId = await createTestOrg(db);
    orgs.push(otherId);
    const other = orgDb(db, otherId);
    const otherWarehouse = await createTestLocation(db, otherId, "OTH");
    await seedLot(other, { lotCode: "OTHER-1", weightKg: "5.0000", locationId: otherWarehouse });

    const warehouse = await createTestLocation(db, orgId, "WH");
    await seedLot(scoped, { lotCode: "MINE-1", weightKg: "5.0000", locationId: warehouse });

    const { bucket, puts } = fakeBucket();
    await runExport(db, { ...testEnv(), ROASTERY_R2: bucket }, await queueExport());

    const lots = read(puts, "/green_lots.ndjson") ?? "";
    expect(lots).toContain("MINE-1");
    expect(lots).not.toContain("OTHER-1");
  });
});
