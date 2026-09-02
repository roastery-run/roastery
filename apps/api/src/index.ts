import type {
  ExecutionContext,
  MessageBatch,
  ScheduledController,
} from "@cloudflare/workers-types";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createAuth } from "@roastery/auth";
import { Scalar } from "@scalar/hono-api-reference";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { handleScheduled } from "./cron";
import type {
  Env,
  EventQueueMessage,
  ReportQueueMessage,
  ShotQueueMessage,
  WebhookQueueMessage,
} from "./env";
import { assertProductionBindings } from "./env";
import { ingestRoutes } from "./http/ingest";
import { publicRoutes } from "./http/public";
import { sessionRoutes } from "./http/session";
import { streamRoutes } from "./http/stream";
import { isHttpError } from "./lib/api/errors";
import { rateLimit } from "./lib/api/rate-limit";
import { RPC_REGISTRY, type RpcAppEnv, rpcPath } from "./lib/api/rpc";
import { rpcAuthorize } from "./lib/api/rpc-authorize";
import { authMiddleware } from "./lib/auth/auth-middleware";
import { QuotaExceeded } from "./lib/auth/entitlements";
import { orgScope } from "./lib/auth/org-scope";
import { closeWorkerDb, createWorkerDb, safeExecutionCtx } from "./lib/db/db";
import { createEmailSender } from "./lib/email/send";
import {
  handleDeadLetterBatch,
  handleEventQueue,
  handleReportQueue,
  handleShotQueue,
  handleWebhookQueue,
} from "./queue";
import { mountRpcRoutes } from "./rpc";

/**
 * One error envelope for the whole API.
 *
 * Without this hook @hono/zod-openapi returns a raw ZodError, so clients would
 * have to parse two different failure shapes depending on whether validation
 * or the handler rejected the request. `fields` is a flat path -> message map,
 * which is what the console binds directly onto form fields.
 */
const app = new OpenAPIHono<RpcAppEnv>({
  defaultHook: (result, c) => {
    if (result.success) return undefined;
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join(".") || "(root)";
      if (!fields[path]) fields[path] = issue.message;
    }
    return c.json({ error: "Invalid request", code: "validation_failed", fields }, 400);
  },
});

/* ------------------------------------------------------------- middleware */

app.use("*", async (c, next) => {
  assertProductionBindings(c.env);
  await next();
});

app.use("*", secureHeaders());

/**
 * Default every response to no-store, so caching is strictly opt-in. A handler
 * that wants to be cached says so (see `cacheable` in lib/rpc.ts); nothing is
 * cached by accident, which for a multi-tenant API is the only safe default.
 */
app.use("*", async (c, next) => {
  await next();
  if (!c.res.headers.get("Cache-Control")) {
    c.res.headers.set("Cache-Control", "no-store");
  }
});

app.use("*", bodyLimit({ maxSize: 25 * 1024 * 1024 }));

app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const allowed = [c.env.WEB_URL, c.env.CONSOLE_URL].filter(Boolean) as string[];
      return allowed.includes(origin) ? origin : (allowed[0] ?? null);
    },
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "X-Roastery-Org", "Idempotency-Key"],
    exposeHeaders: ["RateLimit-Limit", "RateLimit-Reset", "Retry-After"],
  }),
);

/* ------------------------------------------------------------------- auth */

// Better Auth owns the human-authentication surface. Machine credentials are a
// separate concern (Phase 2: @better-auth/oauth-provider client_credentials).
// Session reads are authenticated and cheap but fire on every SPA navigation;
// they get their own budget so they cannot be starved by the strict limit that
// protects the unauthenticated, email-sending endpoints.
app.use("/api/auth/*", async (c, next) => {
  const isSessionRead = c.req.path.includes("get-session");
  const limiter = isSessionRead
    ? rateLimit("SESSION_RATE_LIMITER", { limit: 300, windowMs: 60_000 })
    : rateLimit("AUTH_RATE_LIMITER", { limit: 20, windowMs: 60_000 });
  return limiter(c as never, next);
});

