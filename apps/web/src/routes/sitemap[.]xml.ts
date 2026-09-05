import { createFileRoute } from "@tanstack/react-router";
import { LEGAL } from "@/content/legal";
import { canonical, INDEXABLE } from "@/content/site";
import { SOLUTIONS } from "@/content/solutions";

/**
 * The sitemap, derived from the same content registry the pages render from.
 *
 * Listing routes by hand is how a sitemap ends up advertising a solution page
 * that was renamed six months ago. Adding a solution to `solutions.ts` adds it
 * here, and there is no second list to forget.
 *
 * `/trace/$code` is deliberately absent: those are per-bag certificates, not
 * pages anyone should discover by crawling.
 */
const paths = () => [
  "/",
  "/pricing",
  ...SOLUTIONS.map((s) => `/solutions/${s.slug}`),
  ...LEGAL.map((l) => `/legal/${l.slug}`),
];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => {
        // A non-production deployment publishes an empty sitemap rather than
        // 404ing: a crawler that reached it should be told there is nothing
        // here, not that something is broken.
        const urls = INDEXABLE ? paths() : [];
        const body =
          `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          urls.map((p) => `  <url><loc>${canonical(p)}</loc></url>\n`).join("") +
          `</urlset>\n`;
        return new Response(body, {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
