/**
 * Tenant classification.
 *
 * Every exported pgTable must appear in EXACTLY ONE of the three maps below.
 * `authorization.test.ts` enumerates the schema and fails the build on any
 * table that is missing or double-classified.
 *
 * That test is the whole point. Enforcing tenancy by remembering to write a
 * predicate in each of ~200 handlers does not survive contact with a 79-table
 * schema; enforcing it by classifying each table once, and failing the build
 * when a new one is not classified, does.
 */
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import * as s from "./schema/index";

/**
 * A table scoped by a column on itself.
 *
 * The column is named explicitly rather than assumed to be `orgId`, because
 * tables whose shape is dictated by a third party do not get to follow our
 * naming — `api_keys` comes from @better-auth/api-key and calls it
 * `referenceId`. Assuming the name would have meant either aliasing a Drizzle
 * column or leaving that table unscoped.
 */
export type DirectTenancy = {
  table: PgTable;
  /** The Drizzle column, for building the WHERE predicate. */
  column: PgColumn;
  /**
   * The JS property name of that column.
   *
   * Needed separately because a column's `.name` is the snake_case DB name,
   * while an insert's values object is keyed by the property name.
   */
  field: string;
};

/** A table that reaches the tenant through exactly one parent FK. */
export type TransitiveTenancy = {
  child: PgTable;
  childFk: PgColumn;
  parent: PgTable;
  parentKey: PgColumn;
  parentTenantColumn: PgColumn;
};

export const TENANT_DIRECT = {
  org_members: { table: s.orgMembers, column: s.orgMembers.orgId, field: "orgId" },
  org_invitations: { table: s.orgInvitations, column: s.orgInvitations.orgId, field: "orgId" },
  // Shape dictated by @better-auth/api-key: the owner column is referenceId.
  api_keys: { table: s.apiKeys, column: s.apiKeys.referenceId, field: "referenceId" },
  org_subscriptions: {
    table: s.orgSubscriptions,
    column: s.orgSubscriptions.orgId,
    field: "orgId",
  },
  org_entitlement_overrides: {
    table: s.orgEntitlementOverrides,
    column: s.orgEntitlementOverrides.orgId,
    field: "orgId",
  },
  locations: { table: s.locations, column: s.locations.orgId, field: "orgId" },
  partners: { table: s.partners, column: s.partners.orgId, field: "orgId" },
  producers: { table: s.producers, column: s.producers.orgId, field: "orgId" },
  products: { table: s.products, column: s.products.orgId, field: "orgId" },
  machines: { table: s.machines, column: s.machines.orgId, field: "orgId" },
  green_lots: { table: s.greenLots, column: s.greenLots.orgId, field: "orgId" },
  inventory_transactions: {
    table: s.inventoryTransactions,
    column: s.inventoryTransactions.orgId,
    field: "orgId",
  },
  lot_location_balances: {
    table: s.lotLocationBalances,
    column: s.lotLocationBalances.orgId,
    field: "orgId",
  },
  lot_consumption: { table: s.lotConsumption, column: s.lotConsumption.orgId, field: "orgId" },
  inventory_reconciliations: {
    table: s.inventoryReconciliations,
    column: s.inventoryReconciliations.orgId,
    field: "orgId",
  },
  cost_components: { table: s.costComponents, column: s.costComponents.orgId, field: "orgId" },
  landed_costs: { table: s.landedCosts, column: s.landedCosts.orgId, field: "orgId" },
  materials: { table: s.materials, column: s.materials.orgId, field: "orgId" },
  material_transactions: {
    table: s.materialTransactions,
    column: s.materialTransactions.orgId,
    field: "orgId",
  },
  bills_of_materials: {
    table: s.billsOfMaterials,
    column: s.billsOfMaterials.orgId,
    field: "orgId",
  },
  bom_lines: { table: s.bomLines, column: s.bomLines.orgId, field: "orgId" },
  contracts: { table: s.contracts, column: s.contracts.orgId, field: "orgId" },
  contract_lines: { table: s.contractLines, column: s.contractLines.orgId, field: "orgId" },
  contract_milestones: {
    table: s.contractMilestones,
    column: s.contractMilestones.orgId,
    field: "orgId",
  },
  shipments: { table: s.shipments, column: s.shipments.orgId, field: "orgId" },
  samples: { table: s.samples, column: s.samples.orgId, field: "orgId" },
  roast_profiles: { table: s.roastProfiles, column: s.roastProfiles.orgId, field: "orgId" },
  roast_batches: { table: s.roastBatches, column: s.roastBatches.orgId, field: "orgId" },
  roast_goals: { table: s.roastGoals, column: s.roastGoals.orgId, field: "orgId" },
  roast_batch_goal_results: {
    table: s.roastBatchGoalResults,
    column: s.roastBatchGoalResults.orgId,
    field: "orgId",
  },
  machine_bridge_tokens: {
    table: s.machineBridgeTokens,
    column: s.machineBridgeTokens.orgId,
    field: "orgId",
  },
  alert_notifications: {
    table: s.alertNotifications,
    column: s.alertNotifications.orgId,
    field: "orgId",
  },
  units_of_measure: { table: s.unitsOfMeasure, column: s.unitsOfMeasure.orgId, field: "orgId" },
  audit_events: { table: s.auditEvents, column: s.auditEvents.orgId, field: "orgId" },
  events: { table: s.events, column: s.events.orgId, field: "orgId" },
} satisfies Record<string, DirectTenancy>;

