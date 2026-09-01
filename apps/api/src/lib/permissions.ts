import { rolePermissions } from "@roastery/db/schema";
import { eq } from "drizzle-orm";
import type { Env } from "../env";
import type { WorkerDb } from "./db";

/**
 * Does this permission set grant `permission`?
 *
 * Supports wildcards stored in `role_permissions`: `*` and any dotted prefix
 * such as `inventory.green.*`. That is why `owner` is one row rather than a
 * list that must be edited every time a capability is added.
 *
 * Pure and synchronous by design — the set is materialized once per request in
 * `orgScope`, so every call here is a Set lookup with no I/O.
 */
export function can(perms: ReadonlySet<string>, permission: string): boolean {
  if (perms.has("*") || perms.has(permission)) return true;
  const parts = permission.split(".");
  for (let i = parts.length - 1; i > 0; i--) {
    if (perms.has(`${parts.slice(0, i).join(".")}.*`)) return true;
  }
  return false;
}

/**
 * Built-in roles are shared across tenants and immutable, so they are safe to
 * cache for the life of an isolate. Custom roles are not, and are keyed by a
 * per-org epoch instead (below).
 */
const builtinCache = new Map<string, { perms: Set<string>; at: number }>();
const BUILTIN_TTL_MS = 60_000;
const BUILTIN_ROLES = new Set(["owner", "manager", "roaster", "qc", "viewer"]);

export function permissionEpochKey(orgId: string): string {
  return `perm-epoch:${orgId}`;
}

/** Call after any change to a custom role's grants. */
export async function bumpPermissionEpoch(env: Env, orgId: string): Promise<void> {
  await env.ROASTERY_KV.put(permissionEpochKey(orgId), String(Date.now()));
}

async function loadRolePermissions(
  env: Env,
  db: WorkerDb,
  orgId: string,
  roleSlug: string,
): Promise<Set<string>> {
  const isBuiltin = BUILTIN_ROLES.has(roleSlug);

  if (isBuiltin) {
    const hit = builtinCache.get(roleSlug);
    if (hit && Date.now() - hit.at < BUILTIN_TTL_MS) return hit.perms;
  }

  const epoch = isBuiltin
    ? "builtin"
    : ((await env.ROASTERY_KV.get(permissionEpochKey(orgId))) ?? "0");
  const kvKey = `perms:${roleSlug}:${epoch}`;

  const cached = await env.ROASTERY_KV.get<string[]>(kvKey, "json");
  if (cached) {
    const set = new Set(cached);
    if (isBuiltin) builtinCache.set(roleSlug, { perms: set, at: Date.now() });
    return set;
  }

  const rows = await db
    .select({ p: rolePermissions.permissionSlug })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleSlug, roleSlug));
  const set = new Set(rows.map((r) => r.p));

  await env.ROASTERY_KV.put(kvKey, JSON.stringify([...set]), { expirationTtl: 3600 });
  if (isBuiltin) builtinCache.set(roleSlug, { perms: set, at: Date.now() });
  return set;
}

/**
 * The effective permission set for a caller.
 *
 * `credentialScopes` distinguishes three cases, and the distinction is the
 * whole point — collapsing null and empty makes an unscoped key either
 * silently omnipotent or silently useless:
 *
 *   null  → a human session, or a machine credential with no down-scoping.
 *           The role's grants apply as-is.
 *   []    → an explicitly inert credential. Grants nothing.
 *   [...] → the INTERSECTION of the requested scopes and the role's grants, so
 *           a credential can never exceed either what it was issued or what
 *           its role allows.
 *
 * The intersection is deliberately the inverse of the reference
 * implementation, where the route's declared scope determined the key's
 * effective role — meaning a key was rated by whatever scope a route happened
 * to name rather than by what it was actually issued.
 */
export async function loadPermissions(
  env: Env,
  db: WorkerDb,
  orgId: string,
  roleSlug: string,
  credentialScopes: string[] | null,
): Promise<ReadonlySet<string>> {
  const rolePerms = await loadRolePermissions(env, db, orgId, roleSlug);
  if (credentialScopes === null) return rolePerms;
  return new Set(credentialScopes.filter((s) => can(rolePerms, s)));
}

/** Clears the isolate-level built-in cache. Tests only. */
export function __resetPermissionCache(): void {
  builtinCache.clear();
}
