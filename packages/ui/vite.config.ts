/**
 * Present so the shadcn CLI detects a Vite project here and so the package can
 * be type-checked with the same `@/` alias the apps use.
 *
 * This package is consumed as SOURCE by the apps — there is no build step and
 * no dist. Each app's own Vite config compiles it, which is what keeps React
 * context singletons (router, query, auth) to one instance.
 */

import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
});
