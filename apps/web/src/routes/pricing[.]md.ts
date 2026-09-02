import { createFileRoute } from "@tanstack/react-router";
import {
  ALL_MODULES,
  COMPARE_ROWS,
  type CompareRow,
  EVERY_PLAN,
  FAQS,
  isSection,
  MODULE_LABEL,
  PLANS,
} from "@/content/pricing";

/**
 * Pricing as plain markdown.
 *
 * For agents, and for anything else that would rather read text than parse a
 * layout. Rendered from the SAME `pricing.ts` the human page uses, so the two
 * cannot drift — change a price in one place and both move.
 *
 * This matters more each year: a growing share of the people evaluating this
 * product are reading through something that does not execute JavaScript and
 * does not want to reverse-engineer a comparison table out of a grid of ticks.
 */
export const Route = createFileRoute("/pricing.md")({
  server: {
    handlers: {
      GET: () =>
        new Response(render(), {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Cache-Control": "public, max-age=300, s-maxage=3600",
          },
        }),
    },
  },
});

const cell = (value: string | boolean | undefined): string => {
  if (value === true) return "Yes";
  if (value === false || value === undefined) return "No";
  return value;
};

const planCells = (row: CompareRow) =>
  [cell(row.starter), cell(row.core), cell(row.scale), cell(row.advanced)].join(" | ");

function render(): string {
  const out: string[] = [];
  const names = PLANS.map((plan) => plan.name);

  out.push("# ROASTERY pricing");
  out.push("");
  out.push(
    "Coffee operations platform: green contracts, inventory, roasting, quality, " +
      "production planning, orders and cafés. All prices in EUR, per month. Every " +
      "plan includes the public API for the modules it covers — there is no " +
      "separate integration tier.",
  );
  out.push("");
  out.push("Human version: https://roastery.run/pricing");
  out.push("");

  out.push("## Plans");
  out.push("");
  for (const plan of PLANS) {
    out.push(`### ${plan.name} — ${plan.price}${plan.priceNote ? ` ${plan.priceNote}` : ""}`);
    out.push("");
    out.push(`${plan.headline} ${plan.subtitle}`);
    out.push("");
    for (const feature of plan.features) out.push(`- ${feature}`);
    out.push("");
    out.push(`Limits: ${plan.limits.map((l) => `${l.label} ${l.value}`).join(", ")}.`);
    if (plan.ctaNote) out.push(`${plan.ctaNote}`);
    out.push("");
  }

  out.push("## On every plan");
  out.push("");
  for (const item of EVERY_PLAN) {
    out.push(`- **${item.title.replace(/\.$/, "")}** ${item.body}`);
  }
  out.push("");

  out.push("## Compare plans");
  out.push("");
  out.push(`| Feature | ${names.join(" | ")} |`);
  out.push(`| --- | ${names.map(() => "---").join(" | ")} |`);
  for (const row of COMPARE_ROWS) {
    if (isSection(row)) {
      out.push(`| **${row.feature}** | ${names.map(() => "").join(" | ")} |`);
      continue;
    }
    // The hint carries the reason a row means what it does; dropping it would
    // make this the lossy version rather than the readable one.
    const label = row.hint ? `${row.feature} — ${row.hint}` : row.feature;
    out.push(`| ${label} | ${planCells(row)} |`);
  }
  out.push("");

  out.push("### Modules");
  out.push("");
  out.push(`| Module | ${names.join(" | ")} |`);
  out.push(`| --- | ${names.map(() => "---").join(" | ")} |`);
  for (const module of ALL_MODULES) {
    const cells = PLANS.map((plan) => (plan.modules.includes(module) ? "Yes" : "No")).join(" | ");
    out.push(`| ${MODULE_LABEL[module]} | ${cells} |`);
  }
  out.push("");

  out.push("## Questions");
  out.push("");
  for (const faq of FAQS) {
    out.push(`### ${faq.q}`);
    out.push("");
    out.push(faq.a);
    out.push("");
  }

  out.push("---");
  out.push("");
  out.push("API reference: https://docs.roastery.run");
  out.push("");

  return out.join("\n");
}
