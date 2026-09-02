/**
 * Plans, in the same vocabulary the product gates on.
 *
 * `modules` are `ModuleKey`s — the identical union the API's entitlement checks
 * and the console's locked-module screens use. That is what makes it impossible
 * for this page to advertise a module the product does not gate on, or to omit
 * one it does.
 *
 * Prices and limits mirror `packages/db/src/seed-authz.ts`, which is what the
 * API actually enforces. They are duplicated rather than fetched because a
 * marketing page must render without an API call — and `pricing.test.ts`
 * asserts the two agree, so the duplication cannot rot.
 */
import type { ModuleKey } from "@roastery/schemas";

export type Plan = {
  slug: string;
  name: string;
  /** Formatted for display; the authoritative figure is in the seed. */
  price: string;
  priceNote?: string;
  /** Who it is for, plainly enough that the wrong reader self-selects out. */
  subtitle: string;
  headline: string;
  features: string[];
  modules: ModuleKey[];
  limits: { label: string; value: string }[];
  cta: { label: string; href: string };
  /** The thing a buyer wants to know with their cursor already on the button. */
  ctaNote?: string;
  highlighted?: boolean;
};

const CONSOLE_URL = import.meta.env?.VITE_CONSOLE_URL ?? "http://localhost:5174";

export const PLANS: Plan[] = [
  {
    slug: "starter",
    name: "Starter",
    price: "€0",
    priceNote: "free, forever",
    subtitle: "For a single-machine roastery.",
    headline: "Roast, record, and keep the log honest.",
    features: [
      "Roast profiles and batch history",
      "Live curves from any Artisan-compatible bridge",
      "Artisan import for the roasts you already have",
      "Full API access for the roasting module",
    ],
    modules: ["core", "roasting"],
    limits: [
      { label: "Locations", value: "1" },
      { label: "Machines", value: "1" },
      { label: "Users", value: "3" },
    ],
    cta: { label: "Start free", href: `${CONSOLE_URL}/login` },
    ctaNote: "No card required. A real plan, not a trial.",
  },
  {
    slug: "core",
    name: "Core",
    price: "€95",
    priceNote: "per month",
    subtitle: "For a roastery that has stopped trusting its spreadsheet.",
    headline: "Inventory and quality, on a ledger you can audit.",
    features: [
      "Everything in Starter",
      "Green inventory on an append-only ledger",
      "Cupping sessions with per-cupper scores and spread",
      "Physical grading that quarantines a failing lot",
    ],
    modules: ["core", "inventory", "roasting", "quality"],
    limits: [
      { label: "Locations", value: "2" },
      { label: "Machines", value: "3" },
      { label: "Users", value: "10" },
    ],
    cta: { label: "Start with Core", href: `${CONSOLE_URL}/login` },
  },
  {
    slug: "scale",
    name: "Scale",
    price: "€275",
    priceNote: "per month",
    subtitle: "For a wholesale roastery selling what it roasts.",
    headline: "Add the order book.",
    features: [
      "Everything in Core",
      "Customers and sales orders",
      "First-expiry-first-out allocation",
      "Shortfalls reported as shortfalls, never as success",
    ],
    modules: ["core", "inventory", "roasting", "quality", "orders"],
    limits: [
      { label: "Locations", value: "5" },
      { label: "Machines", value: "10" },
      { label: "Users", value: "30" },
    ],
    highlighted: true,
    cta: { label: "Start with Scale", href: `${CONSOLE_URL}/login` },
    ctaNote: "Most roasteries buying their own green start here.",
  },
  {
    slug: "advanced",
    name: "Advanced",
    price: "€999",
    priceNote: "per month",
    subtitle: "For a roastery buying its own green and running its own bars.",
    headline: "Green contracts, planning, cafés, and the whole public API.",
    features: [
      "Everything in Scale",
      "Contracts, positions and landed cost",
      "Production scheduling and material requirements",
      "Café telemetry, webhooks and the full public API",
    ],
    modules: [
      "core",
      "inventory",
      "roasting",
      "quality",
      "orders",
      "resource_planning",
      "green_contracts",
      "samples",
      "cafe",
      "api",
    ],
    limits: [
      { label: "Locations", value: "Unlimited" },
      { label: "Machines", value: "Unlimited" },
      { label: "Users", value: "Unlimited" },
    ],
    cta: { label: "Start with Advanced", href: `${CONSOLE_URL}/login` },
  },
];

export const MODULE_LABEL: Record<ModuleKey, string> = {
  core: "Dashboard, catalogue and reports",
  inventory: "Coffee inventory management",
  resource_planning: "Resource planning",
  roasting: "Roasting & QC",
  quality: "Cupping and grading",
  orders: "Order fulfillment",
  green_contracts: "Green contracts & costs",
  samples: "Sample management",
  cafe: "Café intelligence",
  api: "Public API and webhooks",
};

export const ALL_MODULES = Object.keys(MODULE_LABEL) as ModuleKey[];

/** What every plan gets, so the comparison table does not have to repeat it. */
export const EVERY_PLAN: { title: string; body: string }[] = [
  {
    title: "The same API the product uses.",
    body: "There is no separate integration tier and no screen that can do something the API cannot — the console is another client of the same operations.",
  },
  {
    title: "An append-only ledger under every weight.",
    body: "Nothing changes a quantity without a ledger row, so a stock figure is auditable rather than merely plausible.",
  },
  {
    title: "Exact decimal arithmetic.",
    body: "Weights and money are exact decimals end to end. A float rounding error in a coffee ledger is not a rounding error, it is a discrepancy somebody has to explain.",
  },
  {
    title: "Your data, exportable.",
    body: "Every list is exportable as CSV from the same query the screen ran, and the API returns everything the console can see.",
  },
];

