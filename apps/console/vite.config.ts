import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react-dom") || id.includes("/react/") || id.includes("scheduler")) {
            return "react";
          }
          if (id.includes("@tanstack")) return "tanstack";
          if (id.includes("radix-ui") || id.includes("@radix-ui")) return "radix";
          if (id.includes("uplot")) return "charts";
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
      "/api": "http://localhost:8787",
      "/rpc": "http://localhost:8787",
      "/session": "http://localhost:8787",
      "/stream": { target: "http://localhost:8787", ws: true },
      // Only the API's signed download path, never the whole prefix: the
      // console owns /reports itself, and a bare "/reports" rule proxies its
      // own pages away to a 404 that looks like a routing bug.
      "/reports/v1": "http://localhost:8787",
      "/openapi.json": "http://localhost:8787",
    },
  },
});
