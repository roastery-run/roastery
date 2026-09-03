import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

/**
 * The documentation site.
 *
 * Astro rather than another React SPA: this is prose. It ships almost no
 * JavaScript, which matters because the audience is an integrator reading on a
 * work laptop with forty tabs open, and because the reference pages are
 * generated — there is nothing interactive to hydrate.
 */
export default defineConfig({
  // Per environment: a staging copy that claims the production
  // canonical competes with it in search.
  site: process.env.DOCS_URL ?? "https://docs.roastery.run",
  integrations: [
    starlight({
      title: "ROASTERY",
      description: "Coffee operations API — RPC over HTTP, one surface for every client.",
      social: [],
      customCss: ["./src/styles/docs.css"],
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Introduction", link: "/" },
            { label: "Authentication", slug: "guides/authentication" },
            { label: "Conventions", slug: "guides/conventions" },
            { label: "Errors", slug: "guides/errors" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Webhooks", slug: "guides/webhooks" },
            { label: "Machine telemetry", slug: "guides/telemetry" },
          ],
        },
        {
          // Generated from the live OpenAPI document by
          // scripts/generate-reference.mjs, so it cannot describe operations
          // the API does not have.
          label: "API reference",
          // Starlight 0.39 moved autogenerate inside `items`; a group with a
          // sibling `autogenerate` is rejected outright.
          items: [{ autogenerate: { directory: "reference" } }],
        },
      ],
      editLink: { baseUrl: "https://github.com/roastery/roastery/edit/main/apps/docs/" },
      lastUpdated: true,
    }),
  ],
});
