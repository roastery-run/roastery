import { defaultKeyHasher } from "@better-auth/api-key";
import { apiKeys } from "@roastery/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import type { WorkerDb } from "../db/db";
import type { OrgDb } from "../db/org-db";

/**
 * Key issuance and revocation.
 *
 * @better-auth/api-key owns verification — hash comparison, expiry,
 * enable/disable, rate limiting and refill — but its management endpoints
 * reach into Better Auth's organization plugin to authorize organization-owned
 * keys. We already have an organization model, a roles table and a permissions
 * table, so adopting theirs would mean maintaining two of each.
 *
 * Issuing keys here avoids that entirely. We hash with the plugin's own
 * exported `defaultKeyHasher`, so a key minted by this module verifies through
 * the plugin exactly as one minted by its endpoint would.
 */

const PREFIX = "sk_";

/**
 * Per-key rate limit defaults.
 *
 * These MUST be set explicitly. The plugin applies its configured defaults in
 * its own create endpoint, which we deliberately bypass — so a row inserted
 * here with null limits has rate limiting silently inert, even with
 * `rateLimitEnabled = true`. Verified: without these, requestCount never
 * increments.
 *
 * 300 per 60s is the documented 5 req/s sustained budget. The Worker also
 * limits per credential at the edge; this is the ceiling that travels with the
 * key itself.
 */
const DEFAULT_RATE_LIMIT_MAX = 300;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
/** 32 bytes of entropy, hex-encoded. */
const KEY_BYTES = 32;
/** Characters kept in plaintext so a key is identifiable in the UI. */
const START_LENGTH = 10;

export type IssuedKey = {
  id: string;
  /** The only time the raw key exists. It is never stored or logged. */
  key: string;
  name: string;
  start: string;
  roleSlug: string;
  scopes: string[] | null;
  expiresAt: Date | null;
  createdAt: Date;
};

export type KeyMetadata = {
  roleSlug: string;
  /** null = no down-scoping; [] = explicitly inert. */
  scopes: string[] | null;
  createdBy: string | null;
};

function generateKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${PREFIX}${hex}`;
}

export async function issueApiKey(
  db: OrgDb,
  input: {
    name: string;
    roleSlug: string;
    scopes?: string[] | null;
    expiresAt?: Date | null;
    /** Per-key ceiling. Independent of the Worker's per-credential limits. */
    rateLimitMax?: number | null;
    rateLimitTimeWindowMs?: number | null;
  },
): Promise<IssuedKey> {
  const raw = generateKey();
  const hashed = await defaultKeyHasher(raw);

  const metadata: KeyMetadata = {
    roleSlug: input.roleSlug,
    scopes: input.scopes ?? null,
    createdBy: db.actor.userId,
  };

  const [row] = await db.insert(apiKeys, {
    id: crypto.randomUUID(),
    configId: "default",
    name: input.name,
    prefix: PREFIX,
    start: raw.slice(0, START_LENGTH),
    key: hashed,
    enabled: true,
    expiresAt: input.expiresAt ?? null,
    rateLimitEnabled: true,
    rateLimitMax: input.rateLimitMax ?? DEFAULT_RATE_LIMIT_MAX,
    rateLimitTimeWindow: input.rateLimitTimeWindowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
    requestCount: 0,
    // The plugin stores metadata as a JSON string.
    metadata: JSON.stringify(metadata),
  });

  if (!row) throw new Error("Failed to issue API key");

  return {
    id: row.id,
    key: raw,
    name: row.name ?? input.name,
    start: row.start ?? "",
    roleSlug: input.roleSlug,
    scopes: input.scopes ?? null,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

/**
 * Disables a key without deleting it.
 *
 * The row is kept so the audit trail of what a credential did survives its
 * revocation — deleting it would orphan every audit event that references it.
 */
export async function revokeApiKey(db: OrgDb, id: string): Promise<boolean> {
  // By id alone: re-revoking is idempotent, and OrgDb has already constrained
  // the statement to this tenant.
  const rows = await db.update(
    apiKeys,
    { enabled: false, updatedAt: new Date() },
    eq(apiKeys.id, id),
  );
  return rows.length > 0;
}

export async function listApiKeys(db: OrgDb) {
  return db.query(async (tx, scope) =>
    tx
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        start: apiKeys.start,
        enabled: apiKeys.enabled,
        expiresAt: apiKeys.expiresAt,
        lastRequest: apiKeys.lastRequest,
        requestCount: apiKeys.requestCount,
        metadata: apiKeys.metadata,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(scope(apiKeys))
      .orderBy(desc(apiKeys.createdAt)),
  );
}

/* ------------------------------------------------------------ verification */

export type VerifiedApiKey = {
  id: string;
  referenceId: string;
  metadata: KeyMetadata;
};

/**
 * Verifies a key in ONE query.
 *
 * The plugin's `verifyApiKey` issued four statements per request: the lookup,
 * a rate-limit counter update, an `updatedAt` bump, and a sweep of expired
 * keys. Measured against staging that was 450ms of a 600ms request — not
 * because any of it is slow, but because each statement is a round trip to a
 * database in another region, and only the first one answers a question the
 * request needs answered.
 *
 * Verifying here rather than through the plugin is symmetric with `issueApiKey`
 * above, which already writes the row directly using the plugin's own hasher.
 * The security-relevant behaviour is unchanged and deliberately still
 * synchronous, on the caching-DISABLED handle: a revoked or expired key stops
 * working on the next request, not a cache TTL later.
 *
 * What moved:
 *
 *  - The per-key rate limit is gone, because it duplicated the Worker's
 *    `RPC_SUSTAINED_LIMITER` exactly — same 300-per-60s budget, keyed on the
 *    same credential — while costing a database write per request to enforce.
 *    The binding is the authoritative limit; see `clientKey` in api/rate-limit.
 *  - `lastRequest` and `requestCount` are stamped AFTER the response, by the
 *    caller passing `recordUse`. They exist so a person can see when a
 *    credential was last used, which does not need to be true to the
 *    millisecond and never needed to block a request.
 *  - Sweeping expired keys belongs to the daily cron, not to every caller.
 */
export async function verifyApiKey(db: WorkerDb, raw: string): Promise<VerifiedApiKey | null> {
  const hashed = await defaultKeyHasher(raw);

  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.key, hashed)).limit(1);
  if (!row || !row.enabled) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;

  // A key with no organization cannot be scoped to one, so it authenticates as
  // nothing rather than as everything.
  if (!row.referenceId) return null;

  const metadata = parseMetadata(row.metadata);
  if (!metadata) return null;

  return { id: row.id, referenceId: row.referenceId, metadata };
}

/** The plugin stores metadata as a JSON string; `issueApiKey` writes it the same way. */
function parseMetadata(value: unknown): KeyMetadata | null {
  const raw = typeof value === "string" ? safeJson(value) : value;
  if (!raw || typeof raw !== "object") return null;
  const meta = raw as Partial<KeyMetadata>;
  // No role means no permissions can be resolved. Failing closed is the point:
  // the alternative is inventing a default nobody deliberately granted.
  if (typeof meta.roleSlug !== "string" || !meta.roleSlug) return null;
  return {
    roleSlug: meta.roleSlug,
    scopes: Array.isArray(meta.scopes) ? meta.scopes : null,
    createdBy: typeof meta.createdBy === "string" ? meta.createdBy : null,
  };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Stamps usage. Fire-and-forget by design — see `verifyApiKey`.
 *
 * Errors are swallowed: failing to record that a key was used must never fail
 * the request that used it.
 */
export function recordApiKeyUse(db: WorkerDb, id: string): Promise<void> {
  return db
    .update(apiKeys)
    .set({ lastRequest: new Date(), requestCount: sql`${apiKeys.requestCount} + 1` })
    .where(eq(apiKeys.id, id))
    .then(
      () => undefined,
      () => undefined,
    );
}
