/**
 * Tenancy, authorization, and entitlements.
 *
 * Authorization lives in the application layer (middleware + OrgDb scoping +
 * these tables), not in Postgres RLS. Roles and permissions are DATA, not
 * constants in a TypeScript file, so the permission matrix is inspectable,
 * testable, and editable per organization without a deploy.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { actorTypeEnum, locationKindEnum, subscriptionStatusEnum, uomKindEnum } from "./enums";

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** ISO-4217. Every money row also stores its amount converted into this. */
    baseCurrency: text("base_currency").notNull().default("USD"),
    /** Display preference only; all weights are stored canonically in kg. */
    defaultWeightUnit: text("default_weight_unit").notNull().default("kg"),
    timezone: text("timezone").notNull().default("UTC"),
    settings: jsonb("settings").$type<{
      fiscalYearStartMonth?: number;
      defaultRoastLossPct?: number;
      costAllocationPolicy?: "weight" | "value";
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("organizations_slug_idx").on(t.slug)],
);

/* -------------------------------------------------------- roles + permissions */

/**
 * One row per capability, e.g. `inventory.green.write`.
 *
 * `module` ties a permission to the entitlement module that must be on the
 * org's plan for it to be usable at all. The authorization test asserts that a
 * route's declared module matches its permission's module, so the two can
 * never drift apart.
 */
export const permissions = pgTable(
  "permissions",
  {
    slug: text("slug").primaryKey(),
    resource: text("resource").notNull(),
    action: text("action").notNull(),
    module: text("module").notNull(),
    description: text("description").notNull(),
  },
  (t) => [index("permissions_module_idx").on(t.module)],
);

/**
 * `orgId IS NULL` marks a built-in role: shared by every tenant and immutable,
 * which is what lets it be cached in an isolate-level Map. A non-null orgId is
 * a custom role owned by one organization.
 *
 * `rank` orders roles for display. It is deliberately NOT an authorization
 * input — comparing ranks is how a role hierarchy silently grants a capability
 * nobody granted explicitly.
 */
export const roles = pgTable(
  "roles",
  {
    slug: text("slug").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull().default(0),
  },
  (t) => [index("roles_org_idx").on(t.orgId)],
);

/**
 * Wildcards are permitted in `permissionSlug`: `inventory.green.*` or a bare
 * `*`. That is why `owner` is a single row rather than a list that must be
 * updated every time a capability is added.
 */
export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleSlug: text("role_slug")
      .notNull()
      .references(() => roles.slug, { onDelete: "cascade" }),
    permissionSlug: text("permission_slug").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roleSlug, t.permissionSlug] }),
    index("role_permissions_role_idx").on(t.roleSlug),
  ],
);

export const orgMembers = pgTable(
  "org_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleSlug: text("role_slug")
      .notNull()
      .default("viewer")
      .references(() => roles.slug),
    defaultLocationId: uuid("default_location_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("org_members_org_user_idx").on(t.orgId, t.userId),
    index("org_members_user_idx").on(t.userId),
  ],
);

/**
 * Invitations to people who do not have an account yet.
 *
 * The emailed token is stored only as a sha256: the raw value exists in the
 * invitee's inbox and nowhere else, so a database leak cannot be replayed into
 * org access. Rows are never deleted, only stamped, so who was let into an org
 * and when stays answerable.
 */
export const orgInvitations = pgTable(
  "org_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    roleSlug: text("role_slug")
      .notNull()
      .default("viewer")
      .references(() => roles.slug),
    tokenHash: text("token_hash").notNull(),
    invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("org_invitations_token_hash_idx").on(t.tokenHash),
    index("org_invitations_org_idx").on(t.orgId),
    index("org_invitations_email_idx").on(t.email),
  ],
);

/** `sk_` keys for CLI and console-adjacent automation. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    roleSlug: text("role_slug")
      .notNull()
      .references(() => roles.slug),
    /**
     * Optional down-scoping, as permission slugs.
     *
     * NULL  → no down-scoping; the key has its role's full grants.
     * []    → explicitly inert; the key can do nothing. Useful to disable a
     *         key without revoking it, and it is what a caller gets if they
     *         ask for scopes their role does not have.
     * [...] → the INTERSECTION of these and the role's grants, so a key can
     *         never exceed either what it was issued or what its role allows.
     *
     * The null/empty distinction is deliberate: collapsing them would make an
     * unscoped key either silently omnipotent or silently useless, and both
     * are bugs someone finds in production.
     */
    scopes: jsonb("scopes").$type<string[]>(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // THE hot-path index: auth resolves a key by hash on every request carrying
    // `Bearer sk_`, through the cache-disabled Hyperdrive, so it never benefits
    // from query caching. Unique because two keys must never share a hash.
    uniqueIndex("api_keys_key_hash_idx").on(t.keyHash),
    index("api_keys_org_idx").on(t.orgId),
    index("api_keys_created_by_idx").on(t.createdBy),
  ],
);

