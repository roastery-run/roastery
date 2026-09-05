import { createFileRoute, notFound } from "@tanstack/react-router";
import { LEGAL, legalBySlug } from "@/content/legal";
import { canonical } from "@/content/site";

/**
 * One renderer for both legal documents.
 *
 * Same shape as the solutions pages, for the same reason: two hand-written
 * pages are how the effective date on one silently stops matching the other,
 * and how a link in the footer outlives the page it points at.
 */
export const Route = createFileRoute("/legal/$slug")({
  loader: ({ params }) => {
    const page = legalBySlug(params.slug);
    if (!page) throw notFound();
    return page;
  },
  head: ({ loaderData }) =>
    loaderData
      ? {
          meta: [
            { title: `${loaderData.title} — ROASTERY` },
            { name: "description", content: loaderData.summary },
            { property: "og:title", content: loaderData.title },
            { property: "og:description", content: loaderData.summary },
            { property: "og:url", content: canonical(`/legal/${loaderData.slug}`) },
          ],
          links: [{ rel: "canonical", href: canonical(`/legal/${loaderData.slug}`) }],
        }
      : {},
  component: LegalView,
});

function LegalView() {
  const page = Route.useLoaderData();
  const effective = new Date(page.updatedAt);

  return (
    <article className="mx-auto max-w-3xl px-6 py-16">
      <header className="border-border border-b pb-8">
        <h1 className="font-semibold text-3xl tracking-tight">{page.title}</h1>
        <p className="mt-3 text-muted-foreground">{page.summary}</p>
        {/* The date a reader diffs against their last copy, so it is stated
            plainly rather than buried at the end. */}
        <p className="mt-4 text-muted-foreground text-sm">
          Effective{" "}
          <time dateTime={page.updatedAt}>
            {effective.toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </time>
        </p>
      </header>

      <div className="mt-10 space-y-10">
        {page.sections.map((section) => (
          <section key={section.heading} className="space-y-3">
            <h2 className="font-semibold text-xl tracking-tight">{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="text-muted-foreground leading-relaxed">
                {paragraph}
              </p>
            ))}
            {section.bullets ? (
              <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
                {section.bullets.map((bullet) => (
                  <li key={bullet} className="leading-relaxed">
                    {bullet}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>

      <footer className="mt-14 border-border border-t pt-6 text-muted-foreground text-sm">
        {LEGAL.filter((other) => other.slug !== page.slug).map((other) => (
          <a key={other.slug} href={`/legal/${other.slug}`} className="hover:text-foreground">
            Read the {other.label.toLowerCase()} document
          </a>
        ))}
      </footer>
    </article>
  );
}