app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const db = createWorkerDb(c.env);
  try {
    const auth = createAuth(db, c.env, createEmailSender(c.env));
    return await auth.handler(c.req.raw);
  } finally {
    await closeWorkerDb(db, safeExecutionCtx(c));
  }
});

/* -------------------------------------------------------------- RPC chain */

// Order is load-bearing. Authorization must precede Hono's Zod validators,
// which run as part of the route itself — otherwise an unauthenticated caller
// sending a malformed body gets a 400 describing the request schema.
/**
 * The bootstrap call: authenticated, but deliberately NOT org-scoped.
 *
 * "Which organizations may I act in?" has no organization to scope to, so it
 * sits above the org middleware. Everything else on /rpc/v1 requires a tenant.
 */
app.use("/session/v1/*", rateLimit("SESSION_RATE_LIMITER", { limit: 300, windowMs: 60_000 }));
app.use("/session/v1/*", authMiddleware);
app.route("/", sessionRoutes);

app.use("/rpc/v1/*", rateLimit("RPC_SUSTAINED_LIMITER", { limit: 300, windowMs: 60_000 }));
app.use("/rpc/v1/*", rateLimit("RPC_BURST_LIMITER", { limit: 60, windowMs: 10_000 }));
app.use("/rpc/v1/*", authMiddleware);
app.use("/rpc/v1/*", orgScope);
app.use("/rpc/v1/*", rpcAuthorize);

mountRpcRoutes(app);

/* ------------------------------------------------------- telemetry surfaces */

// Deliberately NOT under /rpc/v1: machine ingest carries a bridge token rather
// than a user or client credential, routes straight to a Durable Object with
// no database on the hot path, and needs a rate budget two orders of magnitude
// higher than the business API.
app.use("/ingest/v1/*", rateLimit("INGEST_LIMITER", { limit: 1000, windowMs: 10_000 }));
app.route("/", ingestRoutes);
app.route("/", streamRoutes);

/**
 * Unauthenticated by design: a QR code on a retail bag and a signed report
 * link are both opened by someone with no session. Both carry their own
 * protection — an unguessable global token, and an expiring signature.
 */
app.use("/trace/v1/*", rateLimit("RPC_SUSTAINED_LIMITER", { limit: 300, windowMs: 60_000 }));
app.use("/reports/v1/*", rateLimit("AUTH_RATE_LIMITER", { limit: 20, windowMs: 60_000 }));
app.route("/", publicRoutes);

/* --------------------------------------------------------------- metadata */

app.doc("/openapi.json", (c) => ({
  openapi: "3.1.0",
  info: {
    title: "ROASTERY API",
    version: "1.0.0",
    description:
      "Domain-oriented RPC API for coffee operations. Every operation is a POST to " +
      "`/rpc/v1/{namespace}.{operation}`; pure reads are additionally available as GET " +
      "with a URL-encoded `input` query parameter.\n\n" +
      "Authenticate with an OAuth 2.0 `client_credentials` token, or an `sk_` API key as " +
      "`Authorization: Bearer`. Pass `resource` at the token endpoint to receive a JWT " +
      "access token; without it the token is opaque.",
  },
  // Derived from the request, so the docs point at the host you are reading
  // them on rather than at production from a preview deployment.
  servers: [{ url: new URL(c.req.url).origin, description: "This deployment" }],
}));

/**
 * The public documentation surface.
 *
 * Console-only operations are in the OpenAPI document — so the console's
 * generated client is typed and the authorization test can enumerate them —
 * but they are not part of the product's integration contract, so publishing
 * them would invite integrators to build on operations we may change freely.
 */
app.get("/openapi.public.json", async (c) => {
  const doc = app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "ROASTERY API", version: "1.0.0" },
    servers: [{ url: new URL(c.req.url).origin }],
  }) as { paths: Record<string, unknown> };

  const internal = new Set(RPC_REGISTRY.filter((d) => d.internal).map((d) => rpcPath(d)));
  const paths: Record<string, unknown> = {};
  for (const [path, item] of Object.entries(doc.paths)) {
    if (!internal.has(path)) paths[path] = item;
  }
  return c.json({ ...doc, paths });
});

