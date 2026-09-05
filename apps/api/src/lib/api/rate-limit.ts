import type { RateLimit } from "@cloudflare/workers-types";
import type { Context, Next } from "hono";
import type { Env } from "../../env";

/**
 * In-memory fallback for local dev and tests, where the native binding is
 * absent. Per-isolate and therefore not authoritative — it exists so the code
 * path is exercised, not to enforce anything in production.
 */
const local = new Map<string, { count: number; resetAt: number }>();

function localLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = local.get(key);
  if (!entry || entry.resetAt < now) {
    local.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

/**
 * The bucket a request counts against.
 *
 * Keying on the credential is right, and the reason still holds: several
 * roasters behind one shop-floor NAT must not share a budget, and one leaked
 * key must not exhaust everyone else's.
 *
 * But the limiter runs BEFORE authentication — deliberately, so that verifying
 * a credential is itself rate-limited — and it used to key on the raw
 * Authorization header. An unverified attacker-chosen string therefore chose
 * its own bucket: rotate 32 random characters per request and every request is
 * the first in a fresh window, on every credentialed surface at once.
 *
 * So an UNVERIFIED credential falls back to the caller's IP, which they cannot
 * choose. Once `authMiddleware` has verified one it records the actor id here,
 * and subsequent middleware in the same chain keys on that — the honest
 * per-credential budget, available only to a credential that turned out to be
 * real. `cf-connecting-ip` is set by Cloudflare and cannot be spoofed.
 */
export function clientKey(c: Context<{ Bindings: Env }>): string {
  const actorId = c.get("rateLimitActor" as never) as string | undefined;
  if (actorId) return `cred:${actorId}`;
  return `ip:${c.req.header("cf-connecting-ip") ?? "unknown"}`;
}

export function rateLimit(
  binding: keyof Pick<
    Env,
    | "RPC_SUSTAINED_LIMITER"
    | "RPC_BURST_LIMITER"
    | "INGEST_LIMITER"
    | "AUTH_RATE_LIMITER"
    | "SESSION_RATE_LIMITER"
    | "REPORTS_LIMITER"
    | "STREAM_LIMITER"
  >,
  fallback: { limit: number; windowMs: number },
) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const key = clientKey(c);
    const limiter = c.env[binding] as RateLimit | undefined;

    const allowed = limiter
      ? (await limiter.limit({ key })).success
      : localLimit(`${binding}:${key}`, fallback.limit, fallback.windowMs);

    if (!allowed) {
      const retryAfter = Math.ceil(fallback.windowMs / 1000);
      return c.json({ error: "Rate limited", code: "rate_limited" }, 429, {
        "Retry-After": String(retryAfter),
        "RateLimit-Limit": String(fallback.limit),
        "RateLimit-Reset": String(retryAfter),
      });
    }
    await next();
    return undefined;
  };
}
