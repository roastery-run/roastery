import { EmptyState } from "@roastery/ui";
import { formatCountry, formatDate, formatPercent, humanize } from "@roastery/units";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Coffee, Mountain, RefreshCw } from "lucide-react";

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
    // Imported inside the handler: this module also ships to the client, and
    // the bundler denies a static import of the server entry from a route.
    const { setResponseHeader } = await import("@tanstack/react-start/server");

    // The token is 24 hex characters. Rejecting anything else here keeps a
    // malformed scan from becoming an upstream request at all.
    if (!/^[0-9a-f]{24}$/.test(code)) return null;

    // No localhost fallback. API_URL is a Worker var rather than a baked-in
    // VITE_ value, so `verify-build-env.mjs` cannot see it and a production
    // config that omits it would send every QR scan to a host that does not
    // exist — served, cached and shared as a broken page. Failing here is
    // caught by the error boundary and by the first smoke check after deploy.
    // `import.meta.env.DEV` is only true under `vite dev`, so the convenience
    // fallback cannot survive into a build.
    const base = process.env.API_URL ?? (import.meta.env.DEV ? "http://localhost:8787" : undefined);
    if (!base) throw new Error("API_URL is not configured for this deployment");
    const response = await fetch(`${base}/trace/v1/${code}`, {
      // A hung upstream otherwise holds this SSR request until the platform
      // kills it, with nothing rendered.
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404) {
      // Briefly cacheable. A mistyped code is worth absorbing at the edge, but
      // not for long: a roaster who publishes the batch minutes later should
      // not be told it does not exist for a day.
      setResponseHeader("cache-control", "public, max-age=60");
      return null;
    }
    if (!response.ok) throw new Error("Could not load this coffee");

    // A certificate is a FROZEN snapshot, which is what makes this cacheable
    // at all. The API says the same thing about its own JSON — without it here
    // the HTML wrapper is uncacheable, so every scan is still a Worker
    // invocation plus a subrequest for a document that cannot change.
    //
    // s-maxage is a day at the edge, max-age five minutes in the browser, and
    // stale-while-revalidate means a scan during revalidation is served from
    // cache rather than waiting — which on a phone, in a café, on bad Wi-Fi,
    // is the whole difference.
    setResponseHeader(
      "cache-control",
      "public, max-age=300, s-maxage=86400, stale-while-revalidate=86400",
    );
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
  /**
   * The API blipped, or timed out, or is misconfigured.
   *
   * Without this the QR target on a retail bag renders the framework's default
   * error screen — a stack trace where the coffee's name should be, on the
   * most-loaded page in the product, in front of somebody who has just bought
   * a bag. `notFoundComponent` covered the code being wrong and nothing
   * covered the system being wrong.
   */
  errorComponent: () => (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <EmptyState
        icon={RefreshCw}
        title="We could not load this coffee right now"
        description="Something went wrong at our end, not with your bag. Try again in a moment."
        action={{ label: "Try again", onClick: () => window.location.reload() }}
      />
    </div>
  ),
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
