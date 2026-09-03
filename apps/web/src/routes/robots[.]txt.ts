import { createFileRoute } from "@tanstack/react-router";
import { canonical, INDEXABLE } from "@/content/site";

/**
 * robots.txt, per environment.
 *
 * A server route rather than a file in `public/`, because the answer differs
 * by deployment and a static file cannot know which one it is. The previous
 * static file allowed everything and advertised a sitemap that did not exist —
 * so staging invited crawlers to compete with production, and production
 * pointed them at a 404.
 *
 * Disallow is not by itself enough to keep a page out of an index; the
 * `noindex` meta tag in __root.tsx is what actually does that. This stops the
 * crawl, that stops the listing.
 */
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(
          INDEXABLE
            ? `User-agent: *\nAllow: /\n\nSitemap: ${canonical("/sitemap.xml")}\n`
            : "# Not the production site.\nUser-agent: *\nDisallow: /\n",
          {
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "public, max-age=3600",
            },
          },
        ),
    },
  },
});
