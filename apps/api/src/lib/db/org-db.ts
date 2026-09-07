import { directTenancyFor, type ScopedTable, transitiveTenancyFor } from "@roastery/db/tenancy";
import type { ChangeRecord, EmittedEvent } from "../events/events";

export type { EmittedEvent } from "../events/events";

import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { recordChange } from "../events/events";
import type { WorkerDb } from "./db";

export type Actor = {
  /** The CREDENTIAL that made the request: a user id, key id or client id. */
  id: string | null;
  type: "user" | "api_key" | "oauth_client" | "system";
  /**
   * The PERSON responsible, when there is one.
   *
   * Distinct from `id` because a request can arrive under an API key that a
   * human created — and attribution should name the human. Conflating the two
   * meant every action taken through a key recorded no user at all, which
   * silently broke "one score per cupper": three cuppers using three keys all
   * recorded a null cupper and collided with each other.
   */
  userId: string | null;
};

export type PageInfo = { nextCursor: string | null; hasMore: boolean };

export type FindOptions = {
  where?: SQL;
  limit?: number;
  cursor?: string;
  /** Ascending order is only correct for a stable, non-user-facing listing. */
  direction?: "asc" | "desc";
  /**
   * A column on the table to order by, instead of the created/occurred
   * timestamp.
   *
   * The caller is responsible for having checked it against the operation's
   * declared `sortable` list — this function will happily order by any column,
   * and an unindexed one is a sequential scan triggered by a click.
   */
  sort?: string;
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

  insert<T extends ScopedTable>(
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

  /**
   * Records a change to the audit log and the outbox.
   *
   * Called on THIS handle, so inside `transaction()` it uses the transaction
   * and commits or rolls back with the change it describes. Calling it on the
   * outer handle for something that happened inside a transaction is the one
   * way to get this wrong, and it is why the domain writes below all emit from
   * within their own transaction callback.
   */
  emit(change: ChangeRecord): Promise<void>;
};

/**
 * Where emitted events accumulate for the life of one request.
 *
 * The handler does not enqueue anything itself — it emits, and the RPC wrapper
 * flushes this sink to the fan-out queue after the response is built. That
 * ordering matters: enqueueing inside the handler would publish events for a
 * transaction that later rolls back.
 */
export type EventSink = { push: (event: EmittedEvent) => void };

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
  const direct = directTenancyFor(table);
  if (direct) return eq(direct.column, orgId);

  const via = transitiveTenancyFor(table);
  if (via) {
    // A semi-join rather than a JOIN: Postgres plans it as a hash semi-join
    // and, unlike a join, it composes safely with any caller predicate.
    return inArray(
      via.childFk,
      db
        .select({ id: via.parentKey })
        .from(via.parent as PgTable)
        .where(eq(via.parentTenantColumn, orgId)),
    );
  }

  throw new Error(
    `Table "${tableName(table)}" is not tenant-classified. ` +
      "Add it to TENANT_DIRECT, TENANT_VIA or TENANT_GLOBAL in packages/db/src/tenancy.ts.",
  );
}

/* --------------------------------------------------------------- cursors */

/**
 * @property k The sort key the cursor was made under. A cursor is only valid
 *   for its own ordering: replaying a "newest first" cursor against a sort by
 *   weight would return a page that is silently wrong rather than an error, so
 *   a mismatch restarts from the beginning.
 * @property v The sort column's value, as a string. Dates go out as ISO.
 * @property n True when the sort value was NULL, which needs its own branch:
 *   nulls sort last, and the boundary between the last dated row and the first
 *   null one is otherwise undefined.
 */
type CursorPayload = { k: string; v: string; n?: true; id: string };

export function encodeCursor(row: Record<string, unknown>, key: string): string | null {
  const id = row.id;
  if (typeof id !== "string") return null;
  const value = row[key];
  if (value === null || value === undefined) {
    return btoa(JSON.stringify({ k: key, v: "", n: true, id } satisfies CursorPayload));
  }
  const v = value instanceof Date ? value.toISOString() : String(value);
  return btoa(JSON.stringify({ k: key, v, id } satisfies CursorPayload));
}

