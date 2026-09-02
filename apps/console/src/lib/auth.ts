import { createRoasteryAuthClient } from "@roastery/ui";

/**
 * Same-origin in development, because Vite proxies `/api/auth/*` to the API
 * worker — which keeps the session cookie first-party. A cross-origin cookie is
 * exactly what browsers now drop by default.
 */
export const authClient = createRoasteryAuthClient(import.meta.env.VITE_API_URL ?? "");
