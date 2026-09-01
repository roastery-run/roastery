/**
 * Tenant classification.
 *
 * Every exported pgTable must appear in EXACTLY ONE of the three maps below.
 * `authorization.test.ts` enumerates the schema module and fails the build on
 * any table that is missing or double-classified.
 *
 * That test is the whole point. Enforcing tenancy by remembering to write a
 * predicate in each of ~200 handlers does not survive contact with a 79-table
 * schema; enforcing it by classifying each table once, and failing the build
 * when a new one is not classified, does.
 */
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import * as s from "./schema/index";

/** A table carrying its own `org_id`. */
export type DirectTenantTable = PgTable & { orgId: PgColumn };

/** A table that reaches the tenant through exactly one parent FK. */
export type TransitiveTenancy = {
  child: PgTable;
  childFk: PgColumn;
  parent: DirectTenantTable;
  parentKey: PgColumn;
};

/**
 * Tables with their own `org_id`. Scoping is a direct equality predicate.
 */
export const TENANT_DIRECT = {
  org_members: s.orgMembers,
  org_invitations: s.orgInvitations,
  api_keys: s.apiKeys,
  org_oauth_clients: s.orgOauthClients,
  org_subscriptions: s.orgSubscriptions,
  org_entitlement_overrides: s.orgEntitlementOverrides,
  locations: s.locations,
  units_of_measure: s.unitsOfMeasure,
  audit_events: s.auditEvents,
  events: s.events,
} satisfies Record<string, DirectTenantTable>;

/**
 * Tables that reach the tenant through a parent.
 *
 * Used where denormalizing `org_id` onto the child would cost more than the
 * semi-join saves — the canonical case being roast measurements, which run to
 * hundreds of rows per batch.
 */
export const TENANT_VIA = {
  // (populated as the domain schema lands in later phases)
} satisfies Record<string, TransitiveTenancy>;

/**
 * Genuinely global tables.
 *
 * Every entry needs a justification, because "it looked global" is how a
 * tenant-scoped table ends up readable by every customer:
 *
 * - Better Auth tables are keyed by user, not org; a user may belong to many
 *   orgs, and their credentials belong to none of them.
 * - `organizations` itself is the tenant, so it cannot be scoped by one.
 * - `permissions` / `roles` / `role_permissions` are the authorization
 *   vocabulary. Built-in roles are shared and immutable; custom roles carry an
 *   `orgId` COLUMN but are read through the permission loader, never through
 *   OrgDb, so they are classified here deliberately.
 * - `plans` / `plan_entitlements` are the product catalogue, identical for
 *   everyone, and are read to answer "what would upgrading give me".
 */
export const TENANT_GLOBAL = {
  users: s.users,
  sessions: s.sessions,
  accounts: s.accounts,
  verifications: s.verifications,
  passkeys: s.passkeys,
  jwks: s.jwks,
  organizations: s.organizations,
  permissions: s.permissions,
  roles: s.roles,
  role_permissions: s.rolePermissions,
  plans: s.plans,
  plan_entitlements: s.planEntitlements,
} satisfies Record<string, PgTable>;

export type ScopedTable =
  | (typeof TENANT_DIRECT)[keyof typeof TENANT_DIRECT]
  | (typeof TENANT_VIA)[keyof typeof TENANT_VIA]["child"];

const DIRECT_SET: ReadonlySet<unknown> = new Set(Object.values(TENANT_DIRECT));
const VIA_LIST: readonly TransitiveTenancy[] = Object.values(TENANT_VIA);

export function isDirectTenantTable(table: unknown): table is DirectTenantTable {
  return DIRECT_SET.has(table);
}

export function transitiveTenancyFor(table: unknown): TransitiveTenancy | undefined {
  return VIA_LIST.find((v) => v.child === table);
}
