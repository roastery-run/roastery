import { Button, Card, CardContent, StatusBadge } from "@roastery/ui";
import { formatWeight } from "@roastery/units";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { ProductFrame } from "@/components/product-frame";
import { canonical, SITE } from "@/content/site";
import { SOLUTIONS } from "@/content/solutions";

export const Route = createFileRoute("/")({
  head: () => ({
    links: [{ rel: "canonical", href: canonical("/") }],
    meta: [{ property: "og:url", content: canonical("/") }],
  }),
  component: Home,
});

/** Fixed fixtures for the product visuals. Real components, stable data. */
const DEMO_LOTS = [
  { name: "Huila Washed", code: "COL-2026-01", kg: "1200.0000", status: "available" },
  { name: "Konga Natural", code: "ETH-2026-04", kg: "600.0000", status: "available" },
  { name: "Rainha Pulped", code: "BRA-2025-11", kg: "1787.5000", status: "reserved" },
  { name: "Sonora Honey", code: "CRI-2026-02", kg: "450.0000", status: "quarantined" },
];

function Home() {
  return (
    <>
      <section className="border-border border-b">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-2 lg:py-28">
          <div className="space-y-6">
            <p className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
              Coffee operations platform
            </p>
            <h1 className="text-balance font-semibold text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.05] tracking-tight">
              From the contract to the cup.{" "}
              <span className="text-muted-foreground">One system of record.</span>
            </h1>
            <p className="max-w-prose text-lg text-muted-foreground">
              Green contracts, inventory, roasting, quality, planning, orders and cafés — in one
              data model that a generic ERP cannot express.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <a href={`${SITE.console}/login`}>
                  Get started
                  <ArrowRight className="size-4" aria-hidden="true" />
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a href={`${SITE.docs}`}>Read the API docs</a>
              </Button>
            </div>
            <p className="font-mono text-muted-foreground text-xs">
              Every screen here is built on the same public API you get.
            </p>
          </div>

          {/* The real DataTable-styled markup from the design system, fed fixed
              data — not a screenshot that goes stale and is wrong in the other
              theme. */}
          <ProductFrame
            caption="app.roastery.run/inventory"
            label="The green coffee list, showing four lots with their codes, weights and statuses — one available, one reserved, one quarantined."
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border border-b text-muted-foreground text-xs">
                  <th className="pb-2 pr-3 text-left font-medium">Lot</th>
                  <th className="pb-2 pr-3 text-left font-medium">Code</th>
                  {/* Padded rather than left to abut: a right-aligned numeric
                      column running straight into the next header reads as one
                      word ("On handStatus"). */}
                  <th className="pb-2 pr-4 text-right font-medium">On hand</th>
                  <th className="pb-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {DEMO_LOTS.map((lot) => (
                  <tr key={lot.code}>
                    <td className="py-2 pr-3 font-medium">{lot.name}</td>
                    <td className="py-2 pr-3 font-mono text-muted-foreground text-xs">
                      {lot.code}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatWeight(lot.kg)}</td>
                    <td className="py-2">
                      <StatusBadge status={lot.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ProductFrame>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="font-semibold text-2xl tracking-tight">Seven areas, one data model</h2>
        <p className="mt-2 max-w-prose text-muted-foreground">
          The value is not any single feature. It is that a green lot, a roast batch, a cupping, a
          blend and an order are the same coffee, and the system knows it.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {SOLUTIONS.map((solution) => (
            <Card key={solution.slug} className="transition-colors hover:border-primary/40">
              <CardContent className="space-y-2 p-5">
                <h3 className="font-medium">
                  <Link
                    to="/solutions/$slug"
                    params={{ slug: solution.slug }}
                    className="after:absolute after:inset-0 hover:underline"
                  >
                    {solution.label}
                  </Link>
                </h3>
                <p className="text-muted-foreground text-sm">{solution.summary}</p>
                <p className="pt-1 font-mono text-muted-foreground text-xs">
                  {solution.apiNamespace}.*
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-border border-t bg-muted/30">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="font-semibold text-2xl tracking-tight">The API is not an afterthought</h2>
          <p className="mt-2 max-w-prose text-muted-foreground">
            The console is just another client of the same <code>/rpc/v1</code> surface you get.
            There is no screen that can do something the API cannot — that gap is structurally
            impossible here, because building one would mean building it twice.
          </p>
          <pre className="mt-6 overflow-x-auto rounded-2xl bg-card ring-1 ring-foreground/10 p-4 font-mono text-xs">
            <code>{`curl -X POST ${SITE.api}/rpc/v1/inventory.green.listGreenLots \\
  -H "Authorization: Bearer $ROASTERY_API_KEY" \\
  -H "X-Roastery-Org: $ORG_ID" \\
  -d '{"filter":{"status":"available"},"page":{"limit":50}}'`}</code>
          </pre>
        </div>
      </section>
    </>
  );
}
