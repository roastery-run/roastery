import { OpenAPIHono } from "@hono/zod-openapi";
import {
  apiKeys,
  dataExports,
  oauthClients,
  organizations,
  orgMembers,
  rolePermissions,
  users,
} from "@roastery/db/schema";
import {
  createApiKeyInput,
  createApiKeyOutput,
  createOAuthClientInput,
  createOAuthClientOutput,
  dataExportSchema,
  deleteOrganizationInput,
  deleteOrganizationOutput,
  entitlementsOutput,
  getAccessInput,
  getAccessOutput,
  getDataExportInput,
  getDataExportOutput,
  getEntitlementsInput,
  listApiKeysInput,
  listApiKeysOutput,
  listMembersInput,
  listMembersOutput,
  listOAuthClientsInput,
  listOAuthClientsOutput,
  okOutput,
  removeMemberInput,
  requestDataExportInput,
  revokeApiKeyInput,
  revokeOAuthClientInput,
  updateMemberRoleInput,
} from "@roastery/schemas";
import { and, desc, eq, sql } from "drizzle-orm";
import { BadRequest, Conflict, Forbidden, NotFound } from "../lib/api/errors";
import { type RpcAppEnv, type RpcContext, registerRpc } from "../lib/api/rpc";
import { issueApiKey, listApiKeys, revokeApiKey } from "../lib/auth/api-keys";
import { issueOAuthClient, listOAuthClients, revokeOAuthClient } from "../lib/auth/oauth-clients";
import { canGrantRole } from "../lib/auth/permissions";
import type { OrgDb } from "../lib/db/org-db";
import type { ExportManifest } from "../lib/domain/tenant-lifecycle";
import { downloadSigningKey, signDownload } from "../lib/reporting/signed-url";

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
    await assertCanGrant(ctx, input.roleSlug);

    await ctx.db.transaction(async (tx) => {
      const [existing] = await tx.query(async (t, scope) =>
        t
          .select({ roleSlug: orgMembers.roleSlug })
          .from(orgMembers)
          .where(and(scope(orgMembers), eq(orgMembers.userId, input.userId)))
          .limit(1),
      );
      if (!existing) throw new NotFound("Member not found");

      await tx.update(
        orgMembers,
        { roleSlug: input.roleSlug },
        eq(orgMembers.userId, input.userId),
      );
      await tx.emit({
        // No published type: who can do what inside one tenant is nobody
        // else's notification, and adding it to the webhook contract would
        // mean shipping membership changes to every integrator.
        type: null,
        resourceType: "org_member",
        resourceId: input.userId,
        action: "role_changed",
        audit: { from: existing.roleSlug, to: input.roleSlug },
      });
    });
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

    await ctx.db.transaction(async (tx) => {
      const [existing] = await tx.query(async (t, scope) =>
        t
          .select({ roleSlug: orgMembers.roleSlug })
          .from(orgMembers)
          .where(and(scope(orgMembers), eq(orgMembers.userId, input.userId)))
          .limit(1),
      );
      if (!existing) throw new NotFound("Member not found");

      await tx.delete(orgMembers, eq(orgMembers.userId, input.userId));
      await tx.emit({
        type: null,
        resourceType: "org_member",
        resourceId: input.userId,
        action: "removed",
        audit: { roleSlug: existing.roleSlug },
      });
    });
    return { ok: true };
  },
);

/**
 * Refuses to hand out more than the caller holds.
 *
 * `console.credentials.write` allows issuing credentials; it does not say
 * which ones. Without this, any role holding it could mint an owner-scoped
 * API key and act through it, and nothing about that would look unusual —
 * issuing keys is exactly what the permission is for. Today only `owner` holds
 * it, so there is no live escalation; this is what keeps that true the first
 * time a custom role is granted it.
 *
 * Compares permission SETS, not `roles.rank`. Rank is documented in the schema
 * and the seed as never being an authorization input, because a hierarchy
 * expressed as a number confers whatever sits below it — including anything a
 * later migration adds to a lower role.
 */
