import { Badge, Button, cn } from "@roastery/ui";
import { createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { CompareTable } from "@/components/compare-table";
import { EVERY_PLAN, FAQS, PLANS } from "@/content/pricing";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — ROASTERY" },
      {
        name: "description",
        content:
          "Four plans, from a single-machine roastery to one buying its own green and running its own bars. Every plan includes the public API for the modules it covers.",
      },
      { property: "og:title", content: "ROASTERY pricing" },
    ],
    links: [
      { rel: "canonical", href: "https://roastery.run/pricing" },
      // The same page as markdown, for agents and anything that would rather
      // read text than parse a layout.
      {
        rel: "alternate",
        type: "text/markdown",
        href: "https://roastery.run/pricing.md",
      },
    ],
  }),
  component: Pricing,
});

function Pricing() {
  return (
    <>
      <section className="border-border border-b">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center">
          <h1 className="font-semibold text-[clamp(1.75rem,3.5vw,2.5rem)] tracking-tight">
            Pricing
          </h1>
          <p className="mt-3 text-lg text-muted-foreground">
            Every plan includes the public API for the modules it covers. There is no separate
            integration tier.
          </p>
          <p className="mt-3 font-mono text-muted-foreground text-xs">
            Reading this as an agent?{" "}
            <a href="/pricing.md" className="underline underline-offset-4">
              /pricing.md
            </a>
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
                plan.highlighted ? "border-primary" : "border-border",
              )}
            >
              <div className="flex items-center gap-2">
                <h2 className="font-medium">{plan.name}</h2>
                {plan.highlighted ? <Badge>Most chosen</Badge> : null}
              </div>

              <p className="mt-3 font-mono font-semibold text-2xl tabular-nums">
                {plan.price}
                {plan.priceNote ? (
                  <span className="ml-1.5 font-normal font-sans text-muted-foreground text-sm">
                    {plan.priceNote}
                  </span>
                ) : null}
              </p>

              <p className="mt-3 font-medium text-sm">{plan.headline}</p>
              <p className="mt-1 text-muted-foreground text-sm">{plan.subtitle}</p>

              <ul className="mt-5 space-y-2 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              {/* Pushed to the bottom so the four CTAs sit on one line
                  regardless of how long each plan's copy runs. Buttons that
                  wander read as four different products. */}
              <div className="mt-auto pt-6">
                <Button
                  className="w-full"
                  variant={plan.highlighted ? "default" : "outline"}
                  asChild
                >
                  <a href={plan.cta.href}>{plan.cta.label}</a>
                </Button>
                {plan.ctaNote ? (
                  <p className="mt-2 text-center text-muted-foreground text-xs">{plan.ctaNote}</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-border border-y bg-muted/30">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <h2 className="font-semibold text-xl tracking-tight">On every plan</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {EVERY_PLAN.map((item) => (
              <div key={item.title}>
                <h3 className="font-medium text-sm">{item.title}</h3>
                <p className="mt-1 text-muted-foreground text-sm">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <h2 className="mb-4 font-semibold text-xl tracking-tight">Compare plans</h2>
        <CompareTable />
      </section>

      <section className="border-border border-t">
        <div className="mx-auto max-w-3xl px-6 py-12">
          <h2 className="font-semibold text-xl tracking-tight">Questions</h2>
          <dl className="mt-6 space-y-6">
            {FAQS.map((faq) => (
              <div key={faq.q}>
                <dt className="font-medium">{faq.q}</dt>
                <dd className="mt-1.5 text-muted-foreground">{faq.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </>
  );
}
