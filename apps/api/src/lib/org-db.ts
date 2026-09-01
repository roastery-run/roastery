import {
  type DirectTenantTable,
  isDirectTenantTable,
  type ScopedTable,
  transitiveTenancyFor,
} from "@roastery/db/tenancy";
import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { WorkerDb } from "./db";

export type Actor = {
  id: string | null;
  type: "user" | "api_key" | "oauth_client" | "system";
};

export type PageInfo = { nextCursor: string | null; hasMore: boolean };

export type FindOptions = {
  where?: SQL;
  limit?: number;
  cursor?: string;
  /** Ascending order is only correct for a stable, non-user-facing listing. */
  direction?: "asc" | "desc";
};

/**
 * A tenant-scoped database handle.
 *
 * It deliberately does NOT mirror Drizzle's fluent chain. Drizzle's `.where()`
 * is a setter, so any wrapper that returns a raw query builder can have its
 * org predicate silently overwritten by the caller's next `.where()` — which
 * would make this whole layer decorative. Here the caller's predicate is a
 * PARAMETER and the org clause is and()-ed in where the caller cannot reach it.
 *
 * There is exactly one constructor (`createOrgDb`) and it is called in exactly
 * one place (`orgScope`), after access has been verified. A handler holding an
 * OrgDb has, by construction, passed the tenancy check.
 */
export type OrgDb = {
  readonly orgId: string;
  readonly actor: Actor;

  find<T extends ScopedTable>(
    table: T,
    opts?: FindOptions,
  ): Promise<{ items: T["$inferSelect"][]; page: PageInfo }>;

  findOne<T extends ScopedTable>(table: T, where: SQL): Promise<T["$inferSelect"] | undefined>;

  count<T extends ScopedTable>(table: T, where?: SQL): Promise<number>;

  insert<T extends DirectTenantTable>(
    table: T,
    values: Record<string, unknown> | Record<string, unknown>[],
  ): Promise<T["$inferSelect"][]>;

  update<T extends ScopedTable>(
    table: T,
    values: Record<string, unknown>,
    where: SQL,
  ): Promise<T["$inferSelect"][]>;

  delete<T extends ScopedTable>(table: T, where: SQL): Promise<number>;

  /**
   * Escape hatch for joins and aggregates `find` cannot express. Still forced:
   * `scope(table)` yields the correct predicate and the callback is given no
   * way to obtain an unscoped builder for a scoped table.
   */
  query<R>(fn: (tx: WorkerDb, scope: (t: ScopedTable) => SQL) => Promise<R>): Promise<R>;

  /** Nested OrgDb; the org binding is inherited and cannot be changed. */
  transaction<R>(fn: (tx: OrgDb) => Promise<R>): Promise<R>;
};

function tableName(table: unknown): string {
  const named = table as { _?: { name?: string } };
  return named?._?.name ?? "<unknown table>";
}

function columns(table: unknown): Record<string, unknown> {
  return table as unknown as Record<string, unknown>;
}

/**
 * The org predicate for a table, whichever way it reaches the tenant.
 *
 * Throws for an unclassified table. That is the correct behaviour: silently
 * returning every tenant's rows is precisely the bug this module exists to
 * prevent, and `tenancy.ts` plus the authorization test make the throw
 * unreachable in practice.
 */
export function orgPredicate(table: ScopedTable, orgId: string, db: WorkerDb): SQL {
  if (isDirectTenantTable(table)) {
    return eq((table as DirectTenantTable).orgId, orgId);
  }

  const via = transitiveTenancyFor(table);
  if (via) {
    // A semi-join rather than a JOIN: Postgres plans it as a hash semi-join
    // and, unlike a join, it composes safely with any caller predicate.
    return inArray(
      via.childFk,
      db
        .select({ id: via.parentKey })
        .from(via.parent as PgTable)
        .where(eq(via.parent.orgId, orgId)),
    );
  }

  throw new Error(
    `Table "${tableName(table)}" is not tenant-classified. ` +
      "Add it to TENANT_DIRECT, TENANT_VIA or TENANT_GLOBAL in packages/db/src/tenancy.ts.",
  );
}

/* --------------------------------------------------------------- cursors */

type CursorPayload = { t: string; id: string };