app.get("/docs", Scalar({ url: "/openapi.public.json", pageTitle: "ROASTERY API" }));

app.get("/health", async (c) => {
  const deep = c.req.query("deep") === "1";
  if (!deep) return c.json({ ok: true, operations: RPC_REGISTRY.length });

  const db = createWorkerDb(c.env);
  try {
    const who = await db.execute(
      "select current_database() as db, current_schema() as schema, " +
        "(select count(*) from information_schema.tables where table_schema='public') as tables",
    );
    return c.json({
      ok: true,
      database: "up",
      connection: who[0] ?? null,
      operations: RPC_REGISTRY.length,
    });
  } catch (err) {
    return c.json(
      { ok: false, database: "down", error: err instanceof Error ? err.message : String(err) },
      503,
    );
  } finally {
    await closeWorkerDb(db, safeExecutionCtx(c));
  }
});

app.notFound((c) => c.json({ error: "Not found", code: "not_found" }, 404));

/** Flattens a wrapped error chain into readable messages. */
function causeChain(err: unknown, depth = 0): string[] {
  if (depth > 5 || !(err instanceof Error)) return [];
  const self = `${err.name}: ${err.message}`;
  return [self, ...causeChain((err as { cause?: unknown }).cause, depth + 1)];
}

app.onError((err, c) => {
  if (err instanceof QuotaExceeded) {
    return c.json(
      {
        error: err.message,
        code: err.code,
        key: err.key,
        limit: err.limit,
        current: err.current,
        plan: c.var.entitlements?.planSlug,
      },
      402,
    );
  }
  if (isHttpError(err)) {
    return c.json({ error: err.message, code: err.code }, err.status as 400);
  }
  // The CF ray is the correlation id support asks the customer to quote.
  const correlationId = c.req.header("cf-ray") ?? crypto.randomUUID();
  console.error(
    JSON.stringify({
      msg: "unhandled_error",
      correlationId,
      path: c.req.path,
      error: err instanceof Error ? err.message : String(err),
      // Drizzle wraps driver errors, so the message alone says "Failed query"
      // and nothing about WHY. The cause chain is the actionable part.
      cause: causeChain(err),
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );
  return c.json({ error: "Internal error", correlationId }, 500);
});

export { CafeSiteDO } from "./durable-objects/cafe-site";
export { RoastBatchDO } from "./durable-objects/roast-batch";

/**
 * The Hono app itself, so the authorization test can enumerate the generated
 * OpenAPI document. The default export is the Worker handler object and no
 * longer carries Hono's methods.
 */
export { app };

/**
 * One Worker, three entry points.
 *
 * `fetch` is the API. `queue` drives webhook fan-out and delivery. `scheduled`
 * is the sweeper that makes the outbox durable rather than merely fast — see
 * src/cron/index.ts for why both exist.
 */
export default {
  fetch: app.fetch,

  async queue(
    batch: MessageBatch<
      EventQueueMessage & WebhookQueueMessage & ShotQueueMessage & ReportQueueMessage
    >,
    env: Env,
  ): Promise<void> {
    switch (batch.queue) {
      case "roastery-events":
        return handleEventQueue(batch as never, env);
      case "roastery-webhooks":
        return handleWebhookQueue(batch as never, env);
      case "roastery-shots":
        return handleShotQueue(batch as never, env);
      case "roastery-reports":
        return handleReportQueue(batch as never, env);
      case "roastery-events-dlq":
      case "roastery-webhooks-dlq":
      case "roastery-shots-dlq":
      case "roastery-reports-dlq":
        return handleDeadLetterBatch(batch as never, env);
      default:
        // Acknowledged rather than retried: an unknown queue name means a
        // configuration change, and redelivering forever would not fix it.
        console.error(JSON.stringify({ msg: "unknown_queue", queue: batch.queue }));
        for (const message of batch.messages) message.ack();
    }
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduled(event.cron, env));
  },
};
