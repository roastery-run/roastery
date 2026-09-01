import { OpenAPIHono } from "@hono/zod-openapi";
import { createAuth } from "@roastery/auth";
import { Scalar } from "@scalar/hono-api-reference";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { assertProductionBindings } from "./env";
import { authMiddleware } from "./lib/auth-middleware";
import { closeWorkerDb, createWorkerDb, safeExecutionCtx } from "./lib/db";
import { QuotaExceeded } from "./lib/entitlements";
import { isHttpError } from "./lib/errors";
import { orgScope } from "./lib/org-scope";
import { rateLimit } from "./lib/rate-limit";
import { RPC_REGISTRY, type RpcAppEnv, rpcPath } from "./lib/rpc";
import { rpcAuthorize } from "./lib/rpc-authorize";
import { catalogLocation } from "./rpc/catalog-location";
import { catalogMachine } from "./rpc/catalog-machine";
import { catalogParty } from "./rpc/catalog-party";
import { catalogProduct } from "./rpc/catalog-product";
import { consoleRoutes } from "./rpc/console";

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
    const auth = createAuth(db, c.env);
    return await auth.handler(c.req.raw);
  } finally {
    await closeWorkerDb(db, safeExecutionCtx(c));
  }
});

/* -------------------------------------------------------------- RPC chain */

// Order is load-bearing. Authorization must precede Hono's Zod validators,
// which run as part of the route itself — otherwise an unauthenticated caller
// sending a malformed body gets a 400 describing the request schema.
app.use("/rpc/v1/*", rateLimit("RPC_SUSTAINED_LIMITER", { limit: 300, windowMs: 60_000 }));
app.use("/rpc/v1/*", rateLimit("RPC_BURST_LIMITER", { limit: 60, windowMs: 10_000 }));
app.use("/rpc/v1/*", authMiddleware);
app.use("/rpc/v1/*", orgScope);
app.use("/rpc/v1/*", rpcAuthorize);

app.route("/", catalogLocation);
app.route("/", catalogMachine);
app.route("/", catalogParty);
app.route("/", catalogProduct);
app.route("/", consoleRoutes);

/* --------------------------------------------------------------- metadata */

app.doc("/openapi.json", (c) => ({
  openapi: "3.1.0",
  info: {
    title: "Roastery API",
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
    info: { title: "Roastery API", version: "1.0.0" },
    servers: [{ url: new URL(c.req.url).origin }],
  }) as { paths: Record<string, unknown> };

  const internal = new Set(RPC_REGISTRY.filter((d) => d.internal).map((d) => rpcPath(d)));
  const paths: Record<string, unknown> = {};
  for (const [path, item] of Object.entries(doc.paths)) {
    if (!internal.has(path)) paths[path] = item;
  }
  return c.json({ ...doc, paths });
});

app.get("/docs", Scalar({ url: "/openapi.public.json", pageTitle: "Roastery API" }));

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

export default app;
