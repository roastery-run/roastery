import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { ModuleKey } from "@roastery/schemas";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Context } from "hono";
import type { Env } from "../../env";
import type { AuthContext } from "../auth/auth-middleware";
import type { Entitlements } from "../auth/entitlements";
import { can } from "../auth/permissions";
import type { WorkerDb } from "../db/db";
import type { Actor, EmittedEvent, OrgDb } from "../db/org-db";
import * as idempotency from "./idempotency";
import { entitlementErrorSchema, errorResponses } from "./openapi";
import { serverTimingHeader, type Timings, timed } from "./timing";

export type RpcVariables = {
  auth: AuthContext;
  unsafeDb: WorkerDb;
  orgId: string;
  orgDb: OrgDb;
  perms: ReadonlySet<string>;
  entitlements: Entitlements;
  actor: Actor;
  /** Outbox rows written by this request, awaiting fan-out. */
  emittedEvents: EmittedEvent[];
  /** Per-layer durations, emitted as `Server-Timing`. */
  timings: Timings;
  /**
   * The VERIFIED credential a rate limiter may key on.
   *
   * Set by `authMiddleware` once a credential has actually been checked, and
   * read by any limiter that runs after it. Limiters that run before
   * authentication fall back to the caller's IP, because until then the only
   * identity on offer is one the caller made up.
   */
  rateLimitActor?: string;
};

export type RpcAppEnv = { Bindings: Env; Variables: RpcVariables };

export type RpcContext = {
  db: OrgDb;
  env: Env;
  orgId: string;
  actor: Actor;
  /** The org's resolved plan, for enforcing counted limits in a handler. */
  entitlements: Entitlements;
  can: (permission: string) => boolean;
  /** The resolved permission set, for the console to render its own affordances. */
  permissions: ReadonlySet<string>;
  waitUntil: (p: Promise<unknown>) => void;
};

export type RpcDef = {
  namespace: string;
  operation: string;
  summary: string;
  description?: string;
  input: z.ZodTypeAny;
  output: z.ZodTypeAny;
  /** Permission slug, checked in middleware against the permissions table. */
  permission: string;
  /** Entitlement module. Absent from the org's plan ⇒ 402, never 403. */
  module: ModuleKey;
  /** Pure read: also exposed as GET so the response can be HTTP-cached. */
  cacheable?: { maxAgeSeconds: number };
  /**
   * Honour `Idempotency-Key`. Default true for anything that is not a
   * cacheable read: an integration WILL retry after a timeout, and the safe
   * default for a mutation is that retrying it is free.
   */
  idempotent?: boolean;
  /** Console-only. In the spec and typed, hidden from the public docs page. */
  internal?: boolean;
  /**
   * What this listing may be ordered by, beyond its default.
   *
   * An allowlist rather than a free-form key, for two reasons. A sort key
   * reaches the database as an identifier, and an unindexed column turns a
   * click into a sequential scan over every row a tenant owns — the slowest
   * query in the product, triggered by a table header.
   *
   * The table is named alongside the columns so the claim is checkable:
   * `sortable-indexes.test.ts` reads the table's indexes and fails if a
   * declared column has none. Without that the list is good intentions, and
   * the failure it prevents is invisible until a tenant is large enough to
   * feel it.
   */
  sortable?: { table: PgTable; columns: readonly string[] };
};

/**
 * Whether a request asked to order by something this operation allows.
 *
 * Rejected rather than ignored. Silently dropping an unknown sort key returns
 * a list in the default order while the caller believes it is sorted, which is
 * the failure mode this codebase keeps finding: a screen that looks like it
 * did what was asked. The console's own error mapping turns this 400 into
 * "This filter could not be read" with a one-click way back to the full list.
 */
export function unsupportedSort(def: RpcDef, input: unknown): string | null {
  const sort = (input as { page?: { sort?: unknown } } | null)?.page?.sort;
  if (typeof sort !== "string" || sort === "") return null;
  return def.sortable?.columns.includes(sort) ? null : sort;
}

/**
 * The single source of truth for what this API exposes.
 *
 * `authorization.test.ts` enumerates THIS array against the generated OpenAPI
 * document. A handler registered with a raw `app.openapi()` never lands here,
 * so it fails that test — and also 404s at runtime, because `rpcAuthorize`
 * refuses any /rpc/v1 path it cannot find a definition for.
 */
export const RPC_REGISTRY: RpcDef[] = [];
export const RPC_BY_PATH = new Map<string, RpcDef>();

export function rpcPath(def: Pick<RpcDef, "namespace" | "operation">): string {
  return `/rpc/v1/${def.namespace}.${def.operation}`;
}

/**
 * Hands this request's outbox rows to the fan-out queue.
 *
 * Called only after the handler has returned, so nothing is published for a
 * transaction that rolled back. The send is best-effort by design: it runs in
 * `waitUntil`, and if it is lost — the isolate is evicted, the queue is briefly
 * unavailable — the rows are still sitting in `events` with a null
 * `fanned_out_at` and the cron sweeper picks them up within the minute. The
 * inline send buys latency; the outbox is what buys the guarantee.
 */
