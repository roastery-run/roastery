import { Button } from "@roastery/ui";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";
import { SOLUTIONS, solutionBySlug } from "@/content/solutions";

export const Route = createFileRoute("/solutions/$slug")({
  loader: ({ params }) => {
    const page = solutionBySlug(params.slug);
    if (!page) throw notFound();
    return page;
  },
  /**
   * Rendered into the server response, which is the entire reason this app is
   * server-rendered. A crawler or a social scraper receives these tags without
   * executing anything.
   */
  head: ({ loaderData }) =>
    loaderData
      ? {
          meta: [
            { title: `${loaderData.title} — ROASTERY` },
            { name: "description", content: loaderData.summary },
            { property: "og:title", content: loaderData.title },
            { property: "og:description", content: loaderData.summary },
            {
              property: "og:url",
              content: `https://roastery.run/solutions/${loaderData.slug}`,
            },
          ],
          links: [
            {
              rel: "canonical",
              href: `https://roastery.run/solutions/${loaderData.slug}`,
            },
          ],
        }
      : {},
  component: SolutionView,
});

const CONSOLE_URL = import.meta.env.VITE_CONSOLE_URL ?? "http://localhost:5174";

/**
 * One renderer for all seven solution pages.
 *
 * The alternative — seven bespoke components — is how a marketing site ends up
 * with pages that disagree about section order, heading levels and even the
 * product's own claims.
 */
function SolutionView() {
  const page = Route.useLoaderData();
  const others = SOLUTIONS.filter((s) => s.slug !== page.slug);

  return (
    <>
      <section className="border-border border-b">
        <div className="mx-auto max-w-3xl px-6 py-16 lg:py-20">
          <p className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
            {page.label}
          </p>
          <h1 className="mt-3 text-balance font-semibold text-[clamp(1.75rem,3.5vw,2.75rem)] leading-[1.1] tracking-tight">
            {page.title}
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">{page.summary}</p>
        </div>
      </section>

      {/* The problem before the solution, in the reader's own words. A page
          that opens with what we built asks the reader to do the translation. */}
      <section className="border-border border-b bg-muted/30">
        <div className="mx-auto max-w-3xl px-6 py-12">
          <h2 className="font-medium text-muted-foreground text-sm uppercase tracking-wide">
            The problem
          </h2>
          <p className="mt-3 text-balance text-lg leading-relaxed">{page.problem}</p>
        </div>
      </section>

      <section className="mx-auto max-w-3xl space-y-12 px-6 py-16">
        {page.sections.map((section) => (
          <div key={section.heading} className="space-y-3">
            <h2 className="font-semibold text-xl tracking-tight">{section.heading}</h2>
            <p className="text-muted-foreground leading-relaxed">{section.body}</p>
            {section.points ? (
              <ul className="space-y-2 pt-1">
                {section.points.map((point) => (
                  <li key={point} className="flex gap-2.5 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}

        <div className="rounded-md border border-border bg-card p-6">
          <h2 className="font-medium">Everything here is in the API</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            This area is <code className="font-mono">{page.apiNamespace}.*</code> — the same
            operations the console calls.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button asChild size="sm">
              <a href={`${CONSOLE_URL}/login`}>
                Get started
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href="http://localhost:8787/docs">API reference</a>
            </Button>
          </div>
        </div>
      </section>

      <section className="border-border border-t">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <h2 className="font-medium text-sm">Other areas</h2>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {others.map((other) => (
              <li key={other.slug}>
                <Link
                  to="/solutions/$slug"
                  params={{ slug: other.slug }}
                  className="text-muted-foreground text-sm hover:text-foreground"
                >
                  {other.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