export function decodeCursor(cursor: string, key: string): CursorPayload | null {
  try {
    const parsed = JSON.parse(atob(cursor)) as CursorPayload;
    if (typeof parsed.v !== "string" || typeof parsed.id !== "string") return null;
    // A cursor from a different ordering is discarded rather than applied.
    if (parsed.k !== key) return null;
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
  sort: string | undefined,
): SQL | undefined {
  const key = sortKey(table, sort);
  if (!cursor) return undefined;
  const decoded = decodeCursor(cursor, key);
  if (!decoded) return undefined;

  const cols = columns(table);
  const column = sortColumn(table, sort);
  const id = cols.id;
  if (!column || !id) return undefined;

  const before = direction === "desc";

  // The ordering is `column <dir> NULLS LAST, id <dir>`, so the predicate has
  // to walk the two halves of that separately.
  if (decoded.n) {
    // Already among the nulls: everything left is a null with a later id.
    return before
      ? sql`${column} is null and ${id} < ${decoded.id}`
      : sql`${column} is null and ${id} > ${decoded.id}`;
  }

  const value = valueFor(column, decoded.v);
  return before
    ? sql`((${column} is not null and (${column}, ${id}) < (${value}, ${decoded.id})) or ${column} is null)`
    : sql`((${column} is not null and (${column}, ${id}) > (${value}, ${decoded.id})) or ${column} is null)`;
}

/**
 * The cursor value, typed the way the column expects.
 *
 * A timestamp compared against a bound string is a comparison Postgres may
 * refuse or, worse, resolve by casting the column — so a date column gets a
 * Date. Everything else binds as text and is inferred from the column it is
 * compared against.
 */
function valueFor(column: unknown, raw: string): unknown {
  const dataType = (column as { dataType?: string }).dataType;
  return dataType === "date" ? new Date(raw) : raw;
}

/** The column name a listing is keyed on, for cursor validation. */
function sortKey(table: ScopedTable, sort: string | undefined): string {
  if (sort) return sort;
  const cols = columns(table);
  return cols.createdAt ? "createdAt" : "occurredAt";
}

/**
 * The timestamp a listing is ordered by.
 *
 * Almost every table calls it `createdAt`. The outbox calls it `occurredAt`,
 * because the business time of a change and the time its row was written are
 * different ideas and the feed has to be ordered by the former. Falling back
 * rather than special-casing keeps the one paginator working for both.
 *
 * A table with NEITHER throws. That was already described as a bug and nothing
 * enforced it, so the actual behaviour was silent: the listing ordered by id
 * alone, `encodeCursor` returned null, and the response said `hasMore: true`
 * with no cursor to follow — page two simply unreachable, with no error
 * anywhere. Eleven classified tables have no timestamp; none is listed today,
 * and the first one to be would have shipped that.
 */
function sortColumn(table: ScopedTable, sort?: string): unknown {
  const cols = columns(table);
  if (sort) {
    const chosen = cols[sort];
    if (!chosen) {
      throw new Error(
        `${tableName(table)} has no column "${sort}" to sort by. The operation's ` +
          "`sortable` list and the table have drifted apart.",
      );
    }
    return chosen;
  }
  const column = cols.createdAt ?? cols.occurredAt;
  if (!column) {
    throw new Error(
      `${tableName(table)} has neither createdAt nor occurredAt, so it cannot be paginated ` +
        "by keyset. Add a timestamp column, or list it with an explicit query.",
    );
  }
  return column;
}

function orderClause(table: ScopedTable, direction: "asc" | "desc", sort?: string): SQL[] {
  const cols = columns(table);
  const column = sortColumn(table, sort);
  const id = cols.id;
  // NULLS LAST in both directions, stated rather than inherited: Postgres
  // defaults to NULLS FIRST on DESC, and the cursor predicate above assumes
  // the nulls are at the end. The two have to agree or paging skips rows.
  const dir = sql.raw(direction === "desc" ? "desc" : "asc");
  const out: SQL[] = [sql`${column} ${dir} nulls last`];
  if (id) out.push(sql`${id} ${dir}`);
  return out;
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export function createOrgDb(db: WorkerDb, orgId: string, actor: Actor, sink?: EventSink): OrgDb {
  const scope = (t: ScopedTable) => orgPredicate(t, orgId, db);

  const api: OrgDb = {
    orgId,
    actor,

    async find(table, opts = {}) {
      const direction = opts.direction ?? "desc";
      const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
      const key = sortKey(table, opts.sort);
      const where = and(
        scope(table),
        opts.where,
        cursorPredicate(table, opts.cursor, direction, opts.sort),
      );

      // Fetch one extra row to answer hasMore without a second COUNT query.
      const rows = (await db
        .select()
        .from(table as PgTable)
        .where(where)
        .orderBy(...orderClause(table, direction, opts.sort))
        .limit(limit + 1)) as Record<string, unknown>[];

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const last = items[items.length - 1];
      return {
        items: items as never,
        page: { nextCursor: hasMore && last ? encodeCursor(last, key) : null, hasMore },
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
      const direct = directTenancyFor(table);
      if (!direct) {
        // Only a table owning its tenant column can have one injected. A
        // transitively-scoped row inherits its tenant from its parent, so
        // inserting one without that parent is a bug.
        throw new Error(
          `Cannot insert into "${tableName(table)}": it has no tenant column of its own.`,
        );
      }
      // The property name differs per table (orgId, referenceId, ...), so it
      // is read from the classification rather than assumed.
      const key = direct.field;
      const list = Array.isArray(values) ? values : [values];
      const rows = list.map((v) => {
        const given = v[key];
        // A caller passing a different org is a bug worth surfacing, not
        // something to paper over by overwriting it.
        if (given !== undefined && given !== orgId) {
          throw new Error("Refusing to insert a row for a different organization");
        }
        return { ...v, [key]: orgId };
      });
      return (await db
        .insert(table as PgTable)
        .values(rows as never)
        .returning()) as never;
    },

    async update(table, values, where) {
      // The tenant column is stripped, so an update can never move a row
      // between tenants.
      const tenantKey = directTenancyFor(table)?.field ?? "orgId";
      const { [tenantKey]: _ignored, ...rest } = values;
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
      // The sink is shared with the nested handle, so events emitted inside a
      // transaction still reach the request's flush. They are only enqueued
      // after the response is built, so a rolled-back transaction publishes
      // nothing even though the sink saw the emit.
      return db.transaction((tx) => fn(createOrgDb(tx as unknown as WorkerDb, orgId, actor, sink)));
    },

    async emit(change) {
      const event = await recordChange(db, orgId, actor, change);
      if (event) sink?.push(event);
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
  sink?: EventSink,
): Promise<T> {
  return fn(createOrgDb(db, orgId, { id: null, type: "system", userId: null }, sink));
}
