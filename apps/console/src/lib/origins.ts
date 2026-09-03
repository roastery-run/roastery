/**
 * The origins the console talks to and links at.
 *
 * Same rule as the marketing site: one module, so a build with no environment
 * cannot silently ship a localhost link, and so a test can assert nothing else
 * writes an origin.
 */
const env = import.meta.env;

export const ORIGINS = {
  /** Empty in development: the Vite proxy serves the API same-origin, which is
   *  what keeps the Better Auth session cookie first-party. */
  api: env.VITE_API_URL ?? "",
  /** The public site. The QR target printed on retail bags lives there. */
  web: env.VITE_WEB_URL ?? "http://localhost:5173",
} as const;
