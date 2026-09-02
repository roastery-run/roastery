import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Better Auth's browser client.
 *
 * `baseURL` points at the API worker, which owns the whole `/api/auth/*`
 * surface. In development each app's Vite proxy forwards it same-origin so the
 * session cookie stays first-party — a cross-origin cookie is exactly what
 * modern browsers now drop.
 *
 * The client plugins must MIRROR the server's. `magicLink()` is configured on
 * the server, and without its client counterpart `signIn.magicLink` simply does
 * not exist on this object — a mismatch that shows up as a missing method
 * rather than as a helpful error.
 */
export function createRoasteryAuthClient(baseURL?: string) {
  return createAuthClient({
    baseURL: baseURL || undefined,
    plugins: [magicLinkClient()],
  });
}

export type RoasteryAuthClient = ReturnType<typeof createRoasteryAuthClient>;
