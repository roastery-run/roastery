import { ApiError, EntitlementProvider, ErrorState, Toaster } from "@roastery/ui";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet, useRouter } from "@tanstack/react-router";
import { useWorkspace, WorkspaceProvider } from "@/lib/workspace";

export type RouterContext = { queryClient: QueryClient };

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  errorComponent: RootError,
  notFoundComponent: NotFound,
});

function RootComponent() {
  return (
    <WorkspaceProvider>
      <Entitlements>
        <Outlet />
        <Toaster position="bottom-right" />
      </Entitlements>
    </WorkspaceProvider>
  );
}

/**
 * Bridges the session's entitlements into the design system's gate.
 *
 * Passing `null` while the session loads is deliberate: the gate fails OPEN, so
 * a slow session shows the product rather than a locked-out shell that then
 * unlocks. The API enforces every write regardless.
 */
function Entitlements({ children }: { children: React.ReactNode }) {
  const { session } = useWorkspace();
  return (
    <EntitlementProvider value={session?.entitlements ?? null}>{children}</EntitlementProvider>
  );
}

function RootError({ error }: { error: Error }) {
  const router = useRouter();
  // A 500 carries the id the API logged it under. Surfacing it is the whole
  // difference between a support conversation that starts with a log line and
  // one that starts with "it said something went wrong".
  const correlationId = error instanceof ApiError ? error.correlationId : undefined;
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <ErrorState
        title="This screen failed to load"
        description={error.message}
        correlationId={correlationId}
        onRetry={() => router.invalidate()}
        className="max-w-lg"
      />
    </div>
  );
}

function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="space-y-2 text-center">
        <p className="font-semibold text-lg">Not found</p>
        <p className="text-muted-foreground text-sm">
          That page does not exist, or you do not have access to it.
        </p>
        <a href="/" className="text-primary text-sm underline underline-offset-4">
          Back to the dashboard
        </a>
      </div>
    </div>
  );
}
