import { defaultKeyHasher } from "@better-auth/api-key";
import { apiKeys } from "@roastery/db/schema";
import { desc, eq } from "drizzle-orm";
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
