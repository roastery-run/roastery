import { configureApi, createQueryClient } from "@roastery/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ORIGINS } from "@/lib/origins";
import { routeTree } from "./routeTree.gen";
import "./index.css";

// Empty in development: Vite proxies to the API worker so the session cookie
// stays first-party.
configureApi({ baseUrl: ORIGINS.api });

const queryClient = createQueryClient();

const router = createRouter({
  routeTree,
  context: { queryClient },
  // Start a route's loader on hover or touch-down, so the data is usually in
  // cache before the click lands. With per-route code splitting this is what
  // turns "click, wait, see skeletons" into "click, see content".
  defaultPreload: "intent",
  // Do not refetch on preload if the cache is already fresh — hovering a nav
  // item should not fire a request per hover.
  defaultPreloadStaleTime: 30_000,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root is missing from index.html");

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
