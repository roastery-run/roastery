import type { Hyperdrive, KVNamespace, RateLimit } from "@cloudflare/workers-types";

export type Env = {
  /**
   * Caching-enabled Hyperdrive. Read-only, staleness-tolerant catalogue browse
   * ONLY. Never for writes or authorization reads — the query cache does not
   * participate in transactions, and a revoked credential must stop working
   * immediately rather than 60 seconds from now.
   */
  HYPERDRIVE: Hyperdrive;
  /**
   * Caching-DISABLED Hyperdrive over the same database. The default for
   * everything. Optional so local dev and tests fall back to the single
   * binding above.
   */
  HYPERDRIVE_CACHE_DISABLED?: Hyperdrive;

  ROASTERY_KV: KVNamespace;

  RPC_SUSTAINED_LIMITER?: RateLimit;
  RPC_BURST_LIMITER?: RateLimit;
  AUTH_RATE_LIMITER?: RateLimit;
  SESSION_RATE_LIMITER?: RateLimit;

  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  WEB_URL?: string;
  CONSOLE_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SSO_PROVIDER_ID?: string;
  SSO_CLIENT_ID?: string;
  SSO_CLIENT_SECRET?: string;
  SSO_DISCOVERY_URL?: string;
  SSO_SCOPES?: string;

  ENVIRONMENT?: string;
};

/**
 * Fails a production request loudly rather than silently serving it from the
 * caching Hyperdrive, where a revoked API key would keep authenticating for up
 * to the cache TTL.
 */
export function assertProductionBindings(env: Env): void {
  if (env.ENVIRONMENT !== "production") return;
  if (!env.HYPERDRIVE_CACHE_DISABLED) {
    throw new Error("HYPERDRIVE_CACHE_DISABLED is required in production");
  }
}
