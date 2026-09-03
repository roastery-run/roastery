import { createAuth } from "@roastery/auth";
import { createMiddleware } from "hono/factory";
import type { Env } from "../../env";
import { startTimings, type Timings, timed } from "../api/timing";
import { closeWorkerDb, createWorkerDb, safeExecutionCtx, type WorkerDb } from "../db/db";
import { createEmailSender } from "../email/send";
import { recordApiKeyUse, verifyApiKey } from "./api-keys";
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
  /** Per-layer durations, emitted as `Server-Timing`. */
  timings: Timings;
};

/**
 * The session cookie's user, or nothing.
 *
 * Never throws: an unreadable cookie must authenticate as nobody rather than
 * turning into a 500 on the authentication path.
 */
async function resolveSessionUserId(
  db: WorkerDb,
  env: Env,
  headers: Headers,
): Promise<string | null> {
  try {
    const auth = createAuth(db, env, createEmailSender(env));
    const session = await auth.api.getSession({ headers });
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

export const authMiddleware = createMiddleware<{ Bindings: Env; Variables: AuthVariables }>(
  async (c, next) => {
    const timings = startTimings();
    c.set("timings", timings);
    const db = createWorkerDb(c.env);
    c.set("unsafeDb", db);

    let userId: string | null = null;
    let credential: Credential | null = null;
    /** Set once a key authenticates; stamped after the response. */
    let usedKeyId: string | null = null;

    const header = c.req.header("Authorization");

    if (header?.startsWith("Bearer sk_")) {
      const raw = header.slice("Bearer ".length);

      /**
       * One indexed read, on the caching-disabled handle.
       *
       * The plugin's `verifyApiKey` issued four statements — lookup, rate-limit
       * counters, an `updatedAt` bump, and a sweep of expired keys — and only
       * the first answers a question this request needs answered. See
       * `verifyApiKey` in ../auth/api-keys for what moved where.
       *
       * An invalid key authenticates as no one rather than erroring, so a
       * stale key behaves exactly like an unknown one.
       */
      const verified = await timed(timings, "verifyKey", () => verifyApiKey(db, raw));

      if (verified) {
        credential = {
          type: "api_key",
          id: verified.id,
          orgId: verified.referenceId,
          roleSlug: verified.metadata.roleSlug,
          scopes: verified.metadata.scopes,
          createdBy: verified.metadata.createdBy,
        };
        userId = verified.metadata.createdBy;

        // Stamped after the handler, not here: the request holds a single
        // pooled connection (`max: 1` behind Hyperdrive), so firing the update
        // now makes the handler's own query queue behind it. Measured, that
        // moved 130ms out of `verifyKey` and straight into `handler`.
        usedKeyId = verified.id;
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
      const background = safeExecutionCtx(c);
      // Ordering matters: the usage stamp is queued before the close, and
      // `closeWorkerDb` ends the client with a five-second graceful drain, so
      // the update completes rather than being cut off mid-query.
      if (usedKeyId) background?.waitUntil(recordApiKeyUse(db, usedKeyId));
      await closeWorkerDb(db, background);
    }
  },
);
