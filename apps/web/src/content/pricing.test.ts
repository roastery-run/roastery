/**
 * The pricing page must describe the plans the API actually enforces.
 *
 * Prices, limits and module lists are duplicated here rather than fetched,
 * because a marketing page has to render without an API call. Duplication is
 * fine; SILENT duplication is not — a plan that gained a module in the seed and
 * not on this page is a customer told they cannot have something they are
 * paying for, and the reverse is worse.
 */
import { PLANS as SEED_PLANS } from "@roastery/db/seed-authz";
import { moduleKeySchema } from "@roastery/schemas";
import { describe, expect, it } from "vitest";
import { ALL_MODULES, COMPARE_ROWS, isSection, MODULE_LABEL, PLANS } from "./pricing";

const seedBySlug = new Map(SEED_PLANS.map((plan) => [plan.slug, plan]));

describe("pricing", () => {
  it("lists exactly the plans the seed defines", () => {
    expect(PLANS.map((p) => p.slug).sort()).toEqual(SEED_PLANS.map((p) => p.slug).sort());
  });

  it.each(PLANS)("$name quotes the price the seed charges", (plan) => {
    const seed = seedBySlug.get(plan.slug);
    expect(seed, `no seed plan for ${plan.slug}`).toBeDefined();
    // The page formats it; the seed stores it. Compare the digits.
    const advertised = plan.price.replace(/[^\d.]/g, "");
    expect(Number(advertised)).toBe(Number(seed?.priceMonthly));
  });

  it.each(PLANS)("$name advertises exactly the modules the seed grants", (plan) => {
    const seed = seedBySlug.get(plan.slug);
    const granted = Object.entries(seed?.entitlements ?? {})
      .filter(([key, value]) => key.startsWith("module:") && value === true)
      .map(([key]) => key.slice("module:".length))
      .sort();
    expect([...plan.modules].sort()).toEqual(granted);
  });

  it.each(PLANS)("$name quotes the limits the seed enforces", (plan) => {
    const seed = seedBySlug.get(plan.slug);
    for (const limit of plan.limits) {
      const key = `limit:${limit.label.toLowerCase().replace(/\s+/g, "_")}`;
      const enforced = (seed?.entitlements as Record<string, unknown>)?.[key];
      if (enforced === undefined) continue;
      const expected = enforced === null ? "Unlimited" : String(enforced);
      expect(limit.value, `${plan.slug} ${limit.label}`).toBe(expected);
    }
  });

  it("labels every module key, and invents none", () => {
    // A missing label renders an empty comparison row; an invented one
    // advertises a module that does not exist.
    expect([...ALL_MODULES].sort()).toEqual([...moduleKeySchema.options].sort());
    for (const module of ALL_MODULES) {
      expect(MODULE_LABEL[module], module).toBeTruthy();
    }
  });

  it("gives every comparison row a value for every plan", () => {
    // An undefined cell renders as "not included", which is a claim — and a
    // wrong one if the row was simply never filled in.
    const incomplete = COMPARE_ROWS.filter(
      (row) =>
        !isSection(row) &&
        [row.starter, row.core, row.scale, row.advanced].some((v) => v === undefined),
    );
    expect(incomplete.map((r) => r.feature)).toEqual([]);
  });

  it("never claims a feature on a plan whose module it is not on", () => {
    // The specific mistake this catches: advertising webhooks on Scale when
    // module:api is Advanced-only.
    const webhooks = COMPARE_ROWS.find((row) => row.feature === "Webhooks");
    const scale = PLANS.find((p) => p.slug === "scale");
    expect(webhooks?.scale).toBe(scale?.modules.includes("api"));
  });
});
