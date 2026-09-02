import type { Env } from "../../env";

/**
 * Idempotency-Key support for mutating operations.
 *
 * An integration that retries a request after a timeout must not create a
 * second green lot or a second order. The client supplies a key; the first
 * request to use it wins and its response is replayed to every later request
 * carrying the same key.
 *
 * Stored in KV rather than Postgres: it is a short-lived, per-request cache
 * that must be checked BEFORE the handler runs, and paying a database
 * round-trip on every mutation to answer "have I seen this key" would make the
 * common case (no retry) slower to protect the rare one.
 */

const TTL_SECONDS = 24 * 60 * 60;

export type IdempotencyOutcome =
  | { status: "fresh" }
  /** Same key, same request: replay the stored response. */
  | { status: "replay"; body: unknown }
  /** Same key, DIFFERENT request: the client has a bug. */
  | { status: "conflict" }
  /** Same key, still running: a concurrent retry. */
  | { status: "in_flight" };

function key(orgId: string, operation: string, idempotencyKey: string): string {
  // Scoped by organization so two tenants cannot collide, and by operation so
  // a key reused across endpoints is a conflict rather than a wrong replay.
  return `idem:${orgId}:${operation}:${idempotencyKey}`;
}

/**
 * A fingerprint of the request body.
 *
 * Retrying with the same key but a different body is a client bug, and
 * answering it with the first response would silently drop the second write.
 * Hashed rather than stored so a large body costs a fixed 64 bytes.
 */
async function fingerprint(input: unknown): Promise<string> {
  const canonical = JSON.stringify(input ?? null);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Record_ = { state: "in_flight"; fp: string } | { state: "done"; fp: string; body: unknown };

export async function begin(
  env: Env,
  orgId: string,
  operation: string,
  idempotencyKey: string,
  input: unknown,
): Promise<IdempotencyOutcome> {
  const k = key(orgId, operation, idempotencyKey);
  const fp = await fingerprint(input);

  const existing = await env.ROASTERY_KV.get<Record_>(k, "json");
  if (existing) {
    if (existing.fp !== fp) return { status: "conflict" };
    return existing.state === "done"
      ? { status: "replay", body: existing.body }
      : { status: "in_flight" };
  }

  // Claim the key before running the handler, so two concurrent retries do not
  // both execute. KV is eventually consistent, so this narrows the window
  // rather than closing it — the durable guarantee for things that must never
  // double-apply is a unique constraint in Postgres, not this.
  await env.ROASTERY_KV.put(k, JSON.stringify({ state: "in_flight", fp } satisfies Record_), {
    expirationTtl: TTL_SECONDS,
  });
  return { status: "fresh" };
}

export async function complete(
  env: Env,
  orgId: string,
  operation: string,
  idempotencyKey: string,
  input: unknown,
  body: unknown,
): Promise<void> {
  const fp = await fingerprint(input);
  await env.ROASTERY_KV.put(
    key(orgId, operation, idempotencyKey),
    JSON.stringify({ state: "done", fp, body } satisfies Record_),
    { expirationTtl: TTL_SECONDS },
  );
}

/**
 * Releases a claimed key after a failure, so a client may retry.
 *
 * Without this a request that fails transiently would be locked out for 24
 * hours by its own in-flight marker.
 */
export async function release(
  env: Env,
  orgId: string,
  operation: string,
  idempotencyKey: string,
): Promise<void> {
  await env.ROASTERY_KV.delete(key(orgId, operation, idempotencyKey));
}
