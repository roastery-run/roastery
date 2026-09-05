/**
 * The authorization vocabulary, as data.
 *
 * This is the source the seed migration is generated from and the list the
 * authorization test validates route definitions against — so a route
 * declaring a permission that is not here fails the build rather than denying
 * silently forever (or, worse, being swallowed by a `*` wildcard).
 */

export type PermissionSeed = {
  slug: string;
  module: string;
  description: string;
};

function perm(resource: string, module: string, actions: [string, string][]): PermissionSeed[] {
  return actions.map(([action, description]) => ({
    slug: `${resource}.${action}`,
    module,
    description,
  }));
}

/**
 * The complete permission vocabulary.
 *
 * Declared up front, ahead of the routes that use it. A permission is a
 * capability NAME, not an implementation — having the full vocabulary from the
 * start is what lets role definitions be coherent before every module ships,
 * and it costs nothing but rows.
 *
 * The security-relevant direction is still enforced: a ROUTE declaring a
 * permission that is not in this list fails the build (check 3).
 */
export const PERMISSIONS: PermissionSeed[] = [
  // --- catalog (core)
  ...perm("catalog.location", "core", [
    ["read", "View locations"],
    ["write", "Create and edit locations"],
  ]),
  ...perm("catalog.product", "core", [
    ["read", "View products"],
    ["write", "Create and edit products"],
  ]),
  ...perm("catalog.party", "core", [
    ["read", "View suppliers, producers and customers"],
    ["write", "Create and edit suppliers, producers and customers"],
  ]),
  ...perm("catalog.machine", "core", [
    ["read", "View machines"],
    ["write", "Register and edit machines"],
  ]),

  // --- inventory
  ...perm("inventory.green", "inventory", [
    ["read", "View green coffee lots"],
    ["write", "Import, adjust, split, merge and transfer green lots"],
  ]),
  ...perm("inventory.roast", "inventory", [
    ["read", "View roasted lots"],
    ["write", "Create, adjust and transfer roasted lots"],
  ]),
  ...perm("inventory.blend", "inventory", [
    ["read", "View blends"],
    ["write", "Create and edit blend recipes"],
  ]),
  ...perm("inventory.material", "resource_planning", [
    ["read", "View packaging and other materials"],
    ["write", "Receive, adjust and consume materials"],
  ]),

  // --- sourcing
  ...perm("sourcing.contract", "green_contracts", [
    ["read", "View green purchase contracts"],
    ["write", "Create and edit contracts, shipments and cost components"],
    ["approve", "Approve and close contracts"],
  ]),
  ...perm("sourcing.sample", "samples", [
    ["read", "View samples"],
    ["write", "Create, ship and receive samples"],
    ["approve", "Approve or reject samples"],
  ]),

  // --- production
  ...perm("production.profile", "roasting", [
    ["read", "View roast profiles"],
    ["write", "Create and edit roast profiles"],
  ]),
  ...perm("production.roast", "roasting", [
    ["read", "View roast batches and curves"],
    ["write", "Start, annotate and complete roast batches"],
    ["ingest", "Stream telemetry from a roasting machine"],
    ["approve", "Approve or reject a completed batch"],
  ]),
  ...perm("production.schedule", "roasting", [
    ["read", "View production schedules"],
    ["write", "Create and edit schedules"],
    ["approve", "Release a schedule to production"],
  ]),

  // --- quality
  ...perm("quality.cupping", "quality", [
    ["read", "View cupping sessions and scores"],
    ["write", "Run sessions and submit scores"],
  ]),
  ...perm("quality.grading", "quality", [
    ["read", "View green gradings"],
    ["write", "Record gradings, quarantine and release lots"],
  ]),

  // --- demand
  ...perm("orders", "orders", [
    ["read", "View orders"],
    ["write", "Create and edit orders, allocate and fulfil"],
  ]),

  // --- cafe
  ...perm("cafe", "cafe", [
    ["read", "View cafés, machines and shots"],
    ["write", "Manage cafés, machines and recipes"],
    ["ingest", "Stream shots and POS data from a café"],
  ]),

  // --- cross-cutting
  ...perm("quality.form", "quality", [
    ["read", "View cupping and grading form templates"],
    ["write", "Design and publish form templates"],
  ]),
  ...perm("reporting", "core", [
    ["read", "View and request reports"],
    ["write", "Create and schedule report templates"],
  ]),
  ...perm("traceability", "core", [["read", "Trace coffee forward and backward"]]),
  // Alerts span contracts, green coffee and materials, so no single domain
  // permission is the right gate for reading the list.
  ...perm("alerts", "core", [["read", "See what needs attention"]]),
  ...perm("webhooks", "api", [
    ["read", "View webhook endpoints and deliveries"],
    ["write", "Create, edit and replay webhooks"],
  ]),

  // --- console
  ...perm("console.members", "core", [
    ["read", "View organization members"],
    ["write", "Invite and remove members, change roles"],
  ]),
  ...perm("console.settings", "core", [
    ["read", "View organization settings"],
    ["write", "Change organization settings"],
  ]),
  ...perm("console.billing", "core", [
    ["read", "View plan and entitlements"],
    ["write", "Change plan"],
  ]),
  ...perm("console.audit", "core", [["read", "View the audit log"]]),
  /**
   * Owner-only, and separate from `console.settings.write`, because these two
   * are the operations that take the organization's data out of the system or
   * remove it entirely. Bundling them with ordinary settings would grant them
   * to anyone who can rename the company.
   */
  ...perm("console.data", "core", [
    ["export", "Export everything the organization holds"],
    ["delete", "Delete the organization and all of its data"],
  ]),
  /**
   * What the signed-in user may do HERE. Granted to every built-in role,
   * including viewer: a console that cannot ask which modules are locked
   * cannot render its own navigation, and gating that behind a billing
   * permission would leave a read-only user staring at a shell that never
   * resolves.
   */
  ...perm("console.self", "core", [["read", "Read your own role, permissions and plan"]]),
  ...perm("console.credentials", "api", [
    ["read", "View API keys and machine credentials"],
    ["write", "Create and revoke API keys and machine credentials"],
  ]),
];

