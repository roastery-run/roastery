/**
 * Every origin this site links to, in one place.
 *
 * The marketing site links to three sibling deployments — the console, the
 * docs and the API — and each of them moves per environment. Scattered
 * `import.meta.env.VITE_X ?? "http://localhost:…"` fallbacks meant a build
 * that simply had no env silently shipped localhost links to the internet,
 * which is exactly what the first staging deploy did.
 *
 * One module, so a missing value is one thing to fix rather than nine, and so
 * a test can assert no route hardcodes an origin.
 *
 * Values come from `.env.<mode>` at BUILD time — these are baked into the
 * client bundle, so they cannot be changed by a Worker variable afterwards.
 */

const env = import.meta.env;

export const SITE = {
  /** This site. Used for canonical links, Open Graph URLs and the sitemap. */
  web: env.VITE_SITE_URL ?? "http://localhost:5173",
  console: env.VITE_CONSOLE_URL ?? "http://localhost:5174",
  docs: env.VITE_DOCS_URL ?? "http://localhost:4321",
  api: env.VITE_API_URL ?? "http://localhost:8787",
} as const;

/** An absolute URL on this site, for tags that may not be relative. */
export const canonical = (path: string): string => new URL(path, SITE.web).href;

/**
 * Only production is indexable. A staging copy of the marketing site competing
 * with production for the same queries is a self-inflicted SEO wound, and one
 * that is tedious to undo once a crawler has it.
 */
export const INDEXABLE = env.VITE_INDEXABLE === "true";
