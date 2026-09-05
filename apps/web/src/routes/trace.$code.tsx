import { EmptyState } from "@roastery/ui";
import { formatCountry, formatDate, formatPercent, humanize } from "@roastery/units";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Coffee, Mountain } from "lucide-react";

/**
 * The page printed on a retail bag.
 *
 * On the marketing app, and server-rendered, and both are deliberate. This is
 * unauthenticated, indexable, shared as a link, and opened on a phone in a café
 * on a bad connection. Client-rendered it would download a framework, boot it,
 * fetch the certificate and only then paint — and a social scraper would see an
 * empty shell where the coffee's name should be.
 *
 * It reads a FROZEN snapshot. Lots get merged and consumed after coffee ships,
 * so a live query would describe something other than what is in the bag.
 */
type Trace = {
  qrToken: string;
  issuedAt: string;
  coffee: {
    name: string;
    lotCode: string;
    roastLevel: string | null;
    roastedAt: string | null;
  };
  origins: {
    producer: string | null;
    country: string | null;
    region: string | null;
    altitude: string | null;
    process: string | null;
    varieties: string[];
  }[];
  roast: { batchNumber: string; roastedAt: string | null; weightLossPct: string | null } | null;
};

/**
 * Runs on the server, so the API base is a server-side environment variable and
 * the browser never learns the internal API host.
 */
const fetchTrace = createServerFn({ method: "GET" })
  .inputValidator((code: string) => code)
  .handler(async ({ data: code }): Promise<Trace | null> => {
    // The token is 24 hex characters. Rejecting anything else here keeps a
    // malformed scan from becoming an upstream request at all.
    if (!/^[0-9a-f]{24}$/.test(code)) return null;

    const base = process.env.API_URL ?? "http://localhost:8787";
    const response = await fetch(`${base}/trace/v1/${code}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Could not load this coffee");
    return (await response.json()) as Trace;
  });

export const Route = createFileRoute("/trace/$code")({
  loader: async ({ params }) => {
    const trace = await fetchTrace({ data: params.code });
    if (!trace) throw notFound();
    return trace;
  },
  head: ({ loaderData }) =>
    loaderData
      ? {
          meta: [
            { title: `${loaderData.coffee.name} — traceability` },
            {
              name: "description",
              content: describeOrigin(loaderData),
            },
            { property: "og:title", content: loaderData.coffee.name },
            { property: "og:description", content: describeOrigin(loaderData) },
          ],
        }
      : {},
  component: TracePage,
  notFoundComponent: () => (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <EmptyState
        icon={Coffee}
        title="We could not find this coffee"
        description="Check the code on your bag. If it is right, the roaster may not have published this batch yet."
      />
    </div>
  ),
});

/** A one-line description for the link preview. */
function describeOrigin(trace: Trace): string {
  const origin = trace.origins[0];
  const where = [origin?.producer, origin?.region, formatCountry(origin?.country)]
    .filter((part) => part && part !== "—")
    .join(", ");
  const roasted = trace.coffee.roastedAt ? `Roasted ${formatDate(trace.coffee.roastedAt)}.` : "";
  return where ? `${where}. ${roasted}`.trim() : `Lot ${trace.coffee.lotCode}. ${roasted}`.trim();
}

function TracePage() {
  const { coffee, origins, roast, issuedAt } = Route.useLoaderData();

  return (
    <div className="mx-auto max-w-2xl px-6 py-12 lg:py-16">
      <p className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
        Traceability certificate
      </p>
      <h1 className="mt-3 text-balance font-semibold text-[clamp(1.75rem,4vw,2.5rem)] leading-tight tracking-tight">
        {coffee.name}
      </h1>
      <p className="mt-2 text-muted-foreground">
        Lot <span className="font-mono">{coffee.lotCode}</span>
        {coffee.roastedAt ? ` · roasted ${formatDate(coffee.roastedAt)}` : null}
        {coffee.roastLevel ? ` · ${coffee.roastLevel} roast` : null}
      </p>

      <section className="mt-10 space-y-4">
        <h2 className="font-medium text-sm uppercase tracking-wide">Where it came from</h2>
        {origins.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Origin detail was not recorded for this batch.
          </p>
        ) : (
          origins.map((origin) => (
            <div
              key={`${origin.producer ?? "?"}-${origin.region ?? "?"}`}
              className="rounded-2xl bg-card ring-1 ring-foreground/10 p-5"
            >
              <div className="flex items-start gap-3">
                <Mountain className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{origin.producer ?? "Producer not recorded"}</p>
                  <p className="text-muted-foreground text-sm">
                    {[origin.region, formatCountry(origin.country)]
                      .filter((part) => part && part !== "—")
                      .join(", ") || "—"}
                    {origin.altitude ? ` · ${origin.altitude}` : null}
                  </p>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 pt-2 text-sm">
                    <dt className="text-muted-foreground">Process</dt>
                    <dd>{humanize(origin.process)}</dd>
                    <dt className="text-muted-foreground">Varieties</dt>
                    <dd>{origin.varieties.length ? origin.varieties.join(", ") : "—"}</dd>
                  </dl>
                </div>
              </div>
            </div>
          ))
        )}
      </section>

      {roast ? (
        <section className="mt-10 space-y-3">
          <h2 className="font-medium text-sm uppercase tracking-wide">How it was roasted</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-2xl bg-card ring-1 ring-foreground/10 p-5 text-sm">
            <dt className="text-muted-foreground">Batch</dt>
            <dd className="font-mono">{roast.batchNumber}</dd>
            <dt className="text-muted-foreground">Roasted</dt>
            <dd>{formatDate(roast.roastedAt)}</dd>
            <dt className="text-muted-foreground">Weight loss</dt>
            <dd className="tabular-nums">{formatPercent(roast.weightLossPct, 2)}</dd>
          </dl>
        </section>
      ) : null}

      {/* Says plainly that this is a snapshot, so a customer scanning in
          eighteen months understands why it does not change. */}
      <p className="mt-10 text-muted-foreground text-xs">
        This certificate was issued on {formatDate(issuedAt)} and records the coffee as it was when
        it shipped. It does not change afterwards.
      </p>
    </div>
  );
}