function encodeCursor(row: Record<string, unknown>): string | null {
  const createdAt = row.createdAt;
  const id = row.id;
  if (!(createdAt instanceof Date) || typeof id !== "string") return null;
  const payload: CursorPayload = { t: createdAt.toISOString(), id };
  return btoa(JSON.stringify(payload));
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const parsed = JSON.parse(atob(cursor)) as CursorPayload;
    if (typeof parsed.t !== "string" || typeof parsed.id !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Keyset pagination on `(created_at, id)`.
 *
 * Offsets are not used anywhere: `OFFSET 50000` makes Postgres walk and discard
 * 50,000 rows, so a large tenant's last page costs more than its first. The id
 * tiebreak is what makes the order total when two rows share a timestamp.
 */
function cursorPredicate(
  table: ScopedTable,
  cursor: string | undefined,
  direction: "asc" | "desc",
): SQL | undefined {
  if (!cursor) return undefined;
  const decoded = decodeCursor(cursor);
  if (!decoded) return undefined;

  const cols = columns(table);
  const createdAt = cols.createdAt;
  const id = cols.id;
  if (!createdAt || !id) return undefined;

  const ts = sql`${sql.raw("")}${new Date(decoded.t)}`;
  return direction === "desc"
    ? sql`(${createdAt}, ${id}) < (${ts}, ${decoded.id})`
    : sql`(${createdAt}, ${id}) > (${ts}, ${decoded.id})`;
}

function orderClause(table: ScopedTable, direction: "asc" | "desc"): SQL[] {
  const cols = columns(table);
  const createdAt = cols.createdAt;
  const id = cols.id;
  const dir = direction === "desc" ? desc : asc;
  const out: SQL[] = [];
  if (createdAt) out.push(dir(createdAt as never));
  if (id) out.push(dir(id as never));
  return out;
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export function createOrgDb(db: WorkerDb, orgId: string, actor: Actor): OrgDb {
  const scope = (t: ScopedTable) => orgPredicate(t, orgId, db);

  const api: OrgDb = {
    orgId,
    actor,

    async find(table, opts = {}) {
      const direction = opts.direction ?? "desc";
      const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
      const where = and(scope(table), opts.where, cursorPredicate(table, opts.cursor, direction));

      // Fetch one extra row to answer hasMore without a second COUNT query.
      const rows = (await db
        .select()
        .from(table as PgTable)
        .where(where)
        .orderBy(...orderClause(table, direction))
        .limit(limit + 1)) as Record<string, unknown>[];

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const last = items[items.length - 1];
      return {
        items: items as never,
        page: { nextCursor: hasMore && last ? encodeCursor(last) : null, hasMore },
      };
    },

    async findOne(table, where) {
      const rows = await db
        .select()
        .from(table as PgTable)
        .where(and(scope(table), where))
        .limit(1);
      return rows[0] as never;
    },

    async count(table, where) {
      const rows = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(table as PgTable)
        .where(and(scope(table), where));
      return rows[0]?.n ?? 0;
    },

    async insert(table, values) {
      const list = Array.isArray(values) ? values : [values];
      const rows = list.map((v) => {
        const given = v.orgId;
        // A caller passing a different org is a bug worth surfacing, not
        // something to paper over by overwriting it.
        if (given !== undefined && given !== orgId) {
          throw new Error("Refusing to insert a row for a different organization");
        }
        return { ...v, orgId };
      });
      return (await db
        .insert(table as PgTable)
        .values(rows as never)
        .returning()) as never;
    },

    async update(table, values, where) {
      // orgId is stripped, so an update can never move a row between tenants.
      const { orgId: _ignored, ...rest } = values;
      return (await db
        .update(table as PgTable)
        .set(rest as never)
        .where(and(scope(table), where))
        .returning()) as never;
    },

    async delete(table, where) {
      const rows = await db
        .delete(table as PgTable)
        .where(and(scope(table), where))
        .returning({ one: sql<number>`1` });
      return rows.length;
    },

    query(fn) {
      return fn(db, scope);
    },

    transaction(fn) {
      return db.transaction((tx) => fn(createOrgDb(tx as unknown as WorkerDb, orgId, actor)));
    },
  };

  return api;
}

/**
 * Builds a scoped handle for background work (queue consumers, cron), so a job
 * is tenant-scoped by the identical code path as a request rather than by a
 * second, parallel set of rules.
 */
export async function withOrgDb<T>(
  db: WorkerDb,
  orgId: string,
  fn: (odb: OrgDb) => Promise<T>,
): Promise<T> {
  return fn(createOrgDb(db, orgId, { id: null, type: "system" }));
}