async function assertCanGrant(ctx: RpcContext, roleSlug: string): Promise<void> {
  // unscoped-ok: roles and role_permissions are TENANT_GLOBAL reference data —
  // `roles.slug` is a global primary key, and a built-in role carries no orgId
  // at all. There is no tenant column here to scope by.
  const rows = await ctx.db.query(async (t) =>
    t
      .select({ permissionSlug: rolePermissions.permissionSlug })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleSlug, roleSlug)),
  );
  const target = new Set(rows.map((r) => r.permissionSlug));
  if (target.size === 0) throw new NotFound("Role not found");

  if (!canGrantRole(ctx.permissions, target)) {
    throw new Forbidden(
      `You cannot grant the "${roleSlug}" role: it carries permissions you do not hold.`,
    );
  }
}

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
    await assertCanGrant(ctx, input.roleSlug);
    const issued = await issueApiKey(ctx.db, {
      name: input.name,
      roleSlug: input.roleSlug,
      scopes: input.scopes ?? null,
      expiresAt: input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 86_400_000)
        : null,
    });
    await ctx.db.emit({
      type: null,
      resourceType: "api_key",
      resourceId: issued.id,
      action: "created",
      // The key itself is never recorded — only which one, and what it can do.
      audit: { name: issued.name, start: issued.start, roleSlug: issued.roleSlug },
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
    await ctx.db.emit({
      type: null,
      resourceType: "api_key",
      resourceId: input.id,
      action: "revoked",
    });
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
    await assertCanGrant(ctx, input.roleSlug);
    const issued = await issueOAuthClient(ctx.db, {
      name: input.name,
      roleSlug: input.roleSlug,
      scopes: input.scopes,
    });
    await ctx.db.emit({
      type: null,
      resourceType: "oauth_client",
      resourceId: issued.id,
      action: "created",
      audit: { name: issued.name, clientId: issued.clientId, roleSlug: issued.roleSlug },
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

/* --------------------------------------------------------- data lifecycle */

registerRpc(
  consoleRoutes,
  {
    namespace: "console",
    operation: "requestDataExport",
    summary: "Export everything this organization holds",
    description:
      "Runs in the background and produces one NDJSON file per table plus a manifest. " +
      "The download link expires: the file is a complete copy of the organization's " +
      "operational history.",
    input: requestDataExportInput,
    output: dataExportSchema,
    permission: "console.data.export",
    module: "core",
    internal: true,
  },
  async (_input, ctx) => {
    const row = await ctx.db.transaction(async (tx) => {
      const [created] = await tx.insert(dataExports, {
        status: "queued",
        requestedBy: ctx.actor.userId,
      });
      if (!created) throw new Error("Insert returned no row");
      await tx.emit({
        type: null,
        resourceType: "data_export",
        resourceId: created.id,
        action: "requested",
      });
      return created;
    });

    // Enqueued after the row commits, so the consumer cannot look for an
    // export that is not there yet. The maintenance cron re-drives anything
    // still queued, which is what makes a lost enqueue a delay rather than a
    // request that never happens.
    await ctx.env.MAINTENANCE_QUEUE?.send({
      job: "export",
      orgId: ctx.orgId,
      exportId: row.id,
    });

    return toExportDto(row);
  },
);

registerRpc(
  consoleRoutes,
  {
    namespace: "console",
    operation: "getDataExport",
    summary: "Check an export, and get its download link",
    input: getDataExportInput,
    output: getDataExportOutput,
    permission: "console.data.export",
    module: "core",
    internal: true,
  },
  async (input, ctx) => {
    const row = await ctx.db.findOne(dataExports, eq(dataExports.id, input.id));
    if (!row) throw new NotFound("Export not found");

    const dto = toExportDto(row);
    if (row.status !== "ready" || !row.objectKey || !dto.manifest) {
      return { ...dto, files: [] };
    }

    // One signature for the whole export rather than one per file: every file
    // belongs to the same organization and the same request, so a token that
    // opened one and not another would be a distinction without a difference.
    // It expires with the export.
    const expiresAt = Math.floor((row.expiresAt?.getTime() ?? Date.now()) / 1000);
    const { token } = await signDownload(downloadSigningKey(ctx.env), {
      reportId: row.id,
      orgId: ctx.orgId,
      expiresAt,
    });
    const base = ctx.env.BETTER_AUTH_URL.replace(/\/$/, "");
    const query = `org=${ctx.orgId}&expires=${expiresAt}&token=${token}`;

    return {
      ...dto,
      files: [
        // The manifest first: it is what tells a recipient the export is
        // complete, and it names everything below.
        {
          table: "manifest",
          rows: dto.manifest.tables.length,
          url: `${base}/exports/v1/${row.id}/manifest.json?${query}`,
        },
        ...dto.manifest.tables.map((t) => ({
          table: t.table,
          rows: t.rows,
          url: `${base}/exports/v1/${row.id}/${t.file}?${query}`,
        })),
      ],
    };
  },
);

registerRpc(
  consoleRoutes,
  {
    namespace: "console",
    operation: "deleteOrganization",
    summary: "Delete this organization and everything in it",
    description:
      "Marks the organization for deletion. Requests stop working immediately; the data " +
      "is removed after a grace period, during which support can reverse it.",
    input: deleteOrganizationInput,
    output: deleteOrganizationOutput,
    permission: "console.data.delete",
    module: "core",
    internal: true,
  },
  async (input, ctx) => {
    // unscoped-ok: `organizations` IS the tenant, so it is classified global
    // and OrgDb refuses it by design. The predicate is this request's own
    // resolved org id, which the middleware has already verified membership of.
    const [org] = await ctx.db.query(async (t) =>
      t
        .select({ slug: organizations.slug, deletedAt: organizations.deletedAt })
        .from(organizations)
        .where(eq(organizations.id, ctx.orgId))
        .limit(1),
    );
    if (!org) throw new NotFound("Organization not found");
    if (input.confirmSlug !== org.slug) {
      throw new BadRequest(`To delete this organization, type its slug exactly: "${org.slug}".`);
    }
    if (org.deletedAt) {
      throw new Conflict("This organization is already scheduled for deletion");
    }

    const deletedAt = new Date();
    const purgeAfter = new Date(deletedAt.getTime() + GRACE_PERIOD_DAYS * 86_400_000);

    await ctx.db.transaction(async (tx) => {
      // unscoped-ok: as above — the tenant table itself, keyed by this
      // request's verified org id.
      await tx.query(async (t) =>
        t
          .update(organizations)
          .set({ deletedAt, purgeAfter, updatedAt: new Date() })
          .where(eq(organizations.id, ctx.orgId)),
      );
      // Every credential stops now rather than at the purge: the grace period
      // is time to change your mind, not a week of continued API access on an
      // account somebody asked to be deleted.
      await tx.update(apiKeys, { enabled: false }, sql`true`);
      // unscoped-ok: TENANT_GLOBAL, scoped by referenceId — the same predicate
      // `revokeOAuthClient` uses, and for the same reason.
      await tx.query(async (t) =>
        t
          .update(oauthClients)
          .set({ disabled: true, updatedAt: new Date() })
          .where(eq(oauthClients.referenceId, ctx.orgId)),
      );
      await tx.emit({
        type: null,
        resourceType: "organization",
        resourceId: ctx.orgId,
        action: "deletion_scheduled",
        audit: { purgeAfter: purgeAfter.toISOString(), slug: org.slug },
      });
    });

    return {
      orgId: ctx.orgId,
      deletedAt: deletedAt.toISOString(),
      purgeAfter: purgeAfter.toISOString(),
    };
  },
);

/** Long enough to notice a mistake, short enough to honour the request. */
const GRACE_PERIOD_DAYS = 7;

function toExportDto(row: typeof dataExports.$inferSelect) {
  return {
    id: row.id,
    status: row.status as "queued" | "ready" | "failed",
    // jsonb, so the driver types it `unknown`. `runExport` is the only writer
    // and builds it from `ExportManifest`; the response schema validates it on
    // the way out.
    manifest: (row.manifest as ExportManifest | null) ?? null,
    error: row.error ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
