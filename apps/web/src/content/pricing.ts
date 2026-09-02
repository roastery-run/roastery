/**
 * Plans, in the same vocabulary the product gates on.
 *
 * `modules` are `ModuleKey`s — the identical union the API's entitlement
 * checks and the console's locked-module screens use. That is what makes it
 * impossible for this page to advertise a module the product does not gate on,
 * or to omit one it does.
 *
 * Prices mirror `packages/db/src/seed-authz.ts`. They are duplicated rather
 * than fetched because a marketing page must render without an API call — but
 * `pricing.test.ts` asserts the two agree.
 */
import type { ModuleKey } from "@roastery/schemas";

export type Plan = {
  slug: string;
  name: string;
  priceMonthly: string | null;
  blurb: string;
  /** Who it is for, stated plainly enough that the wrong reader self-selects out. */
  who: string;
  modules: ModuleKey[];
  limits: { label: string; value: string }[];
  featured?: boolean;
};

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

export const PLANS: Plan[] = [
  {
    slug: "starter",
    name: "Starter",
    priceMonthly: "99.00",
    blurb: "Roast, record and keep the log honest.",
    who: "A single-machine roastery that wants its roasts and profiles in one place.",
    modules: ["core", "roasting"],
    limits: [
      { label: "Locations", value: "1" },
      { label: "Machines", value: "2" },
      { label: "Users", value: "5" },
    ],
  },
  {
    slug: "core",
    name: "Core",
    priceMonthly: "299.00",
    blurb: "Inventory and quality, on a ledger you can audit.",
    who: "A roastery that has stopped trusting its inventory spreadsheet.",
    modules: ["core", "inventory", "roasting", "quality"],
    limits: [
      { label: "Locations", value: "3" },
      { label: "Machines", value: "6" },
      { label: "Users", value: "20" },
    ],
  },
  {
    slug: "scale",
    name: "Scale",
    priceMonthly: "599.00",
    blurb: "Add the order book and the production plan.",
    who: "A wholesale roastery planning roast days around real demand.",
    modules: ["core", "inventory", "roasting", "quality", "orders", "resource_planning"],
    limits: [
      { label: "Locations", value: "10" },
      { label: "Machines", value: "20" },
      { label: "Users", value: "Unlimited" },
    ],
    featured: true,
  },
  {
    slug: "advanced",
    name: "Advanced",
    priceMonthly: "999.00",
    blurb: "Green contracts, cafés, and the whole public API.",
    who: "A roastery buying its own green and running its own bars.",
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
  },
];

export const ALL_MODULES = Object.keys(MODULE_LABEL) as ModuleKey[];
