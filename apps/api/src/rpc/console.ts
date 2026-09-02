import { OpenAPIHono } from "@hono/zod-openapi";
import { orgMembers, users } from "@roastery/db/schema";
import {
  createApiKeyInput,
  createApiKeyOutput,
  createOAuthClientInput,
  createOAuthClientOutput,
  entitlementsOutput,
  getAccessInput,
  getAccessOutput,
  getEntitlementsInput,
  listApiKeysInput,
  listApiKeysOutput,
  listMembersInput,
  listMembersOutput,
  listOAuthClientsInput,
  listOAuthClientsOutput,
  okOutput,
  removeMemberInput,
  revokeApiKeyInput,
  revokeOAuthClientInput,
  updateMemberRoleInput,
} from "@roastery/schemas";
import { desc, eq } from "drizzle-orm";
import { BadRequest, NotFound } from "../lib/api/errors";
import { type RpcAppEnv, registerRpc } from "../lib/api/rpc";
import { issueApiKey, listApiKeys, revokeApiKey } from "../lib/auth/api-keys";
import { issueOAuthClient, listOAuthClients, revokeOAuthClient } from "../lib/auth/oauth-clients";
import type { OrgDb } from "../lib/db/org-db";

/**
 * Operations the console needs that are not part of the coffee domain.
 *
 * Marked `internal`, so they are in the OpenAPI document (typed, tested,
 * reachable by the console's generated client) but filtered from the public
 * docs page. They are NOT a separate surface: same middleware, same
 * permissions, same tenancy.
 */
export const consoleRoutes = new OpenAPIHono<RpcAppEnv>();

function metaOf(raw: unknown): { roleSlug: string | null; scopes: string[] | null } {
  let obj: Record<string, unknown> | null = null;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      obj = null;
    }
  } else if (raw && typeof raw === "object") {
    obj = raw as Record<string, unknown>;
  }
  const scopes = obj?.scopes;
  return {
    roleSlug: typeof obj?.roleSlug === "string" ? obj.roleSlug : null,
    scopes: Array.isArray(scopes) ? scopes.filter((s): s is string => typeof s === "string") : null,
  };
}

/* --------------------------------------------------------------- members */

registerRpc(
  consoleRoutes,
  {
    namespace: "console",
    operation: "listMembers",
    summary: "List organization members",
    input: listMembersInput,
    output: listMembersOutput,
    permission: "console.members.read",
    module: "core",
    internal: true,
    cacheable: { maxAgeSeconds: 10 },
  },
  async (input, ctx) => {
    const limit = Math.min(input.page?.limit ?? 50, 200);
    const rows = await ctx.db.query(async (tx, scope) =>
      tx
        .select({
          id: orgMembers.id,
          userId: orgMembers.userId,
          roleSlug: orgMembers.roleSlug,
          createdAt: orgMembers.createdAt,
          email: users.email,
          name: users.name,
        })
        .from(orgMembers)
        // scope() is the tenant predicate; the join to users is global by
        // design, since a user may belong to several organizations.
        .innerJoin(users, eq(users.id, orgMembers.userId))
        .where(scope(orgMembers))
        .orderBy(desc(orgMembers.createdAt))
        .limit(limit),
    );

    return {
      items: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        email: r.email,
        name: r.name,
        roleSlug: r.roleSlug,
        createdAt: r.createdAt.toISOString(),
      })),
      page: { nextCursor: null, hasMore: false },
    };
  },
);

registerRpc(
  consoleRoutes,
  {
    namespace: "console",
    operation: "updateMemberRole",
    summary: "Change a member's role",
    input: updateMemberRoleInput,
    output: okOutput,
    permission: "console.members.write",
    module: "core",
    internal: true,
  },
  async (input, ctx) => {
    // Removing the last owner would leave an organization nobody can administer
    // — including nobody who can add another owner. Refuse rather than repair.
    if (input.roleSlug !== "owner") {
      await assertNotLastOwner(ctx.db, input.userId);
    }
    const rows = await ctx.db.update(
      orgMembers,
      { roleSlug: input.roleSlug },
      eq(orgMembers.userId, input.userId),
    );
    if (!rows.length) throw new NotFound("Member not found");
    return { ok: true };
  },
);

