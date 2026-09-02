import type {
  DurableObjectNamespace,
  Hyperdrive,
  KVNamespace,
  Queue,
  R2Bucket,
  RateLimit,
} from "@cloudflare/workers-types";

/** Fan-out: one message per committed outbox event. */
export type EventQueueMessage = { eventId: string };
/** Delivery: one message per (endpoint, event) pair. */
export type WebhookQueueMessage = { deliveryId: string; attempt: number };

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
  /** One instance per live roast, keyed `${orgId}:${batchId}`. */
  ROAST_BATCH: DurableObjectNamespace;
  /**
   * Full-fidelity roast curves. Postgres keeps a 1 Hz downsample for querying;
   * the complete artifact lives here, fetched only when someone opens a batch.
   */
  ROASTERY_R2: R2Bucket;

  /**
   * Fan-out. Deliberately separate from delivery: an event with forty
   * subscribers is one fan-out message and forty delivery messages, and a
   * slow subscriber must not hold up the other thirty-nine.
   */
  EVENT_QUEUE?: Queue<EventQueueMessage>;
  WEBHOOK_QUEUE?: Queue<WebhookQueueMessage>;

  RPC_SUSTAINED_LIMITER?: RateLimit;
  RPC_BURST_LIMITER?: RateLimit;
  AUTH_RATE_LIMITER?: RateLimit;
  SESSION_RATE_LIMITER?: RateLimit;

  BETTER_AUTH_SECRET: string;
  /**
   * Key-encryption key for webhook signing secrets: 32 base64-encoded bytes.
   *
   * Held as a Worker secret rather than in the database, which is the entire
   * protection — a leaked dump has the ciphertext and not this.
   */
  WEBHOOK_KEK?: string;
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
  // Without it, creating a webhook endpoint would fail at the point of sealing
  // its secret. Better to refuse to start than to fail one customer at a time.
  if (!env.WEBHOOK_KEK) {
    throw new Error("WEBHOOK_KEK is required in production");
  }
}
