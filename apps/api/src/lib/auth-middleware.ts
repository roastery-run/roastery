import { createAuth } from "@roastery/auth";
import { apiKeys } from "@roastery/db/schema";
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import type { Env } from "../env";
import { sha256 } from "./crypto";
import { closeWorkerDb, createWorkerDb, safeExecutionCtx, type WorkerDb } from "./db";

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
      const keyHash = await sha256(header.slice("Bearer ".length));
      const [record] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);
      // A revoked or expired key authenticates as no one — ignored rather than
      // errored, so a stale key falls through to session auth (or a 401 at the
      // route) exactly like an unknown one.
      const valid =
        record && !record.revokedAt && (!record.expiresAt || record.expiresAt > new Date());
      if (record && valid) {
        credential = {
          type: "api_key",
          id: record.id,
          orgId: record.orgId,
          roleSlug: record.roleSlug,
          scopes: record.scopes,
          createdBy: record.createdBy,
        };
        userId = record.createdBy;

        // `lastUsedAt` is approximate and sits on the hot auth path: only write
        // when stale, and never block the request on it.
        const last = record.lastUsedAt?.getTime() ?? 0;
        if (Date.now() - last > 5 * 60_000) {
          const write = db
            .update(apiKeys)
            .set({ lastUsedAt: new Date() })
            .where(eq(apiKeys.id, record.id));
          const ctx = safeExecutionCtx(c);
          if (ctx) ctx.waitUntil(write.catch(() => {}));
          else await write.catch(() => {});
        }
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
