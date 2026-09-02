import { createAuthClient } from "better-auth/react";

/**
 * Better Auth's browser client.
 *
 * `baseURL` points at the API worker, which owns the whole `/api/auth/*`
 * surface. In development each app's Vite proxy forwards it same-origin so the
 * session cookie stays first-party — a cross-origin cookie is exactly what
 * modern browsers now drop.
 */
export function createRoasteryAuthClient(baseURL?: string) {
  return createAuthClient({ baseURL: baseURL || undefined });
}

export type RoasteryAuthClient = ReturnType<typeof createRoasteryAuthClient>;
