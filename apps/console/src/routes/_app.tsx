import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { requireAuth } from "@/lib/require-auth";

/**
 * The authenticated layout. Everything below it is inside the shell and behind
 * the guard, so no individual screen has to remember either.
 */
export const Route = createFileRoute("/_app")({
  beforeLoad: ({ location }) => requireAuth(location.pathname),
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
