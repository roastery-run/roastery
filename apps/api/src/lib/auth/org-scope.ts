import { orgMembers } from "@roastery/db/schema";
import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import type { Env } from "../../env";
import type { RpcVariables } from "../api/rpc";
import type { WorkerDb } from "../db/db";
import { type Actor, createOrgDb, type EmittedEvent } from "../db/org-db";
import type { AuthContext } from "./auth-middleware";
import { loadEntitlements } from "./entitlements";
import { loadPermissions } from "./permissions";

export async function getOrgMembership(db: WorkerDb, orgId: string, userId: string) {
  const [member] = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  return member ?? null;
}

/**
 * Who made this request, and on whose behalf.
 *
 * `id` names the credential — that is what an audit trail must record, since
 * revoking a key needs to reach everything it did. `userId` names the person,
 * which is what attribution needs, and it survives being reached through a key.
 */
function toActor(auth: AuthContext): Actor {
  const cred = auth.credential;
  if (cred?.type === "api_key") {
    return { id: cred.id, type: "api_key", userId: auth.userId };
  }
  if (cred?.type === "oauth_client") {
    // A machine client acts for no person; attributing its writes to whoever
    // created it would put a name on something nobody did.
    return { id: cred.clientId, type: "oauth_client", userId: null };
  }
  return { id: auth.userId, type: "user", userId: auth.userId };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the tenant and loads the access bundle.
 *
 * This is the ONLY place an OrgDb is constructed, and it happens only after
 * access has been verified — so a handler that holds one has, by construction,
 * already passed the tenancy check. That is the property the whole
 * authorization design rests on.
 */
export const orgScope = createMiddleware<{ Bindings: Env; Variables: RpcVariables }>(
  async (c, next) => {
    const auth = c.var.auth;
    const db = c.var.unsafeDb;
    const cred = auth.credential;

    // Held as one narrowed value so the discriminated union survives; reading
    // `.orgId` and `.roleSlug` off `cred` separately loses the narrowing.
    const machine = cred && cred.type !== "session" ? cred : null;
    const requested = c.req.header("X-Roastery-Org")?.trim() || null;

    let orgId: string;
    let roleSlug: string;

    if (machine) {
      // A machine credential is permanently bound to one organization.
      // Redirecting it at another is a 403, never a silent switch.
      if (requested && requested !== machine.orgId) {
        return c.json(
          { error: "Credential is not scoped to that organization", code: "org_mismatch" },
          403,
        );
      }
      orgId = machine.orgId;
      roleSlug = machine.roleSlug;
    } else {
      if (!auth.userId) {
        return c.json({ error: "Unauthorized", code: "unauthenticated" }, 401);
      }
      if (!requested) {
        return c.json({ error: "X-Roastery-Org header is required", code: "org_required" }, 400);
      }
      if (!UUID_RE.test(requested)) {
        return c.json({ error: "Forbidden", code: "org_forbidden" }, 403);
      }
      const member = await getOrgMembership(db, requested, auth.userId);
      // Deliberately indistinguishable from "that organization does not
      // exist": a non-member must not be able to probe which org ids are real.
      if (!member) {
        return c.json({ error: "Forbidden", code: "org_forbidden" }, 403);
      }
      orgId = requested;
      roleSlug = member.roleSlug;
    }

    // A session is never down-scoped; a machine credential may be.
    const scopes = machine ? machine.scopes : null;
    const [perms, entitlements] = await Promise.all([
      loadPermissions(c.env, db, orgId, roleSlug, scopes),
      loadEntitlements(c.env, db, orgId),
    ]);

    const actor = toActor(auth);
    // Events emitted by this request land here and are flushed to the fan-out
    // queue AFTER the handler returns — never inside it, or a transaction that
    // later rolls back would still have published.
    const emitted: EmittedEvent[] = [];

    c.set("orgId", orgId);
    c.set("perms", perms);
    c.set("entitlements", entitlements);
    c.set("actor", actor);
    c.set("emittedEvents", emitted);
    c.set("orgDb", createOrgDb(db, orgId, actor, { push: (e) => emitted.push(e) }));

    await next();
    return undefined;
  },
);
