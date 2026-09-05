/**
 * The auth guard for protected routes.
 *
 * The distinction that matters: a network failure is NOT a rejected session.
 * Redirecting to /login because the API was briefly unreachable throws away
 * whatever the user is doing and, on a shop floor with patchy Wi-Fi, does it
 * several times a day. Only an explicit 401 signs someone out.
 *
 * This uses the same react-query key as WorkspaceProvider so the router guard
 * and the root component do not each fire their own /session/v1/me request.
 */
import { redirect } from "@tanstack/react-router";
import { fetchSession, SessionFetchError } from "@/lib/session";
import { clearClientState } from "@/lib/sign-out";
import type { RouterContext } from "@/routes/__root";

/**
 * Probes the non-org-scoped bootstrap, because at this point no organization
 * is known yet — that is precisely what it answers.
 */
export async function requireAuth(context: RouterContext, pathname: string): Promise<void> {
  let me: Awaited<ReturnType<typeof fetchSession>> | undefined;
  try {
    me = await context.queryClient.fetchQuery({
      queryKey: ["session.me"],
      queryFn: fetchSession,
      retry: false,
      staleTime: 60_000,
    });
  } catch (error) {
    // A 401 means "no session" and therefore redirects. Any other failure
    // (network error, 5xx) is not the user's session being rejected, so the
    // route is allowed to render and surface it as a retryable error.
    if (!(error instanceof SessionFetchError && error.status === 401)) {
      return;
    }
  }

  if (me?.user) return;
  // The session is gone server-side, so the local copies of what it could see
  // go too. An expired session on a shared terminal is the same exposure as a
  // missing sign-out button, arrived at by waiting.
  clearClientState(context.queryClient);
  throw redirect({ to: "/login", search: { next: pathname } });
}