/**
 * Tables that reach the tenant through a parent.
 *
 * Used where denormalizing the tenant onto the child would cost more than the
 * semi-join saves — the canonical case being roast measurements, which run to
 * hundreds of rows per batch.
 */
export const TENANT_VIA = {
  /**
   * Roast measurements and events.
   *
   * These carry no org_id deliberately: a roast produces hundreds of sample
   * rows, and denormalizing the tenant onto each costs more storage and write
   * bandwidth than the semi-join through roast_batches saves on read. This is
   * the case the transitive classification exists for.
   */
  roast_samples: {
    child: s.roastSamples,
    childFk: s.roastSamples.batchId,
    parent: s.roastBatches,
    parentKey: s.roastBatches.id,
    parentTenantColumn: s.roastBatches.orgId,
  },
  roast_events: {
    child: s.roastEvents,
    childFk: s.roastEvents.batchId,
    parent: s.roastBatches,
    parentKey: s.roastBatches.id,
    parentTenantColumn: s.roastBatches.orgId,
  },
} satisfies Record<string, TransitiveTenancy>;

/**
 * Genuinely global tables.
 *
 * Every entry needs a justification, because "it looked global" is how a
 * tenant-scoped table ends up readable by every customer:
 *
 * - Better Auth tables are keyed by user, not org; a user may belong to many
 *   organizations, and their credentials belong to none of them.
 * - `organizations` itself is the tenant, so it cannot be scoped by one.
 * - `permissions` / `roles` / `role_permissions` are the authorization
 *   vocabulary. Built-in roles are shared and immutable; custom roles carry an
 *   orgId COLUMN but are read through the permission loader, never OrgDb.
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

  /**
   * OAuth provider tables.
   *
   * Global because the plugin owns them and looks a client up by clientId
   * BEFORE any tenant is known — a token request arrives with credentials and
   * nothing else. Tenancy is carried on the row instead: `referenceId` holds
   * the organization, and it is that value, not the caller's header, that
   * `orgScope` binds the request to. So a token can only ever act on the
   * organization its client was issued for.
   *
   * Nothing reads these through OrgDb; they are reached only by the plugin.
   */
  oauth_clients: s.oauthClients,
  oauth_resources: s.oauthResources,
  oauth_client_resources: s.oauthClientResources,
  oauth_access_tokens: s.oauthAccessTokens,
  oauth_refresh_tokens: s.oauthRefreshTokens,
  oauth_consents: s.oauthConsents,
  oauth_client_assertions: s.oauthClientAssertions,
} satisfies Record<string, PgTable>;

export type ScopedTable =
  | (typeof TENANT_DIRECT)[keyof typeof TENANT_DIRECT]["table"]
  | (typeof TENANT_VIA)[keyof typeof TENANT_VIA]["child"];

const DIRECT_BY_TABLE = new Map<unknown, DirectTenancy>(
  Object.values(TENANT_DIRECT).map((d) => [d.table, d]),
);
const VIA_LIST: readonly TransitiveTenancy[] = Object.values(TENANT_VIA);

export function directTenancyFor(table: unknown): DirectTenancy | undefined {
  return DIRECT_BY_TABLE.get(table);
}

export function transitiveTenancyFor(table: unknown): TransitiveTenancy | undefined {
  return VIA_LIST.find((v) => v.child === table);
}