registerRpc(
  consoleRoutes,
  {
    namespace: "console",
    operation: "removeMember",
    summary: "Remove a member from the organization",
    input: removeMemberInput,
    output: okOutput,
    permission: "console.members.write",
    module: "core",
    internal: true,
  },
  async (input, ctx) => {
    await assertNotLastOwner(ctx.db, input.userId);
    const removed = await ctx.db.delete(orgMembers, eq(orgMembers.userId, input.userId));
    if (!removed) throw new NotFound("Member not found");
    return { ok: true };
  },
);

/**
 * Refuses a change that would leave an organization with no owner.
 *
 * Without this, demoting or removing the last owner produces a tenant nobody
 * can administer — including nobody who can appoint a new owner. Recovering
 * from that needs support intervention, so it is worth blocking at the edge.
 */
async function assertNotLastOwner(db: OrgDb, userId: string): Promise<void> {
  const member = await db.findOne(orgMembers, eq(orgMembers.userId, userId));
  if (member?.roleSlug !== "owner") return;
  const owners = await db.count(orgMembers, eq(orgMembers.roleSlug, "owner"));
  if (owners <= 1) {
    throw new BadRequest(
      "This is the organization's only owner. Promote another member to owner first.",
    );
  }
}

/* ------------------------------------------------------------ credentials */

registerRpc(
  consoleRoutes,
  {
    namespace: "console",
    operation: "listApiKeys",
    summary: "List API keys",
    input: listApiKeysInput,
    output: listApiKeysOutput,
    permission: "console.credentials.read",
    module: "api",
    internal: true,
  },
  async (_input, ctx) => {
    const rows = await listApiKeys(ctx.db);
    return {
      items: rows.map((r) => {
        const meta = metaOf(r.metadata);
        return {
          id: r.id,
          name: r.name,
          start: r.start,
          enabled: r.enabled,
          roleSlug: meta.roleSlug,
          scopes: meta.scopes,
          expiresAt: r.expiresAt?.toISOString() ?? null,
          lastRequest: r.lastRequest?.toISOString() ?? null,
          requestCount: r.requestCount,
          createdAt: r.createdAt.toISOString(),
        };
      }),
    };
  },
);

registerRpc(
  consoleRoutes,
  {
    namespace: "console",
    operation: "createApiKey",
    summary: "Create an API key",
    description:
      "The key is returned once, at creation, and cannot be recovered afterwards — only " +
      "its first characters are stored.",
    input: createApiKeyInput,
    output: createApiKeyOutput,
    permission: "console.credentials.write",
    module: "api",
    internal: true,
  },
  async (input, ctx) => {
    const issued = await issueApiKey(ctx.db, {
      name: input.name,
      roleSlug: input.roleSlug,
      scopes: input.scopes ?? null,
      expiresAt: input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 86_400_000)
        : null,
    });
    return {
      id: issued.id,
      key: issued.key,
      name: issued.name,
      start: issued.start,
      roleSlug: issued.roleSlug,
      scopes: issued.scopes,
      expiresAt: issued.expiresAt?.toISOString() ?? null,
      createdAt: issued.createdAt.toISOString(),
    };
  },
);

registerRpc(
  consoleRoutes,
  {
    namespace: "console",
    operation: "revokeApiKey",
    summary: "Revoke an API key",
    description: "Disables the key. The row is kept so its audit trail stays joinable.",
    input: revokeApiKeyInput,
    output: okOutput,
    permission: "console.credentials.write",
    module: "api",
    internal: true,
  },
  async (input, ctx) => {
    const ok = await revokeApiKey(ctx.db, input.id);
    if (!ok) throw new NotFound("API key not found");
    return { ok: true };
  },
);

registerRpc(
  consoleRoutes,
  {
    namespace: "console",
    operation: "listOAuthClients",
    summary: "List machine credentials (OAuth clients)",
    input: listOAuthClientsInput,
    output: listOAuthClientsOutput,
    permission: "console.credentials.read",
    module: "api",
    internal: true,
  },
  async (_input, ctx) => {
    const rows = await listOAuthClients(ctx.db);
    return {
      items: rows.map((r) => ({
        id: r.id,
        clientId: r.clientId,
        name: r.name,
        disabled: r.disabled ?? false,
        roleSlug: metaOf(r.metadata).roleSlug,
        scopes: r.scopes ?? null,
        createdAt: r.createdAt?.toISOString() ?? null,
      })),
    };
  },
);

