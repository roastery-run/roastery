import { Button } from "@roastery/ui";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { INDEXABLE } from "@/content/site";
import appCss from "../index.css?url";

export type RouterContext = { queryClient: QueryClient };

/**
 * The whole document, rendered on the server.
 *
 * `head` here is the site-wide default; each route overrides the parts that
 * differ. That is the point of server rendering this app — a crawler and a
 * social scraper both receive the real title and description rather than a
 * shell they would have to execute JavaScript to fill in.
 */
export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // A robots.txt Disallow stops the crawl but does not remove a page a
      // crawler already knows about from a link elsewhere. This does.
      ...(INDEXABLE ? [] : [{ name: "robots", content: "noindex, nofollow" }]),
      { title: "ROASTERY — coffee operations, from the contract to the cup" },
      {
        name: "description",
        content:
          "Green contracts, inventory, roasting, quality, planning, orders and cafés in one system of record, on a public API the product itself uses.",
      },
      { property: "og:site_name", content: "ROASTERY" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
  }),
  component: RootDocument,
  errorComponent: SiteError,
  notFoundComponent: NotFound,
});

/**
 * The last resort for a route with no boundary of its own.
 *
 * Every page here is public and most are the first thing a stranger sees, so
 * the default — a framework error screen — is a worse outcome than almost any
 * content. Rendered inside the document shell, so the header, the footer and a
 * way out survive whatever failed.
 */
function SiteError() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-24 text-center">
      <h1 className="font-semibold text-2xl tracking-tight">Something went wrong</h1>
      <p className="mt-3 text-muted-foreground">
        This is our fault, not yours. Try again in a moment.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Button onClick={() => window.location.reload()}>Try again</Button>
        <Button variant="outline" asChild>
          <a href="/">Go to the homepage</a>
        </Button>
      </div>
    </div>
  );
}

function RootDocument() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Runs before the stylesheet, so a dark-mode reader never sees a white
            flash. Inline because nothing that needs bundling can run this
            early. */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed literal, no interpolation.
          dangerouslySetInnerHTML={{
            __html: `(()=>{try{const m=document.cookie.match(/(?:^|;\\s*)roastery-theme=([^;]*)/);const s=m?decodeURIComponent(m[1]):null;const d=s==="dark"||((s==="system"||!s)&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark");document.documentElement.style.colorScheme=d?"dark":"light"}catch{}})()`,
          }}
        />
      </head>
      <body>
        <div className="flex min-h-dvh flex-col">
          <SiteHeader />
          <main className="flex-1">
            <Outlet />
          </main>
          <SiteFooter />
        </div>
        <Scripts />
      </body>
    </html>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-32 text-center">
      <h1 className="font-semibold text-2xl tracking-tight">Page not found</h1>
      <p className="mt-2 text-muted-foreground">
        That page does not exist. The{" "}
        <a href="/" className="text-primary underline underline-offset-4">
          home page
        </a>{" "}
        will point you somewhere real.
      </p>
    </div>
  );
}
