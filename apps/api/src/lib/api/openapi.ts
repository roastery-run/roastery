import { z } from "@hono/zod-openapi";

/** Every failure returns `{ error }`; 500 additionally carries a correlation id. */
export const errorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
});

export const internalErrorSchema = z.object({
  error: z.string(),
  correlationId: z.string().optional(),
});

/**
 * A 402 says the organization's PLAN is the obstacle, not the caller's role.
 * Keeping it structurally distinct from 403 is what lets the console show an
 * upgrade path instead of a generic "forbidden".
 */
export const entitlementErrorSchema = z.object({
  error: z.string(),
  code: z.enum(["entitlement_required", "quota_exceeded"]),
  module: z.string().optional(),
  plan: z.string().optional(),
  requiredPlans: z.array(z.string()).optional(),
  key: z.string().optional(),
  limit: z.number().optional(),
  current: z.number().optional(),
});

/**
 * What each namespace is called, and what it is for.
 *
 * The tag `name` stays the machine namespace — it is what every operation
 * references, what a client generator turns into a class name, and what the
 * `#tag/inventory.green` anchors in the rendered docs are built from. Renaming
 * it to something readable would break all three. `x-displayName` is the part a
 * person reads, which is the only part that should be prose.
 *
 * The ORDER here is the order the docs render in, and it is the order the
 * business runs in — contract, green, roast, cup, sell, café — not the
 * alphabetical accident of how the modules happen to be named. A reader
 * scrolling this sidebar should be reading the shape of the product.
 *
 * Adding a namespace without adding it here fails `openapi.test.ts`.
 */
export const NAMESPACE_TAGS: ReadonlyArray<{
  name: string;
  displayName: string;
  description: string;
}> = [
  {
    name: "sourcing.contract",
    displayName: "Green contracts",
    description:
      "Forward contracts with producers and importers: their milestones, the shipments received against them, and what is still outstanding.",
  },
  {
    name: "sourcing.sample",
    displayName: "Samples",
    description:
      "Pre-purchase samples, from arrival through approval to the green lot an approved one becomes.",
  },
  {
    name: "inventory.green",
    displayName: "Green coffee",
    description:
      "Green lots and every movement of one — receipts, adjustments, transfers, splits, merges and reservations — plus the landed cost built up from its components. Quantities move through an append-only ledger, so a balance is auditable rather than merely plausible.",
  },
  {
    name: "inventory.roast",
    displayName: "Roasted coffee",
    description:
      "Roasted lots, their quantities, and the trace from a roasted lot back to the green it came from.",
  },
  {
    name: "inventory.blend",
    displayName: "Blends",
    description:
      "Blend recipes, the roasted lots each component draws from, and whether a blend can be produced from what is on hand right now.",
  },
  {
    name: "inventory.material",
    displayName: "Materials",
    description:
      "Packaging and other non-coffee stock, their bills of materials, and what a production run would consume.",
  },
  {
    name: "production.profile",
    displayName: "Roast profiles",
    description: "Named roast curves that a batch is roasted against.",
  },
  {
    name: "production.roast",
    displayName: "Roast batches",
    description:
      "Roasting a batch: starting it, completing it, reading its curve, and importing a roast recorded in Artisan.",
  },
  {
    name: "production.schedule",
    displayName: "Production planning",
    description:
      "Aggregate demand, the machine-feasible schedule that satisfies it, and releasing that schedule to the floor.",
  },
  {
    name: "quality.cupping",
    displayName: "Cupping",
    description:
      "Cupping sessions, each cupper's own scores, and the aggregate a finalized session produces.",
  },
  {
    name: "quality.grading",
    displayName: "Physical grading",
    description:
      "Defect counts and screen sizes recorded against a lot, and releasing a lot from quarantine.",
  },
  {
    name: "quality.form",
    displayName: "Form templates",
    description:
      "The questions a roastery adds to a scoresheet on top of the standard ones. Editing publishes a new version and retires the old, so a sheet filled in last year still reads as it was filled.",
  },
  {
    name: "orders",
    displayName: "Orders",
    description:
      "Customers, sales orders, and allocating roasted stock against them. A partial allocation is reported as partial, never as success.",
  },
  {
    name: "cafe",
    displayName: "Cafés",
    description:
      "Café sites, the bar equipment in them, espresso shot telemetry, and reconciling that telemetry against point-of-sale takings.",
  },
  {
    name: "traceability",
    displayName: "Traceability",
    description:
      "Trace forward from a green lot to what was sold, or backward from a bag to the contract, and issue the certificate a retail QR code resolves to.",
  },
  {
    name: "catalog.product",
    displayName: "Products",
    description: "The sellable goods a roastery lists, and how they map to what it roasts.",
  },
  {
    name: "catalog.party",
    displayName: "Partners and producers",
    description:
      "The organizations on the other side of a transaction — importers, exporters and customers — and the producers a coffee is attributed to.",
  },
  {
    name: "catalog.location",
    displayName: "Locations",
    description:
      "Warehouses, roasteries and café sites that stock can be held at or moved between.",
  },
  {
    name: "catalog.machine",
    displayName: "Roasting machines",
    description:
      "The roasters themselves, their capacity, and the batch sizes a schedule may assign to them.",
  },
  {
    name: "reporting",
    displayName: "Reports",
    description:
      "Requesting a document, watching it render, and the signed, expiring link that downloads it.",
  },
  {
    name: "reporting.label",
    displayName: "Label templates",
    description: "Retail bag label layouts, including where the traceability QR code sits.",
  },
  {
    name: "alerts",
    displayName: "Alerts",
    description:
      "What needs a decision today: overdue contract milestones, stock below its reorder point, quarantined lots. Deduplicated per rule, subject and day, so the same alert does not arrive every morning until somebody mutes it.",
  },
  {
    name: "webhooks",
    displayName: "Webhooks",
    description:
      "Endpoints, their signing secrets, and the delivery record for every attempt. Events are emitted in the same transaction as the change they describe, so a change that committed always has an event.",
  },
  {
    name: "console",
    displayName: "Console",
    description:
      "Operations the console itself needs — members, credentials and entitlements. Present so the console's client is typed, and excluded from the public document: these are not part of anyone's integration contract.",
  },
];

/**
 * The tag list as OpenAPI wants it. `x-displayName` is the widely-supported
 * extension for a readable tag; renderers that do not know it fall back to the
 * name, which is exactly what was shown before.
 */
export function openApiTags() {
  return NAMESPACE_TAGS.map(({ name, displayName, description }) => ({
    name,
    description,
    "x-displayName": displayName,
  }));
}

function json(schema: z.ZodTypeAny, description: string) {
  return { description, content: { "application/json": { schema } } };
}

/**
 * Standard error responses. Declared on every operation so a generated client
 * models them, and so 429 is documented — a rate limit clients cannot see in
 * the spec is one they will not back off from.
 */
export function errorResponses(opts: { conflict?: boolean; notFound?: boolean } = {}) {
  const { conflict = false, notFound = true } = opts;
  return {
    400: json(errorSchema, "Invalid request"),
    401: json(errorSchema, "Missing or invalid credentials"),
    403: json(errorSchema, "The caller's role does not grant this permission"),
    ...(notFound ? { 404: json(errorSchema, "Not found") } : {}),
    ...(conflict ? { 409: json(errorSchema, "Conflict") } : {}),
    429: json(errorSchema, "Rate limited — see Retry-After"),
    500: json(internalErrorSchema, "Internal error"),
  };
}