export type RoleSeed = {
  slug: string;
  name: string;
  description: string;
  rank: number;
  grants: string[];
};

/**
 * Built-in roles.
 *
 * `rank` orders them for display only. It is deliberately never compared
 * during an authorization check: a role hierarchy expressed as a number is how
 * a capability nobody granted gets silently inherited.
 *
 * Wildcards keep these lists short and, more importantly, keep them honest —
 * `owner` is `*` rather than an enumeration that drifts out of date every time
 * a permission is added.
 */
export const ROLES: RoleSeed[] = [
  {
    slug: "owner",
    name: "Owner",
    description: "Full access, including billing and member management.",
    rank: 50,
    grants: ["*"],
  },
  {
    slug: "manager",
    name: "Manager",
    description: "Runs day-to-day operations across every module.",
    rank: 40,
    grants: [
      "console.self.read",
      "catalog.*",
      "inventory.*",
      "sourcing.*",
      "production.*",
      "quality.*",
      "orders.*",
      "cafe.*",
      "reporting.*",
      "traceability.*",
      "webhooks.*",
      "console.members.read",
      "console.settings.read",
      "console.audit.read",
    ],
  },
  {
    slug: "roaster",
    name: "Roaster",
    description: "Runs production. Reads green stock, owns roasted output.",
    rank: 30,
    grants: [
      "console.self.read",
      "production.*",
      "inventory.roast.*",
      "inventory.blend.read",
      "inventory.green.read",
      "catalog.location.read",
      "catalog.product.read",
      "catalog.machine.read",
      "quality.grading.read",
      "quality.cupping.read",
      // A roaster acts on what needs attention; designing the sheets is a QC job.
      "alerts.read",
      "quality.form.read",
      "reporting.read",
    ],
  },
  {
    slug: "qc",
    name: "Quality",
    description: "Owns cupping and grading; reads everything it evaluates.",
    rank: 30,
    grants: [
      "console.self.read",
      "quality.*",
      "sourcing.sample.*",
      "inventory.green.read",
      "inventory.roast.read",
      "inventory.blend.read",
      "production.roast.read",
      "production.profile.read",
      "alerts.read",
      "catalog.location.read",
      "catalog.product.read",
      "catalog.party.read",
      "reporting.read",
    ],
  },
  {
    slug: "viewer",
    name: "Viewer",
    description: "Read-only across every module the plan includes.",
    rank: 10,
    grants: [
      "console.self.read",
      "catalog.location.read",
      "catalog.product.read",
      "catalog.party.read",
      "catalog.machine.read",
      "inventory.green.read",
      "inventory.roast.read",
      "inventory.blend.read",
      "inventory.material.read",
      "sourcing.contract.read",
      "sourcing.sample.read",
      "production.profile.read",
      "production.roast.read",
      "production.schedule.read",
      "quality.cupping.read",
      "quality.grading.read",
      "orders.read",
      "cafe.read",
      "reporting.read",
      "traceability.read",
      "alerts.read",
      "quality.form.read",
    ],
  },
];

export type PlanSeed = {
  slug: string;
  name: string;
  rank: number;
  priceMonthly: string | null;
  entitlements: Record<string, unknown>;
};

/** Modules a plan does not list are absent, which the API answers with a 402. */
export const PLANS: PlanSeed[] = [
  {
    slug: "starter",
    name: "Starter",
    rank: 10,
    priceMonthly: "0.00",
    entitlements: {
      "module:core": true,
      "module:roasting": true,
      "limit:locations": 1,
      "limit:users": 3,
      "limit:machines": 1,
    },
  },
  {
    slug: "core",
    name: "Core",
    rank: 20,
    priceMonthly: "95.00",
    entitlements: {
      "module:core": true,
      "module:inventory": true,
      "module:roasting": true,
      "module:quality": true,
      "limit:locations": 2,
      "limit:users": 10,
      "limit:machines": 3,
    },
  },
  {
    slug: "scale",
    name: "Scale",
    rank: 30,
    priceMonthly: "275.00",
    entitlements: {
      "module:core": true,
      "module:inventory": true,
      "module:roasting": true,
      "module:quality": true,
      "module:orders": true,
      "limit:locations": 5,
      "limit:users": 30,
      "limit:machines": 10,
    },
  },
  {
    slug: "advanced",
    name: "Advanced",
    rank: 40,
    priceMonthly: "999.00",
    entitlements: {
      "module:core": true,
      "module:inventory": true,
      "module:roasting": true,
      "module:quality": true,
      "module:orders": true,
      "module:green_contracts": true,
      "module:resource_planning": true,
      "module:samples": true,
      // Café intelligence is a top-tier module: it is the one that requires
      // hardware on a bar, and the roasteries that want it are the ones
      // running their own shops.
      "module:cafe": true,
      "module:api": true,
      "limit:locations": null,
      "limit:users": null,
      "limit:machines": null,
    },
  },
];
