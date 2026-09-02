/**
 * Time-limited download links for generated reports.
 *
 * Reports are served BY THE WORKER out of a private bucket, never from a
 * public one. A report is a valuation, a customer list or a traceability
 * certificate — the kind of thing that gets pasted into an email and forwarded
 * — and a public bucket URL is permanent, guessable in bulk, and impossible to
 * revoke. A signed URL that stops working is the difference between sharing a
 * document and publishing it.
 */
import { timingSafeEqual } from "../events/webhook-crypto";

export type SignedUrlClaims = {
  reportId: string;
  orgId: string;
  /** Unix seconds. */
  expiresAt: number;
};

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

/**
 * The signed material includes the ORG as well as the report.
 *
 * Without it, a token would authorize a report id and nothing else, so a leaked
 * signing key plus a guessed id would reach across tenants. With it, a token is
 * only ever valid for the organization it was minted in.
 */
function canonical(claims: SignedUrlClaims): string {
  return `${claims.orgId}.${claims.reportId}.${claims.expiresAt}`;
}

export async function signDownload(
  secret: string,
  claims: SignedUrlClaims,
): Promise<{ token: string; expiresAt: number }> {
  return { token: await sign(secret, canonical(claims)), expiresAt: claims.expiresAt };
}

export type VerifyResult =
  | { ok: true }
  /** Distinguished so the API can say "this link expired" rather than "denied". */
  | { ok: false; reason: "expired" | "invalid" };

export async function verifyDownload(
  secret: string,
  claims: SignedUrlClaims,
  token: string,
  now = Date.now(),
): Promise<VerifyResult> {
  const expected = await sign(secret, canonical(claims));
  // Signature first, then expiry. Checking expiry first would let anyone learn
  // whether a report id exists by watching which links say "expired".
  if (!timingSafeEqual(token, expected)) return { ok: false, reason: "invalid" };
  if (claims.expiresAt * 1000 <= now) return { ok: false, reason: "expired" };
  return { ok: true };
}

/** Fifteen minutes: long enough to click, short enough that a forward is useless. */
export const DEFAULT_TTL_SECONDS = 900;
export const MAX_TTL_SECONDS = 3600;
