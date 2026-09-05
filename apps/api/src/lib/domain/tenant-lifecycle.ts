/**
 * Getting an organization's data out, and getting rid of it.
 *
 * Two operations a business is entitled to and the product had neither. Both
 * are built on `tenancy.ts` rather than on a list of tables kept here, which
 * is the whole reason they can be trusted: a new table must be classified
 * there or the authorization test fails the build, so it appears in the export
 * automatically. A hand-maintained list would be complete on the day it was
 * written and quietly short every month after.
 *
 * The export is NDJSON, one file per table, because the alternative — one JSON
 * document — has to be held in memory whole at both ends, and a roastery with
 * three years of espresso shots is not a small document.
 *
 * Deletion is marked first and purged later. A cascade through eighty tables
 * is irreversible the moment it commits; somebody who deletes the wrong
 * organization needs a window in which that is fixable. Requests are refused
 * from the moment it is marked, so the window is time to change your mind, not
 * continued service.
 */

import type { R2Bucket, R2UploadedPart } from "@cloudflare/workers-types";
import { dataExports, organizations } from "@roastery/db/schema";
import { TENANT_DIRECT, TENANT_VIA } from "@roastery/db/tenancy";
import { eq, sql } from "drizzle-orm";
import type { Env } from "../../env";
import type { WorkerDb } from "../db/db";

/**
 * Tables deliberately left out of an export, each for a reason.
 *
 * Everything else classified as tenant data is included. Being explicit here
 * rather than listing what to include is what makes the export complete by
 * default: a new table joins it unless somebody argues otherwise.
 */
const EXCLUDED_FROM_EXPORT = new Set([
  // Credential material. The hashes are useless to the recipient and would be
  // a gift to anyone else who got hold of the file.
  "api_keys",
  "oauth_clients",
  "machine_bridge_tokens",
  // Signing secrets, sealed with a key that is not in the database. Exporting
  // ciphertext nobody can open is noise at best.
  "webhook_endpoints",
  // The export's own bookkeeping.
  "data_exports",
]);

export type ExportManifest = {
  orgId: string;
  exportedAt: string;
  tables: { table: string; rows: number; file: string }[];
};

/** Every tenant-scoped table, and how to filter it to one organization. */
function exportableTables(): {
  name: string;
  sql: (orgId: string, limit: number, offset: number) => string;
}[] {
  const direct = Object.entries(TENANT_DIRECT).map(([name, tenancy]) => ({
    name,
    column: tenancy.column.name,
    kind: "direct" as const,
    tenancy,
  }));
  const via = Object.entries(TENANT_VIA).map(([name, tenancy]) => ({
    name,
    kind: "via" as const,
    tenancy,
  }));

  return [
    ...direct.map((t) => ({
      name: t.name,
      // Ordered by ctid so paging is stable: not every table has a sortable
      // key, and an unordered LIMIT/OFFSET can repeat or skip rows between
      // pages.
      sql: (orgId: string, limit: number, offset: number) =>
        `select * from ${t.name} where ${t.column} = '${orgId}'::uuid ` +
        `order by ctid limit ${limit} offset ${offset}`,
    })),
    ...via.map((t) => ({
      name: t.name,
      // A transitive table has no tenant column of its own — that is the whole
      // point of the classification — so it is reached through its parent.
      sql: (orgId: string, limit: number, offset: number) =>
        `select c.* from ${t.name} c join roast_batches p on p.id = c.batch_id ` +
        `where p.org_id = '${orgId}'::uuid order by c.ctid limit ${limit} offset ${offset}`,
    })),
  ].filter((t) => !EXCLUDED_FROM_EXPORT.has(t.name));
}

/** The table names an export covers. Exposed so a test can assert coverage. */
export function exportedTableNames(): string[] {
  return exportableTables()
    .map((t) => t.name)
    .sort();
}

const EXPIRES_AFTER_HOURS = 48;

/**
 * Writes one NDJSON file per table to R2 and records what it wrote.
 *
 * Read in pages and uploaded in parts. An export is the one operation whose
 * size is bounded by the customer's entire history rather than by a request,
 * so a roastery with three years of espresso shots is precisely the customer
 * for whom "build the whole file in memory, then PUT it" runs out of memory —
 * and precisely the one who most needs the export to work.
 *
 * A multipart upload is only started for a table big enough to need one; the
 * great majority are a few kilobytes and go in a single write.
 */
