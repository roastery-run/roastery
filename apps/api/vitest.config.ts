import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // The app re-exports its Durable Object, which extends a base class only
      // the Workers runtime provides. The tests that import the app do so to
      // read its route registry, never to run a DO, so a structural stub keeps
      // them in a plain Node environment — which is what makes them fast
      // enough to run on every save.
      "cloudflare:workers": new URL("./test/stubs/cloudflare-workers.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
  },
});
