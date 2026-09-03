import * as schema from "@roastery/db/schema";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Env } from "../../env";

export type WorkerDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * True for a Postgres unique-constraint violation (SQLSTATE 23505).
 *
 * Walks the cause chain: Drizzle wraps driver errors in its own Error, so the
 * SQLSTATE lives on `err.cause`, not on the error a handler catches. Checking
 * only the outer object silently turns every lost race on a unique index into
 * a 500 — which is exactly the bug this comment exists to prevent recurring.
 */
export function isUniqueViolation(err: unknown, depth = 0): boolean {
  if (depth > 5 || typeof err !== "object" || err === null) return false;
  if ((err as { code?: unknown }).code === "23505") return true;
  return isUniqueViolation((err as { cause?: unknown }).cause, depth + 1);
}

/**
 * Maps a Drizzle db back to the postgres-js client behind it, so callers can
 * close the connection without every factory returning a tuple. Weak, so a db
 * we failed to close is still collectable.
 */
const clientsByDb = new WeakMap<object, ReturnType<typeof postgres>>();

type WaitUntil = { waitUntil(promise: Promise<unknown>): void };

/**
 * `c.executionCtx` throws when Hono has no ExecutionContext (tests, non-fetch
 * entrypoints). A caller that only wants to defer a best-effort close should
 * not have to care.
 */
export function safeExecutionCtx(c: { executionCtx: WaitUntil }): WaitUntil | undefined {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

function buildWorkerDb(connectionString: string): WorkerDb {
  const client = postgres(connectionString, {
    prepare: false,
    // Behind Hyperdrive, which does the real pooling upstream. More than one
    // so two concurrent requests in the same isolate do not queue on a single
    // socket — which is exactly what made a deferred write push the handler's
    // own query behind it.
    max: 5,
  });
  const db = drizzle(client, { schema });
  clientsByDb.set(db, client);
  return db;
}

/**
 * The default client: cache-disabled, correct for writes and authorization.
 *
 * One per REQUEST, never shared across them. Holding a client at module scope
 * to skip the ~65ms of connection setup looks tempting and does not work:
 * Workers forbid using an I/O object created in one request from another, so
 * the second request onto a reused socket fails outright. Measured as a 500 on
 * roughly half of all requests before this was reverted.
 */
export function createWorkerDb(env: Env): WorkerDb {
  return buildWorkerDb(
    env.HYPERDRIVE_CACHE_DISABLED?.connectionString ?? env.HYPERDRIVE.connectionString,
  );
}

/** Read-only catalogue browse where a stale read is acceptable. */
export function createWorkerDbCached(env: Env): WorkerDb {
  return buildWorkerDb(env.HYPERDRIVE.connectionString);
}

/**
 * A handle a QUEUE or CRON consumer owns and must close.
 *
 * Deliberately not shared: a consumer's batch is unbounded and long-running,
 * and a leaked connection there exhausts the Hyperdrive pool far faster than
 * one in a request. See `withWorkerDb`, which closes in a `finally`.
 */
export function createOwnedWorkerDb(env: Env): WorkerDb {
  return buildWorkerDb(
    env.HYPERDRIVE_CACHE_DISABLED?.connectionString ?? env.HYPERDRIVE.connectionString,
  );
}

/**
 * Every request-scoped db MUST be closed, in a `finally`. A leaked connection
 * in a queue consumer exhausts the Hyperdrive pool far faster than one in a
 * request, because consumers run at whatever concurrency Queues chooses.
 */
export function closeWorkerDb(db: object, ctx?: WaitUntil): Promise<void> {
  const client = clientsByDb.get(db);
  if (!client) return Promise.resolve();
  clientsByDb.delete(db);
  const closing = client.end({ timeout: 5 }).catch(() => {});
  if (ctx) {
    ctx.waitUntil(closing);
    return Promise.resolve();
  }
  return closing;
}

export async function withWorkerDb<T>(env: Env, fn: (db: WorkerDb) => Promise<T>): Promise<T> {
  const db = createOwnedWorkerDb(env);
  try {
    return await fn(db);
  } finally {
    await closeWorkerDb(db);
  }
}