registerRpc(
  consoleRoutes,
  {
    namespace: "console",
    operation: "createOAuthClient",
    summary: "Create a machine credential",
    description:
      "Issues an OAuth 2.0 client for the `client_credentials` grant. The secret is " +
      "returned once. Pass `resource` at the token endpoint to receive a JWT access token.",
    input: createOAuthClientInput,
    output: createOAuthClientOutput,
    permission: "console.credentials.write",
    module: "api",
    internal: true,
  },
  async (input, ctx) => {
    const issued = await issueOAuthClient(ctx.db, {
      name: input.name,
      roleSlug: input.roleSlug,
      scopes: input.scopes,
    });
    return {
      id: issued.id,
      clientId: issued.clientId,
      clientSecret: issued.clientSecret,
      name: issued.name,
      roleSlug: issued.roleSlug,
      scopes: issued.scopes,
      createdAt: issued.createdAt.toISOString(),
    };
  },
);

registerRpc(
  consoleRoutes,
  {
    namespace: "console",
    operation: "revokeOAuthClient",
    summary: "Revoke a machine credential",
    description:
      "Takes effect immediately: outstanding access tokens stop working on the next " +
      "request, without waiting for them to expire.",
    input: revokeOAuthClientInput,
    output: okOutput,
    permission: "console.credentials.write",
    module: "api",
    internal: true,
  },
  async (input, ctx) => {
    const ok = await revokeOAuthClient(ctx.db, input.clientId);
    if (!ok) throw new NotFound("Client not found");
    return { ok: true };
  },
);

/* ----------------------------------------------------------- entitlements */

registerRpc(
  consoleRoutes,
  {
    namespace: "console",
    operation: "getEntitlements",
    summary: "The organization's plan, modules and limits",
    description:
      "What the console reads to decide which modules to show as available and which to " +
      "show locked with an upgrade path.",
    input: getEntitlementsInput,
    output: entitlementsOutput,
    permission: "console.billing.read",
    module: "core",
    internal: true,
    cacheable: { maxAgeSeconds: 30 },
  },
  async (_input, ctx) => {
    const modules: Record<string, boolean> = {};
    const limits: Record<string, number | null> = {};
    for (const [key, value] of Object.entries(ctx.entitlements.values)) {
      if (key.startsWith("module:")) modules[key.slice("module:".length)] = value === true;
      else if (key.startsWith("limit:")) {
        limits[key.slice("limit:".length)] =
          value === null || value === "unlimited" ? null : Number(value);
      }
    }
    return {
      planSlug: ctx.entitlements.planSlug,
      status: ctx.entitlements.status,
      modules,
      limits,
    };
  },
);

/**
 * Everything the console needs to render itself for the active organization.
 *
 * One call rather than three, because the shell cannot draw anything until it
 * has all of it — the navigation needs entitlements to know what to lock, and
 * every action needs the permission set to know what to offer. Three round
 * trips would mean three chances to render a half-formed shell.
 *
 * Granted to every built-in role, viewer included: this is not privileged
 * information, it is the answer to "what can I do here", and a user who cannot
 * ask it cannot be shown a working product.
 */
registerRpc(
  consoleRoutes,
  {
    namespace: "console",
    operation: "getAccess",
    summary: "Your role, permissions and plan in this organization",
    input: getAccessInput,
    output: getAccessOutput,
    permission: "console.self.read",
    module: "core",
    internal: true,
  },
  async (_input, ctx) => {
    // Entitlements are stored as one flat `module:x` / `limit:y` map. Split
    // here rather than in the client so both surfaces cannot disagree about
    // what a key prefix means.
    const modules: Record<string, boolean> = {};
    const limits: Record<string, number | null> = {};
    for (const [key, value] of Object.entries(ctx.entitlements.values)) {
      if (key.startsWith("module:")) modules[key.slice(7)] = value === true;
      else if (key.startsWith("limit:")) {
        limits[key.slice(6)] = typeof value === "number" ? value : null;
      }
    }

    return {
      orgId: ctx.orgId,
      permissions: [...ctx.permissions],
      entitlements: { planSlug: ctx.entitlements.planSlug, modules, limits },
    };
  },
);
