import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { ModuleKey } from "@roastery/schemas";
import type { Context } from "hono";
import type { Env } from "../env";
import type { AuthContext } from "./auth-middleware";
import type { WorkerDb } from "./db";
import type { Entitlements } from "./entitlements";
import { entitlementErrorSchema, errorResponses } from "./openapi";
import type { Actor, OrgDb } from "./org-db";
import { can } from "./permissions";

export type RpcVariables = {
  auth: AuthContext;
  unsafeDb: WorkerDb;
  orgId: string;
  orgDb: OrgDb;
  perms: ReadonlySet<string>;
  entitlements: Entitlements;
  actor: Actor;
};

export type RpcAppEnv = { Bindings: Env; Variables: RpcVariables };

export type RpcContext = {
  db: OrgDb;
  env: Env;
  orgId: string;
  actor: Actor;
  can: (permission: string) => boolean;
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
  /** Console-only. In the spec and typed, hidden from the public docs page. */
  internal?: boolean;
};

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

function buildRpcContext(c: Context<RpcAppEnv>): RpcContext {
  return {
    db: c.var.orgDb,
    env: c.env,
    orgId: c.var.orgId,
    actor: c.var.actor,
    can: (permission: string) => can(c.var.perms, permission),
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

  const headers = z.object({
    "x-roastery-org": z
      .string()
      .optional()
      .describe(
        "Target organization. Required for session callers. Ignored for machine " +
          "credentials, which are permanently bound to one organization.",
      ),
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
      const result = await handler(input, buildRpcContext(c));
      return c.json(result as never, 200);
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
