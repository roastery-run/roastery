/**
 * The console's own Worker, in front of its static assets.
 *
 * It exists for one reason: to serve the API on the SAME ORIGIN as the SPA.
 *
 * Cross-origin, every RPC call carried `Authorization` and `X-Roastery-Org`,
 * so none of them were simple requests and the browser preflighted each one —
 * a second full round trip before the real one, measured at 130–475ms against
 * staging, and uncacheable because the API sent no `Access-Control-Max-Age`.
 * A console screen making four calls paid eight round trips.
 *
 * Same-origin removes the preflight entirely, and the session cookie becomes
 * first-party — the same reason the Vite dev server proxies rather than
 * pointing at :8787 directly.
 *
 * The hop to the API is a SERVICE BINDING, not a fetch to its public hostname:
 * it stays inside Cloudflare, skips DNS, TLS and the public internet, and is
 * not billed as a second inbound request.
 */

type ServiceFetcher = {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

export interface Env {
  ASSETS: ServiceFetcher;
  API: ServiceFetcher;
}

/** Everything the API owns. Anything else is this SPA. */
const API_PREFIXES = ["/rpc/", "/api/", "/session/", "/stream/", "/ingest/", "/trace/"];

/** The API's signed download links, which are versioned under /reports/v1. */
const API_EXACT = /^\/reports\/v1\//;

/**
 * Filled in rather than overwritten: asset responses already carry the
 * stricter set from `public/_headers`, and replacing them would quietly
 * downgrade a policy that was deliberately written.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  // The console is authenticated product. Nothing here is for a crawler, and
  // robots.txt alone does not stop a page reached by a link.
  "x-robots-tag": "noindex, nofollow",
};

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * The shell must never be cached hard: it names the hashed bundles, so a stale
 * copy pins a returning user to a deployment that no longer exists.
 */
function withShellCacheControl(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-cache");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (API_PREFIXES.some((prefix) => pathname.startsWith(prefix)) || API_EXACT.test(pathname)) {
      // Returned untouched: the API sets its own security headers, and a
      // WebSocket upgrade must not be rebuilt on the way through.
      return env.API.fetch(request);
    }

    const response = await env.ASSETS.fetch(request);
    // Decided by content type rather than by path: only SPA routes reach this
    // Worker, but a request for a real asset can still land here.
    const isShell = response.headers.get("content-type")?.includes("text/html") ?? false;
    return withSecurityHeaders(isShell ? withShellCacheControl(response) : response);
  },
};