export async function runExport(db: WorkerDb, env: Env, exportId: string): Promise<void> {
  const [row] = await db.select().from(dataExports).where(eq(dataExports.id, exportId)).limit(1);
  if (row?.status !== "queued") return;

  const orgId = row.orgId;
  const prefix = `exports/${orgId}/${exportId}`;
  const tables: ExportManifest["tables"] = [];

  try {
    if (!env.ROASTERY_R2) throw new Error("Object storage is not configured");

    for (const table of exportableTables()) {
      const file = `${table.name}.ndjson`;
      const rows = await writeTable(db, env, `${prefix}/${file}`, table, orgId);
      tables.push({ table: table.name, rows, file });
    }

    const manifest: ExportManifest = {
      orgId,
      exportedAt: new Date().toISOString(),
      tables,
    };
    await env.ROASTERY_R2.put(`${prefix}/manifest.json`, JSON.stringify(manifest, null, 2), {
      httpMetadata: { contentType: "application/json" },
    });

    await db
      .update(dataExports)
      .set({
        status: "ready",
        objectKey: prefix,
        manifest,
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + EXPIRES_AFTER_HOURS * 3_600_000),
      })
      .where(eq(dataExports.id, exportId));
  } catch (error) {
    // Recorded on the row, not only logged: somebody is waiting for this file
    // and needs to be told it is not coming.
    await db
      .update(dataExports)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date(),
      })
      .where(eq(dataExports.id, exportId));
    throw error;
  }
}

/** Rows per SELECT. Small enough to hold, large enough not to be chatty. */
const PAGE_SIZE = 5000;

/**
 * R2's minimum size for every multipart part except the last.
 *
 * So parts are buffered to at least this before being uploaded, and a table
 * that never reaches it is written with a single PUT instead.
 */
const MIN_PART_BYTES = 5 * 1024 * 1024;

async function writeTable(
  db: WorkerDb,
  env: Env,
  key: string,
  table: { name: string; sql: (orgId: string, limit: number, offset: number) => string },
  orgId: string,
): Promise<number> {
  const bucket = env.ROASTERY_R2;
  if (!bucket) throw new Error("Object storage is not configured");

  type Upload = Awaited<ReturnType<R2Bucket["createMultipartUpload"]>>;
  let upload: Upload | undefined;
  const parts: R2UploadedPart[] = [];
  let buffer = "";
  let rows = 0;
  let offset = 0;

  const flush = async () => {
    if (!upload) {
      upload = await bucket.createMultipartUpload(key, {
        httpMetadata: { contentType: "application/x-ndjson" },
      });
    }
    parts.push(await upload.uploadPart(parts.length + 1, buffer));
    buffer = "";
  };

  for (;;) {
    const page = await db.execute<Record<string, unknown>>(
      sql.raw(table.sql(orgId, PAGE_SIZE, offset)),
    );
    const records = [...page];
    if (records.length === 0) break;

    for (const record of records) buffer += `${JSON.stringify(record)}\n`;
    rows += records.length;
    offset += records.length;

    if (buffer.length >= MIN_PART_BYTES) await flush();
    if (records.length < PAGE_SIZE) break;
  }

  if (upload) {
    // The final part carries whatever is left, and may be under the minimum.
    if (buffer.length > 0) await flush();
    await upload.complete(parts);
  } else {
    // A table with no rows still gets a file. "Empty" and "not included" are
    // different answers, and only one of them is reassuring.
    await bucket.put(key, buffer, { httpMetadata: { contentType: "application/x-ndjson" } });
  }

  return rows;
}

/**
 * Removes an organization for good, once its grace period has passed.
 *
 * Order matters. Object storage and Durable Object state are not reachable
 * from the database row, so they go first: deleting the row first would leave
 * curves and reports in R2 with nothing pointing at them and no way to find
 * them again. The row is last, and its cascade takes the eighty tables with it.
 */
export async function purgeOrg(db: WorkerDb, env: Env, orgId: string): Promise<void> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org?.deletedAt) return;
  if (org.purgeAfter && org.purgeAfter.getTime() > Date.now()) return;

  if (env.ROASTERY_R2) {
    for (const prefix of [`exports/${orgId}/`, `curves/${orgId}/`, `reports/${orgId}/`]) {
      await deletePrefix(env, prefix);
    }
  }

  await db.delete(organizations).where(eq(organizations.id, orgId));
  console.log(JSON.stringify({ msg: "org_purged", orgId }));
}

async function deletePrefix(env: Env, prefix: string): Promise<void> {
  const bucket = env.ROASTERY_R2;
  if (!bucket) return;
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix, cursor, limit: 1000 });
    if (listed.objects.length > 0) {
      await bucket.delete(listed.objects.map((o) => o.key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}
