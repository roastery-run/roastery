import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Overridable so a second Worker on 8787 does not block console development:
// `API_PROXY_TARGET=http://localhost:8788 pnpm --filter @roastery/console dev`.
const API = process.env.API_PROXY_TARGET ?? "http://localhost:8787";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  build: {
    rollupOptions: {
      output: {
        // Split the large, rarely-changing vendors so an app change does not
        // bust the whole vendor cache. The router still code-splits per route
        // on top of this, which is what keeps the first paint small in an app
        // with nearly sixty routes.
        /**
         * Grouped by PACKAGE NAME, never by substring of the path.
         *
         * pnpm encodes peer dependencies in its directory names, so
         * `sonner@2.0.7_react-dom@19.2.0_react@19.2.0/node_modules/sonner`
         * contains the substring "react-dom". Matching the raw id therefore
         * swept sonner and several @tanstack packages into the `react` chunk —
         * which then imported the `tanstack` chunk, which imported `react`
         * back. ES modules resolve a cycle by leaving one binding undefined,
         * and the console died on load with "Cannot read properties of
         * undefined (reading 'createContext')".
         *
         * That only happens in a BUILD — dev serves unbundled modules — so it
         * shipped to staging and the page was simply blank.
         */
        manualChunks(id) {
          const pkg = /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/.exec(
            id,
          )?.[1];
          if (!pkg) return;
          if (pkg === "react" || pkg === "react-dom" || pkg === "scheduler") return "react";
          if (pkg.startsWith("@tanstack/")) return "tanstack";
          if (pkg === "radix-ui" || pkg.startsWith("@radix-ui/")) return "radix";
          if (pkg === "lucide-react") return "icons";
          if (pkg === "uplot") return "charts";
        },
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    // Proxied same-origin so the Better Auth session cookie stays first-party.
    // A cross-origin cookie is exactly what modern browsers now drop.
    proxy: {
      "/api": API,
      "/rpc": API,
      "/session": API,
      "/stream": { target: API, ws: true },
      // Only the API's signed download path, never the whole prefix: the
      // console owns /reports itself, and a bare "/reports" rule proxies its
      // own pages away to a 404 that looks like a routing bug.
      "/reports/v1": API,
      "/openapi.json": API,
    },
  },
});