/**
 * Binds a Better Auth OAuth client to one organization and one role.
 *
 * `@better-auth/oauth-provider` owns the client record itself (secret hashing,
 * client_credentials_scopes, rotation). It has no concept of a tenant, and a
 * machine credential must be permanently bound to exactly one — so that
 * binding lives here rather than being inferred at request time.
 */
export const orgOauthClients = pgTable(
  "org_oauth_clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    name: text("name").notNull(),
    roleSlug: text("role_slug")
      .notNull()
      .references(() => roles.slug),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("org_oauth_clients_client_id_idx").on(t.clientId),
    index("org_oauth_clients_org_idx").on(t.orgId),
  ],
);

/* ------------------------------------------------------------- entitlements */

export const plans = pgTable("plans", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  rank: integer("rank").notNull().default(0),
  isPublic: boolean("is_public").notNull().default(true),
  priceMonthly: numeric("price_monthly", { precision: 12, scale: 2 }),
  currency: text("currency").notNull().default("EUR"),
});

/** Keys are `module:<name>` or `limit:<name>`. Values are `true` or a number. */
export const planEntitlements = pgTable(
  "plan_entitlements",
  {
    planSlug: text("plan_slug")
      .notNull()
      .references(() => plans.slug, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.planSlug, t.key] })],
);

export const orgSubscriptions = pgTable("org_subscriptions", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  planSlug: text("plan_slug")
    .notNull()
    .references(() => plans.slug),
  status: subscriptionStatusEnum("status").notNull().default("trialing"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  /**
   * The seam a billing provider's webhook would populate. Nothing in
   * enforcement reads anything but this table, so adding payments later is a
   * change to one row, not a change to the authorization path.
   */
  externalRef: text("external_ref"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-org overrides on top of plan defaults. Add-ons and negotiated limits are
 * both just overrides.
 *
 * `reason` is NOT NULL on purpose: an override without a recorded why is a
 * mystery six months later, when nobody remembers whether it was a sales
 * concession or a support workaround that should have expired.
 */
export const orgEntitlementOverrides = pgTable(
  "org_entitlement_overrides",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    reason: text("reason").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    setBy: text("set_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.key] })],
);

/* ------------------------------------------------------------------ catalog */

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    kind: locationKindEnum("kind").notNull(),
    address: jsonb("address").$type<{
      line1?: string;
      line2?: string;
      city?: string;
      region?: string;
      postalCode?: string;
      country?: string;
    }>(),
    timezone: text("timezone"),
    isActive: boolean("is_active").notNull().default(true),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Business codes are unique per tenant, never globally: two roasteries both
    // naming a warehouse "WH1" is normal and must not collide.
    uniqueIndex("locations_org_code_idx").on(t.orgId, t.code),
    index("locations_org_kind_idx").on(t.orgId, t.kind, t.isActive),
    // Keyset pagination order for every list endpoint.
    index("locations_org_created_idx").on(t.orgId, t.createdAt, t.id),
  ],
);

export const unitsOfMeasure = pgTable(
  "units_of_measure",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    label: text("label").notNull(),
    kind: uomKindEnum("kind").notNull(),
    /**
     * Only meaningful for `kind = 'mass'`. Bag units carry no global factor:
     * a 69 kg Colombian bag and a 60 kg Brazilian bag are both "bags", so the
     * conversion lives per-lot, not here.
     */
    factorToKg: numeric("factor_to_kg", { precision: 18, scale: 8 }),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("units_of_measure_org_code_idx").on(t.orgId, t.code)],
);

/* -------------------------------------------------------------------- audit */

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    actorId: text("actor_id"),
    actorType: actorTypeEnum("actor_type").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_events_org_created_idx").on(t.orgId, t.createdAt),
    index("audit_events_org_resource_idx").on(t.orgId, t.resourceType, t.resourceId),
  ],
);

/**
 * Transactional outbox.
 *
 * Written in the SAME transaction as the domain change it describes, so "the
 * lot moved but no webhook fired" is not a reachable state. A cron sweeper
 * picks up rows where `fannedOutAt IS NULL`, which covers the Worker dying
 * between the commit and the queue send.
 */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    payload: jsonb("payload").notNull(),
    actorId: text("actor_id"),
    actorType: actorTypeEnum("actor_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    fannedOutAt: timestamp("fanned_out_at", { withTimezone: true }),
  },
  (t) => [
    index("events_org_occurred_idx").on(t.orgId, t.occurredAt),
    index("events_fanout_pending_idx").on(t.occurredAt).where(sql`fanned_out_at IS NULL`),
  ],
);
