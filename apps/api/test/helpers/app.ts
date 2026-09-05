import type { Env } from "../../src/env";
import { TEST_DATABASE_URL } from "./db";

/**
 * An `Env` good enough to drive the real middleware chain over HTTP.
 *
 * The authorization suite has always been static: it reads the route registry
 * and greps source text, which is fast and catches a great deal, and cannot
 * observe the one thing that actually protects a tenant — what the middleware
 * chain does to a real request. Checks 5 and 8 were left as "Phase 2, needs a
 * database". CI has had a database for some time.
 *
 * Hyperdrive is just a connection string here, which is all `createWorkerDb`
 * reads from it. KV is a Map: the only KV the request path needs is the
 * permission and entitlement cache, and a real one would make these tests
 * depend on eviction timing.
 *
 * The rate limiters ALLOW everything. Leaving them unbound is not the same
 * thing: without a binding the limiter falls back to its in-memory counter,
 * which is real, and a suite that fires one request per registered operation
 * trips the 60-per-10s burst budget a third of the way through — every
 * assertion after that failing with a 429 that has nothing to do with
 * authorization. Rate limiting has its own tests.
 */
export function testEnv(): Env {
  const store = new Map<string, string>();

  const kv = {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => void store.set(key, value),
    delete: async (key: string) => void store.delete(key),
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  };

  const allowAll = {
    limit: async () => ({ success: true }),
  } as unknown as Env["RPC_SUSTAINED_LIMITER"];

  return {
    HYPERDRIVE: { connectionString: TEST_DATABASE_URL } as Env["HYPERDRIVE"],
    RPC_SUSTAINED_LIMITER: allowAll,
    RPC_BURST_LIMITER: allowAll,
    AUTH_RATE_LIMITER: allowAll,
    SESSION_RATE_LIMITER: allowAll,
    INGEST_LIMITER: allowAll,
    REPORTS_LIMITER: allowAll,
    STREAM_LIMITER: allowAll,
    ROASTERY_KV: kv as unknown as Env["ROASTERY_KV"],
    ROAST_BATCH: undefined as unknown as Env["ROAST_BATCH"],
    CAFE_SITE: undefined as unknown as Env["CAFE_SITE"],
    ROASTERY_R2: undefined as unknown as Env["ROASTERY_R2"],
    BETTER_AUTH_SECRET: "test-secret-not-used-for-signing-anything-real",
    BETTER_AUTH_URL: "http://localhost:8787",
    // `test` is what stops assertProductionBindings refusing to serve: it is
    // the deny-list entry, and the whole point of that check is that anything
    // unrecognised counts as production.
    ENVIRONMENT: "test",
  } as Env;
}

/** A request through the real chain: middleware, validators, handler. */
export function rpcRequest(
  operation: string,
  opts: { apiKey?: string; orgId?: string; body?: unknown } = {},
): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
  if (opts.orgId) headers["X-Roastery-Org"] = opts.orgId;
  return new Request(`http://localhost/rpc/v1/${operation}`, {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
}
