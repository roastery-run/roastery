/**
 * The auth guard for protected routes.
 *
 * The distinction that matters: a network failure is NOT a rejected session.
 * Redirecting to /login because the API was briefly unreachable throws away
 * whatever the user was doing and, on a shop floor with patchy Wi-Fi, does it
 * several times a day. Only an explicit 401 signs someone out.
 */
import { redirect } from "@tanstack/react-router";

/**
 * Probes the non-org-scoped bootstrap, because at this point no organization
 * is known yet — that is precisely what it answers.
 */
export async function requireAuth(pathname: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_API_URL ?? ""}/session/v1/me`, {
      credentials: "include",
    });
  } catch {
    // A network failure is NOT a rejected session. Redirecting to /login
    // because the API was briefly unreachable throws away whatever the user
    // was doing — and on a shop floor with patchy Wi-Fi, several times a day.
    return;
  }

  if (response.ok) {
    const body = (await response.json().catch(() => null)) as { user?: unknown } | null;
    if (body?.user) return;
  } else if (response.status !== 401) {
    // A 500 is the API's problem, not the user's. Let the route render and
    // surface it as an error the user can retry.
    return;
  }

  throw redirect({ to: "/login", search: { next: pathname } });
}
