import { createAuth } from "@roastery/auth";
import { createMiddleware } from "hono/factory";
import type { Env } from "../../env";
import { closeWorkerDb, createWorkerDb, safeExecutionCtx, type WorkerDb } from "../db/db";
import { verifyOAuthToken } from "./oauth-token";

export type Credential =
  | { type: "session" }
  | {
      type: "api_key";
      id: string;
      orgId: string;
      roleSlug: string;
      scopes: string[] | null;
      createdBy: string | null;
    }
  | {
      type: "oauth_client";
      clientId: string;
      orgId: string;
      roleSlug: string;
      scopes: string[] | null;
    };

export type AuthContext = {
  userId: string | null;
  credential: Credential | null;
};

export type AuthVariables = {
  auth: AuthContext;
  /**
   * The UNSCOPED database handle.
   *
   * Named `unsafeDb` on purpose. There is no `c.var.db`. Handlers must use
   * `c.var.orgDb`; a reference to this name inside src/rpc/** fails the
   * authorization test unless annotated `// unsafe-db-ok: <reason>`.
   */
  unsafeDb: WorkerDb;
};

/**
 * Failures that mean "slow down", not "your credential is bad".
 *
 * Matched on both code and message because the plugin surfaces them
 * inconsistently across its error paths, and misclassifying a throttle as an
 * auth failure is worse than the redundancy.
 */
function isThrottled(failure: string | null): boolean {
  if (!failure) return false;
  const f = failure.toUpperCase();
  return (
    f.includes("RATE_LIMIT") ||
    f.includes("RATE LIMIT") ||
    f.includes("USAGE_EXCEEDED") ||
    f.includes("USAGE LIMIT")
  );
}

/** The subset of the plugin's ApiKey we depend on. */
type VerifiedKey = {
  id: string;
  referenceId: string;
  metadata: unknown;
};

type KeyMetadata = {
  roleSlug: string | null;
  /** null = no down-scoping; [] = explicitly inert. See loadPermissions. */
  scopes: string[] | null;
  createdBy: string | null;
};

/**
 * The plugin stores metadata as a JSON string and parses it back on read, so
 * this accepts either shape and never throws — malformed metadata must not
 * turn into a 500 on the authentication path.
 */
function parseKeyMetadata(raw: unknown): KeyMetadata {
  let obj: Record<string, unknown> | null = null;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      obj = null;
    }
  } else if (typeof raw === "object" && raw !== null) {
    obj = raw as Record<string, unknown>;
  }
  if (!obj) return { roleSlug: null, scopes: null, createdBy: null };

  const scopes = obj.scopes;
  return {
    roleSlug: typeof obj.roleSlug === "string" ? obj.roleSlug : null,
    scopes: Array.isArray(scopes) ? scopes.filter((x): x is string => typeof x === "string") : null,
    createdBy: typeof obj.createdBy === "string" ? obj.createdBy : null,
  };
}

async function resolveSessionUserId(
  db: WorkerDb,
  env: Env,
  headers: Headers,
): Promise<string | null> {
  try {
    const auth = createAuth(db, env);
    const session = await auth.api.getSession({ headers });
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

export const authMiddleware = createMiddleware<{ Bindings: Env; Variables: AuthVariables }>(
  async (c, next) => {
    const db = createWorkerDb(c.env);
    c.set("unsafeDb", db);

    let userId: string | null = null;
    let credential: Credential | null = null;

    const header = c.req.header("Authorization");

    if (header?.startsWith("Bearer sk_")) {
      const raw = header.slice("Bearer ".length);
      const auth = createAuth(db, c.env);

      // The plugin owns hash comparison, expiry, enable/disable, the rate
      // limit and the refill counter, and it stamps requestCount/lastRequest.
      // An invalid key authenticates as no one rather than erroring, so a
      // stale key behaves exactly like an unknown one.
      let verified: VerifiedKey | null = null;
      let failure: string | null = null;
      try {
        const result = await auth.api.verifyApiKey({ body: { key: raw } });
        if (result.valid && result.key) verified = result.key as VerifiedKey;
        else {
          const e = result.error as { code?: string; message?: string } | null;
          failure = e?.code ?? e?.message ?? null;
        }
      } catch {
        verified = null;
      }

      // A throttled caller is authenticated, just over budget. Returning 401
      // would tell them to re-authenticate, which cannot help and invites a
      // credential-rotation loop; 429 tells them to back off.
      if (!verified && isThrottled(failure)) {
        const window = c.req.header("Retry-After") ?? "60";
        return c.json({ error: "Rate limit exceeded", code: "rate_limited" }, 429, {
          "Retry-After": window,
        });
      }

      if (verified) {
        const meta = parseKeyMetadata(verified.metadata);
        // A key whose metadata carries no role cannot be authorized against
        // our permissions table, so it authenticates as nothing. Failing
        // closed here is deliberate: the alternative is inventing a default
        // role for a credential nobody deliberately granted one.
        if (meta.roleSlug) {
          credential = {
            type: "api_key",
            id: verified.id,
            orgId: verified.referenceId,
            roleSlug: meta.roleSlug,
            scopes: meta.scopes,
            createdBy: meta.createdBy ?? null,
          };
          userId = meta.createdBy ?? null;
        }
      }
    } else if (header?.startsWith("Bearer ")) {
      // An OAuth access token from the client_credentials grant. Validation is
      // stateless JWT verification, so this costs no database round-trip — the
      // property that makes the documented request budget affordable.
      const claims = await verifyOAuthToken(db, header.slice("Bearer ".length));
      if (claims) {
        credential = {
          type: "oauth_client",
          clientId: claims.clientId,
          orgId: claims.orgId,
          roleSlug: claims.roleSlug,
          scopes: claims.scopes,
        };
      }
    } else {
      userId = await resolveSessionUserId(db, c.env, c.req.raw.headers);
      if (userId) credential = { type: "session" };
    }

    c.set("auth", { userId, credential });

    try {
      await next();
    } finally {
      await closeWorkerDb(db, safeExecutionCtx(c));
    }
  },
);
