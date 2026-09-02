import { Badge, Button, cn } from "@roastery/ui";
import { formatMoney } from "@roastery/units";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Minus } from "lucide-react";
import { ALL_MODULES, MODULE_LABEL, PLANS } from "@/content/pricing";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Roastery" },
      {
        name: "description",
        content:
          "Four plans, from a single-machine roastery to one buying its own green and running its own bars. Every plan includes the public API for the modules it covers.",
      },
      { property: "og:title", content: "Roastery pricing" },
    ],
    links: [{ rel: "canonical", href: "https://roastery.run/pricing" }],
  }),
  component: Pricing,
});

const CONSOLE_URL = import.meta.env.VITE_CONSOLE_URL ?? "http://localhost:5174";

function Pricing() {
  return (
    <>
      <section className="border-border border-b">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center">
          <h1 className="font-semibold text-[clamp(1.75rem,3.5vw,2.5rem)] tracking-tight">
            Pricing
          </h1>
          <p className="mt-3 text-lg text-muted-foreground">
            Every plan includes the full public API for the modules it covers. There is no separate
            integration tier.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-4 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <div
              key={plan.slug}
              className={cn(
                "flex flex-col rounded-md border bg-card p-6",
                plan.featured ? "border-primary" : "border-border",
              )}
            >
              <div className="flex items-center gap-2">
                <h2 className="font-medium">{plan.name}</h2>
                {plan.featured ? <Badge>Most chosen</Badge> : null}
              </div>

              <p className="mt-3 font-mono font-semibold text-2xl tabular-nums">
                {plan.priceMonthly
                  ? formatMoney(plan.priceMonthly, "EUR", { digits: 0 })
                  : "Talk to us"}
                {plan.priceMonthly ? (
                  <span className="ml-1 font-normal font-sans text-muted-foreground text-sm">
                    /month
                  </span>
                ) : null}
              </p>

              <p className="mt-3 text-sm">{plan.blurb}</p>
              <p className="mt-1 text-muted-foreground text-sm">{plan.who}</p>

              <dl className="mt-5 space-y-1.5 text-sm">
                {plan.limits.map((limit) => (
                  <div key={limit.label} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{limit.label}</dt>
                    <dd className="tabular-nums">{limit.value}</dd>
                  </div>
                ))}
              </dl>

              <Button className="mt-6" variant={plan.featured ? "default" : "outline"} asChild>
                <a href={`${CONSOLE_URL}/login`}>Start with {plan.name}</a>
              </Button>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <h2 className="font-semibold text-xl tracking-tight">What each plan includes</h2>
        <div className="mt-4 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Modules included in each plan</caption>
            <thead>
              <tr className="border-border border-b bg-muted/40">
                <th scope="col" className="px-4 py-2.5 text-left font-medium">
                  Module
                </th>
                {PLANS.map((plan) => (
                  <th key={plan.slug} scope="col" className="px-4 py-2.5 text-center font-medium">
                    {plan.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ALL_MODULES.map((module) => (
                <tr key={module}>
                  <th scope="row" className="px-4 py-2 text-left font-normal">
                    {MODULE_LABEL[module]}
                  </th>
                  {PLANS.map((plan) => {
                    const included = plan.modules.includes(module);
                    return (
                      <td key={plan.slug} className="px-4 py-2 text-center">
                        {/* Never a colour-only signal: an icon plus a text
                            alternative, because this table gets printed and
                            forwarded. */}
                        {included ? (
                          <Check className="mx-auto size-4 text-success" aria-hidden="true" />
                        ) : (
                          <Minus
                            className="mx-auto size-4 text-muted-foreground/50"
                            aria-hidden="true"
                          />
                        )}
                        <span className="sr-only">
                          {included ? "Included" : "Not included"} in {plan.name}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