function flushEvents(c: Context<RpcAppEnv>): void {
  const emitted = c.var.emittedEvents;
  if (!emitted || emitted.length === 0) return;
  const queue = c.env.EVENT_QUEUE;
  if (!queue) return;

  const messages = emitted.map((e) => ({ body: { eventId: e.id } }));
  emitted.length = 0;
  try {
    c.executionCtx.waitUntil(
      queue.sendBatch(messages).catch((err: unknown) => {
        console.error(
          JSON.stringify({
            msg: "event_enqueue_failed",
            count: messages.length,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }),
    );
  } catch {
    // No ExecutionContext (tests). The sweeper is the fallback, as above.
  }
}

function buildRpcContext(c: Context<RpcAppEnv>): RpcContext {
  return {
    db: c.var.orgDb,
    env: c.env,
    orgId: c.var.orgId,
    actor: c.var.actor,
    entitlements: c.var.entitlements,
    can: (permission: string) => can(c.var.perms, permission),
    permissions: c.var.perms,
    waitUntil: (p) => {
      try {
        c.executionCtx.waitUntil(p);
      } catch {
        // No ExecutionContext (tests): the caller's promise still runs.
      }
    },
  };
}

/**
 * Registers one RPC operation.
 *
 * NOTE ON THE NAME: "RPC" here is an API STYLE — `domain.operation` over HTTP
 * POST — not Cloudflare's Workers RPC, which is a Worker-to-Worker transport.
 * This surface must stay HTTP because the callers are ERPs, webstores and
 * shop-floor bridges running outside Cloudflare, which cannot hold a service
 * binding. Worker-to-Worker calls (the SPA proxies) use service bindings for
 * transport and still speak this same HTTP surface, deliberately: the console
 * being just another client is what stops the public API becoming
 * second-class.
 *
 * The path is static — dots are ordinary characters in a path segment, so
 * `/rpc/v1/inventory.green.listGreenLots` is an O(1) router match, faster than
 * a parameterized REST route and requiring no custom dispatch.
 *
 * Authorization is NOT performed here. It runs earlier, in middleware, so that
 * it precedes Zod body validation — otherwise an unauthenticated caller with a
 * malformed body would receive a 400 describing the request schema instead of
 * a 401, handing the API's shape to anyone who asks.
 */
export function registerRpc<Req extends z.ZodTypeAny, Res extends z.ZodTypeAny>(
  app: OpenAPIHono<RpcAppEnv>,
  def: RpcDef & { input: Req; output: Res },
  handler: (input: z.infer<Req>, ctx: RpcContext) => Promise<z.infer<Res>>,
): void {
  const name = `${def.namespace}.${def.operation}`;
  const path = rpcPath(def);

  if (RPC_BY_PATH.has(path)) {
    throw new Error(`Duplicate RPC operation: ${name}`);
  }
  RPC_REGISTRY.push(def);
  RPC_BY_PATH.set(path, def);

  // A mutation is idempotent unless it opts out; a read never is.
  const honoursIdempotency = def.idempotent ?? !def.cacheable;

  const headers = z.object({
    "x-roastery-org": z
      .string()
      .optional()
      .describe(
        "Target organization. Required for session callers. Ignored for machine " +
          "credentials, which are permanently bound to one organization.",
      ),
    ...(honoursIdempotency
      ? {
          "idempotency-key": z
            .string()
            .min(8)
            .max(255)
            .optional()
            .describe(
              "Retry-safe key. The first request to use it wins; later requests with " +
                "the same key replay its response. Reusing a key with a different body " +
                "is a 409.",
            ),
        }
      : {}),
  });

  const responses = {
    200: {
      content: { "application/json": { schema: def.output } },
      description: def.summary,
    },
    402: {
      content: { "application/json": { schema: entitlementErrorSchema } },
      description: "The organization's plan does not include this module, or a limit is exceeded.",
    },
    ...errorResponses({ conflict: true, notFound: true }),
  };

  const base = {
    tags: [def.namespace],
    // Dots are legal in an operationId but break most client generators.
    operationId: name.replace(/\./g, "_"),
    summary: def.summary,
    description:
      `${def.description ?? ""}\n\nRequires permission \`${def.permission}\` ` +
      `and the \`${def.module}\` module on the organization's plan.`.trim(),
  };

  app.openapi(
    createRoute({
      ...base,
      method: "post",
      path,
      request: {
        headers,
        body: { required: true, content: { "application/json": { schema: def.input } } },
      },
      responses,
    }),
    (async (c: Context<RpcAppEnv>) => {
      const input = (c.req as unknown as { valid: (t: "json") => z.infer<Req> }).valid("json");

      const badSort = unsupportedSort(def, input);
      if (badSort) {
        return c.json(
          {
            error: `Cannot order by \`${badSort}\`.`,
            code: "bad_request",
            fields: {
              "page.sort": def.sortable
                ? `Order by one of: ${def.sortable.columns.join(", ")}.`
                : "This listing cannot be reordered.",
            },
          },
          400,
        );
      }

      const idemKey = honoursIdempotency ? c.req.header("Idempotency-Key") : undefined;

      if (idemKey) {
        // Fails OPEN. Idempotency is a convenience layered over the durable
        // guard, which is the unique constraints in Postgres — so when KV is
        // unavailable the right answer is to run the request, not to refuse a
        // write that would have succeeded. Treating a storage blip as a reason
        // to 500 turns a degraded cache into an outage.
        const outcome = await idempotency
          .begin(c.env, c.var.orgId, name, idemKey, input)
          .catch((err) => {
            console.warn(
              JSON.stringify({
                msg: "idempotency_unavailable",
                phase: "begin",
                operation: name,
                error: err instanceof Error ? err.message : String(err),
              }),
            );
            return { status: "fresh" } as const;
          });
        if (outcome.status === "replay") {
          return c.json(outcome.body as never, 200, { "Idempotent-Replay": "true" });
        }
        if (outcome.status === "conflict") {
          return c.json(
            {
              error: "This Idempotency-Key was already used with a different request body",
              code: "idempotency_conflict",
            },
            409,
          );
        }
        if (outcome.status === "in_flight") {
          // An identical request is still running. 409 rather than blocking:
          // holding the connection would tie up a Worker invocation waiting on
          // work it cannot see.
          return c.json(
            { error: "A request with this Idempotency-Key is still in flight", code: "in_flight" },
            409,
            { "Retry-After": "1" },
          );
        }
      }

      let result: unknown;
      try {
        result = await timed(c.var.timings, "handler", () => handler(input, buildRpcContext(c)));
      } catch (err) {
        // Release the claim so a transient failure does not lock the client
        // out of its own key for the full retention window.
        if (idemKey) {
          await idempotency.release(c.env, c.var.orgId, name, idemKey).catch(() => {});
        }
        throw err;
      }

      if (idemKey) {
        // Worse than `begin`: the write has already COMMITTED. Throwing here
        // returns a 500 for a request that succeeded, and leaves the key
        // claimed, so the client's retry gets a 409 in-flight for the next 24
        // hours and the mutation looks permanently stuck. The cost of failing
        // open is that a retry may re-run a committed write, which is exactly
        // what the database constraints are there for.
        await idempotency
          .complete(c.env, c.var.orgId, name, idemKey, input, result)
          .catch((err) => {
            console.warn(
              JSON.stringify({
                msg: "idempotency_unavailable",
                phase: "complete",
                operation: name,
                error: err instanceof Error ? err.message : String(err),
              }),
            );
          });
      }
      flushEvents(c);
      return c.json(result as never, 200, {
        // Rendered inline by browser devtools, so a slow screen explains
        // itself without anyone opening Worker logs.
        "Server-Timing": serverTimingHeader(c.var.timings),
      });
      // OpenAPIHono types a handler by the union of its declared status codes;
      // this generic wrapper cannot express that union, so the cast is load-bearing.
      // biome-ignore lint/suspicious/noExplicitAny: see above.
    }) as any,
  );

  // A cacheable read also gets a GET twin: same schema, same handler, same
  // authorization, same registry entry. Only the transport differs. This is
  // what recovers HTTP caching for heavy reads without introducing a second
  // API surface to secure and document.
  if (def.cacheable) {
    app.openapi(
      createRoute({
        ...base,
        method: "get",
        path,
        operationId: `${base.operationId}_get`,
        request: {
          headers,
          query: z.object({
            input: z
              .string()
              .optional()
              .describe("URL-encoded JSON, identical in shape to the POST body."),
          }),
        },
        responses,
      }),
      (async (c: Context<RpcAppEnv>) => {
        const raw = c.req.query("input");
        let parsedInput: unknown = {};
        if (raw) {
          try {
            parsedInput = JSON.parse(decodeURIComponent(raw));
          } catch {
            return c.json({ error: "Invalid `input` query parameter", code: "bad_request" }, 400);
          }
        }
        const parsed = def.input.safeParse(parsedInput);
        if (!parsed.success) {
          return c.json({ error: "Invalid input", code: "bad_request" }, 400);
        }
        const badSort = unsupportedSort(def, parsed.data);
        if (badSort) {
          return c.json({ error: `Cannot order by \`${badSort}\`.`, code: "bad_request" }, 400);
        }
        const result = await handler(parsed.data, buildRpcContext(c));
        return c.json(result as never, 200, {
          // Explicit, because the global middleware marks everything no-store
          // unless a handler opts in.
          "Cache-Control": `private, max-age=${def.cacheable?.maxAgeSeconds ?? 0}`,
          Vary: "Authorization, Cookie, X-Roastery-Org",
        });
        // biome-ignore lint/suspicious/noExplicitAny: as in the POST registration above.
      }) as any,
    );
  }
}
