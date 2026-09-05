import type {
  AnalyticsEngineDataset,
  DurableObjectNamespace,
  Hyperdrive,
  KVNamespace,
  Queue,
  R2Bucket,
  RateLimit,
} from "@cloudflare/workers-types";

/** Espresso shots, batched off the request path. */
export type ShotQueueMessage = {
  orgId: string;
  siteId: string;
  machineId: string;
  shots: unknown[];
};

/** One report to render, off the request path. */
export type ReportQueueMessage = { reportId: string; orgId: string };

/**
 * Scheduled work, one message per organization.
 *
 * Cron decides what work exists and enqueues it; the work itself runs here,
 * with its own connection and its own retry. A scheduled handler has one
 * request's CPU budget and its failures are silent, so anything that loops
 * over every tenant inline eventually times out on the one tenant large
 * enough to matter — and nobody finds out.
 */
export type MaintenanceQueueMessage =
  | { job: "reconcile"; orgId: string }
  | { job: "export"; orgId: string; exportId: string }
  | { job: "purge"; orgId: string }
  | { job: "retention"; orgId: string }
  /** Not scoped to a tenant: expired sessions, and old shot partitions. */
  | { job: "retention-global"; orgId: null };

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
   * One instance per café SITE, keyed `${orgId}:${siteId}`.
   *
   * Per site, not per machine: sites number in the tens, machines in the
   * thousands, and only a site has somebody standing in front of it.
   */
  CAFE_SITE: DurableObjectNamespace;
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
  SHOT_QUEUE?: Queue<ShotQueueMessage>;
  REPORT_QUEUE?: Queue<ReportQueueMessage>;
  WEBHOOK_QUEUE?: Queue<WebhookQueueMessage>;
  MAINTENANCE_QUEUE?: Queue<MaintenanceQueueMessage>;

  /**
   * Browser Rendering, for report PDFs. Optional: without it reports render as
   * HTML, so the pipeline is exercised in local development and CI rather than
   * only in production.
   */
  BROWSER?: import("@cloudflare/puppeteer").BrowserWorker;

  /**
   * Operational counters: dead letters, 5xx, failed scheduled jobs. Optional,
   * because local development and tests run without it — `recordMetric` is a
   * no-op when it is absent.
   */
  OPS_METRICS?: AnalyticsEngineDataset;

  RPC_SUSTAINED_LIMITER?: RateLimit;
  RPC_BURST_LIMITER?: RateLimit;
  /** Machine telemetry. Its own namespace, so a busy bar cannot starve the API. */
  INGEST_LIMITER?: RateLimit;
  AUTH_RATE_LIMITER?: RateLimit;
  SESSION_RATE_LIMITER?: RateLimit;
  /** Signed report downloads. Its own namespace: sharing the auth limiter let
   * a burst of downloads lock an office out of sign-in. */
  REPORTS_LIMITER?: RateLimit;
  /** WebSocket upgrades, which cost auth plus three queries each. */
  STREAM_LIMITER?: RateLimit;

  /**
   * Transactional mail: one HTTPS POST to a provider that accepts
   * `{from, to, subject, html, text}` with a bearer token. Deliberately not a
   * vendor SDK — that would put a provider in the middle of sign-in.
   *
   * Absent in development, where mail is logged instead.
   */
  /**
   * Cloudflare Email Sending. Present when the Worker declares `send_email`
   * and the sending domain is enabled; absent in local development, where
   * mail is logged instead.
   */
  EMAIL?: SendEmail;
  EMAIL_API_URL?: string;
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;

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

  /**
   * Where operational alerts go: dead letters, error-rate spikes, scheduled
   * work that failed. Deliberately not a customer address — these are our
   * failures, and `cron/alerts.ts` is the one that writes to tenants.
   *
   * All three are optional so that a deployment without them simply does not
   * alert, rather than failing every five minutes trying.
   */
  /**
   * Gates `/health?deep=1`, which discloses the database name, schema and
   * table count and opens a connection per call. The uptime monitor holds it.
   */
  HEALTH_TOKEN?: string;
  OPS_ALERT_EMAIL?: string;
  CF_ACCOUNT_ID?: string;
  /** Reads the Analytics Engine dataset back; the binding only writes. */
  CF_ANALYTICS_TOKEN?: string;
};

/**
 * Environments where a missing production binding is expected rather than a
 * fault: local development and the test runner.
 *
 * The check is a deny-list, not an allow-list, because the failure it guards
 * against is a config that forgets to set ENVIRONMENT at all. Keyed on
 * `=== "production"`, that omission silently disabled every check below — the
 * Worker would boot onto the CACHING Hyperdrive, where a revoked API key keeps
 * authenticating for the cache TTL, and log sign-in links instead of mailing
 * them. Unset now means production, which fails loudly on a misconfigured
 * deploy and cannot fail open.
 *
 * `packages/auth` makes the same judgement for cookie attributes; the two are
 * deliberately independent so neither package has to import the other.
 */
const NON_PRODUCTION = new Set(["development", "test"]);

export function isProduction(env: { ENVIRONMENT?: string }): boolean {
  return !NON_PRODUCTION.has(env.ENVIRONMENT ?? "");
}

/**
 * Fails a production request loudly rather than silently serving it from the
 * caching Hyperdrive, where a revoked API key would keep authenticating for up
 * to the cache TTL.
 */
export function assertProductionBindings(env: Env): void {
  if (!isProduction(env)) return;
  if (!env.HYPERDRIVE_CACHE_DISABLED) {
    throw new Error("HYPERDRIVE_CACHE_DISABLED is required in production");
  }
  // Without it, creating a webhook endpoint would fail at the point of sealing
  // its secret. Better to refuse to start than to fail one customer at a time.
  if (!env.WEBHOOK_KEK) {
    throw new Error("WEBHOOK_KEK is required in production");
  }
  // Without a way to send, sign-in links are written to the log instead — a
  // very quiet outage, since every other part of the flow reports success.
  // Either path will do: the Cloudflare binding, or an HTTPS provider.
  const canSend = Boolean(env.EMAIL) || Boolean(env.EMAIL_API_URL && env.EMAIL_API_KEY);
  if (!canSend || !env.EMAIL_FROM) {
    throw new Error(
      "Production needs a way to send mail: either the send_email binding or " +
        "EMAIL_API_URL + EMAIL_API_KEY, and EMAIL_FROM in both cases",
    );
  }
}