export type CompareRow = {
  feature: string;
  /** Explains a row where the label alone would mislead. */
  hint?: string;
  starter?: string | boolean;
  core?: string | boolean;
  scale?: string | boolean;
  advanced?: string | boolean;
};

/** A row with no plan values is a section heading. */
export const isSection = (row: CompareRow): boolean =>
  row.starter === undefined &&
  row.core === undefined &&
  row.scale === undefined &&
  row.advanced === undefined;

export const COMPARE_ROWS: CompareRow[] = [
  { feature: "Limits" },
  { feature: "Locations", starter: "1", core: "3", scale: "10", advanced: "Unlimited" },
  { feature: "Roasting machines", starter: "2", core: "6", scale: "20", advanced: "Unlimited" },
  { feature: "Users", starter: "5", core: "20", scale: "Unlimited", advanced: "Unlimited" },

  { feature: "Roasting" },
  { feature: "Profiles and batch history", starter: true, core: true, scale: true, advanced: true },
  {
    feature: "Live curves at 1 Hz",
    hint: "Streamed from any bridge. A dropped uplink replays from the bridge's own buffer, so the curve comes back identical to one that never dropped.",
    starter: true,
    core: true,
    scale: true,
    advanced: true,
  },
  { feature: "Artisan import", starter: true, core: true, scale: true, advanced: true },

  { feature: "Inventory" },
  {
    feature: "Green coffee ledger",
    hint: "Append-only. Every movement carries the balance it produced, and nothing can change a weight without one.",
    starter: false,
    core: true,
    scale: true,
    advanced: true,
  },
  { feature: "Roasted lots and blends", starter: false, core: true, scale: true, advanced: true },
  {
    feature: "Materials and bills of materials",
    starter: false,
    core: false,
    scale: true,
    advanced: true,
  },
  {
    feature: "Landed cost",
    hint: "Derived from what you bought rather than typed in twice. Change a freight figure and every affected lot, batch and open-order margin follows.",
    starter: false,
    core: false,
    scale: false,
    advanced: true,
  },

  { feature: "Quality" },
  {
    feature: "Cupping with per-cupper scores",
    hint: "Reports the spread alongside the mean. An 85 where everyone agreed and an 85 from an 80 and a 90 are different results.",
    starter: false,
    core: true,
    scale: true,
    advanced: true,
  },
  {
    feature: "Grading that quarantines",
    hint: "A failing grading blocks the lot from being reserved. Releasing it requires a reason, recorded.",
    starter: false,
    core: true,
    scale: true,
    advanced: true,
  },

  { feature: "Orders and planning" },
  {
    feature: "Customers and sales orders",
    starter: false,
    core: false,
    scale: true,
    advanced: true,
  },
  {
    feature: "FEFO allocation",
    hint: "First expiry, first out. Roasted coffee has a usable window measured in weeks, so the lot that should ship first is the one that goes stale first — which stops being FIFO once two batches are roasted on different days.",
    starter: false,
    core: false,
    scale: true,
    advanced: true,
  },
  {
    feature: "Production scheduling",
    hint: "Merges demand, sizes it to your drums, and orders the day: light before dark, decaf last.",
    starter: false,
    core: false,
    scale: false,
    advanced: true,
  },

  { feature: "Sourcing and cafés" },
  {
    feature: "Green contracts and positions",
    starter: false,
    core: false,
    scale: false,
    advanced: true,
  },
  { feature: "Sample management", starter: false, core: false, scale: false, advanced: true },
  {
    feature: "Café shot telemetry",
    hint: "Judged per group head. One failing group on a three-group machine is the most common real fault, and a machine-level average hides it.",
    starter: false,
    core: false,
    scale: false,
    advanced: true,
  },
  { feature: "POS reconciliation", starter: false, core: false, scale: false, advanced: true },

  { feature: "Integration" },
  { feature: "Public RPC API", starter: true, core: true, scale: true, advanced: true },
  {
    feature: "Webhooks",
    hint: "Signed with HMAC-SHA256, retried over roughly eight hours, and backed by a transactional outbox — the event commits with the change it describes.",
    starter: false,
    core: false,
    scale: false,
    advanced: true,
  },
  {
    feature: "OAuth client credentials",
    hint: "For a machine acting on behalf of an organization, validated statelessly with no database round trip per request.",
    starter: false,
    core: false,
    scale: false,
    advanced: true,
  },
  {
    feature: "Traceability certificates and QR pages",
    starter: true,
    core: true,
    scale: true,
    advanced: true,
  },
];

export const FAQS: { q: string; a: string }[] = [
  {
    q: "What happens when I reach a limit?",
    a: "The operation that would exceed it returns a 402 naming the limit, the current count and the plans that raise it. Nothing already created stops working, and you are never billed past your plan without choosing to upgrade.",
  },
  {
    q: "Is the API really on every plan?",
    a: "Yes, for the modules your plan includes. The console is another client of the same operations, so a screen that can do something the API cannot is not a thing we can accidentally ship. Webhooks and OAuth client credentials are the exception — those are on Advanced.",
  },
  {
    q: "Do I need special hardware?",
    a: "No. Roast telemetry arrives over a documented HTTP endpoint, so anything that can make a request can stream — including Artisan, which most roasteries already run. We ship the bridge and the ingest contract; you do not need a proprietary box.",
  },
  {
    q: "Can I move a lot of history in?",
    a: "Artisan exports import directly, including the timestamp quirks that make most importers offset every curve. Everything else goes through the same public API the product uses, so a bulk import is a script rather than a support ticket.",
  },
  {
    q: "What happens to my data if I leave?",
    a: "Every list exports as CSV from the same query the screen ran, and the API returns everything the console can see. There is no export tier and nothing is held back.",
  },
];
