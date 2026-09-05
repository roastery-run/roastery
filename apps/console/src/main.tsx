import {
  buildPersistOptions,
  configureApi,
  createQueryClient,
  discardForeignCache,
} from "@roastery/ui";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
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

// Before the persister rehydrates, not after.
//
// `ensureCacheOwner` also runs once /session/v1/me resolves, but that is a
// round trip after PersistQueryClientProvider has already painted whatever was
// in localStorage — so on a shared terminal the next person saw the previous
// person's lists until the response landed. The owner is recorded on this
// device, so it can be checked without asking the server anything.
discardForeignCache();

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
    <PersistQueryClientProvider client={queryClient} persistOptions={buildPersistOptions()}>
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
  </StrictMode>,
);
