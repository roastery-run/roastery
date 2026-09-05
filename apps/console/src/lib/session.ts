/**
 * The session fetch shared by the route guard and the workspace provider.
 *
 * Both need to know "who is the current user", but only the router guard
 * redirects on a missing session. Sharing one react-query key means a page
 * load fires a single /session/v1/me request instead of two.
 */
import { ORIGINS } from "./origins";

export type Membership = {
  orgId: string;
  orgName: string;
  orgSlug: string;
  roleSlug: string;
};

export type Me = {
  user: { id: string; name: string | null; email: string } | null;
  memberships: Membership[];
};

export class SessionFetchError extends Error {
  constructor(readonly status: number) {
    super(`session ${status}`);
  }
}

export async function fetchSession(): Promise<Me> {
  const response = await fetch(`${ORIGINS.api}/session/v1/me`, {
    credentials: "include",
  });
  if (response.ok) return (await response.json()) as Me;
  throw new SessionFetchError(response.status);
}

export const sessionQueryOptions = {
  queryKey: ["session.me"] as const,
  queryFn: fetchSession,
  retry: false,
  staleTime: 60_000,
} as const;
