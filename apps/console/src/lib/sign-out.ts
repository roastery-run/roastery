/**
 * Ending a session, completely.
 *
 * There was no way to sign out at all. On a shared shop-floor terminal — the
 * exact scenario the persisted query cache is scoped for, and the reason
 * password auth is disabled — that left a seven-day session and a day of
 * cached orders, customers and inventory belonging to whoever last used the
 * machine, with no affordance to end either.
 *
 * Everything a person could still see afterwards has to go, so this clears in
 * three places: the server session, the persisted cache in localStorage, and
 * the workspace selection that decides which organization the next request
 * carries.
 *
 * It finishes with a full page load rather than a router navigation. React
 * state, in-flight queries and any component still holding a rendered list all
 * die with the document, which is a guarantee no amount of cache clearing
 * gives on its own.
 */
// The subpath, not the barrel: the barrel is the whole design system, and
// importing it here would pull every component into the auth guard's path.
import { clearPersistedQueryCache } from "@roastery/ui/query-cache";
import type { QueryClient } from "@tanstack/react-query";
import { clearWorkspaceSelection } from "@/lib/workspace-storage";

/**
 * Everything held on this device. Separate from `signOut` because the auth
 * guard calls it too: a 401 means the session is already gone server-side, and
 * the local copies have to follow it.
 */
export function clearClientState(queryClient?: QueryClient): void {
  clearPersistedQueryCache();
  clearWorkspaceSelection();
  queryClient?.clear();
}

export async function signOut(queryClient?: QueryClient): Promise<void> {
  try {
    // Imported here rather than at module scope so the auth client is not
    // pulled into the shell's bundle — and so the clearing above stays
    // testable without a DOM, since the client touches `document` on import.
    const { authClient } = await import("@/lib/auth");
    await authClient.signOut();
  } finally {
    // In `finally`: if revoking the session fails — offline, API down — the
    // local data still has to go. Leaving it visible because the network was
    // unavailable is the failure this exists to prevent.
    clearClientState(queryClient);
    window.location.assign("/login");
  }
}
