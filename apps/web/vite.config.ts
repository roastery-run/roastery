import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The marketing site is SERVER-RENDERED, unlike the console.
 *
 * Three reasons, in order of weight:
 *
 * 1. `/trace/$code` is the QR target printed on retail bags — the most-loaded
 *    page in the system, opened on a phone in a café on a bad connection. A
 *    client-rendered version downloads a framework, boots it, THEN fetches the
 *    certificate, THEN paints. Server-rendered, it is one HTML response with
 *    the coffee already in it.
 * 2. That page is shared as a link. Open Graph tags have to be in the HTML a
 *    crawler receives; no social scraper runs your JavaScript to find them.
 * 3. The seven solution pages and pricing are the whole acquisition surface.
 *    Google will execute JS eventually; other crawlers are far less reliable,
 *    and "eventually" is not a ranking strategy.
 *
 * The console stays a client-only SPA: it is behind auth, must never be
 * indexed, and would gain nothing from a server render it cannot cache.
 */
export default defineConfig({
  plugins: [tanstackStart({ target: "cloudflare-module" }), react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/trace/v1": "http://localhost:8787" },
  },
});
