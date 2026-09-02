import { createQueryClient } from "@roastery/ui";
import type { QueryClient } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

/**
 * Built per request on the server and once in the browser.
 *
 * A module-level singleton would be a cross-request cache on the server —
 * every visitor would see whatever the previous one loaded, which for a page
 * that renders a specific customer's coffee certificate is a data leak, not a
 * performance win.
 */
export function getRouter() {
  const queryClient: QueryClient = createQueryClient();

  return createTanStackRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    // Server-rendered HTML already contains the content, so a pending state
    // never flashes on first paint.
    defaultPendingMs: 0,
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
