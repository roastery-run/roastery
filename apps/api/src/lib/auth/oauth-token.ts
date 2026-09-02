import { jwks, oauthAccessTokens, oauthClients } from "@roastery/db/schema";
import { eq } from "drizzle-orm";
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import type { WorkerDb } from "../db/db";

export type OAuthClaims = {
  clientId: string;
  /** From the client's `referenceId`: the organization it was issued for. */
  orgId: string;
  roleSlug: string;
  /** Permission slugs from the grant. */
  scopes: string[];
};

/**
 * Resolves a `client_credentials` access token.
 *
 * The plugin issues two token formats and both are supported deliberately:
 *
 * - A JWT, when the client requests a `resource` (RFC 8707). The signature is
 *   checked against our own JWKS, so a forged or expired token is rejected
 *   with NO database work at all — which is the case an attacker can generate
 *   cheaply, and the one worth making cheap to refuse.
 * - An opaque token otherwise, resolved by hashed lookup.
 *
 * Either way the organization and role come from the client row rather than
 * the token. They could be baked into the JWT as custom claims, but that needs
 * a provider extension, and the lookup is a single indexed read — the same
 * cost we already accept for an API key. Reading them live also means revoking
 * a client takes effect immediately rather than at token expiry.
 */
export async function verifyOAuthToken(db: WorkerDb, token: string): Promise<OAuthClaims | null> {
  if (!token || token.startsWith("sk_")) return null;

  const resolved =
    token.split(".").length === 3 ? await resolveJwt(db, token) : await resolveOpaque(db, token);
  if (!resolved) return null;

  const [client] = await db
    .select({
      referenceId: oauthClients.referenceId,
      metadata: oauthClients.metadata,
      disabled: oauthClients.disabled,
    })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, resolved.clientId))
    .limit(1);

  // A disabled client's outstanding tokens stop working immediately. This is
  // the revocation story for a self-contained JWT, which has no session to end.
  if (!client || client.disabled || !client.referenceId) return null;

  const meta = (client.metadata ?? {}) as Record<string, unknown>;
  const roleSlug = typeof meta.roleSlug === "string" ? meta.roleSlug : null;
  // A client with no role cannot be authorized against the permissions table,
  // so it authenticates as nothing rather than getting an invented default.
  if (!roleSlug) return null;

  return {
    clientId: resolved.clientId,
    orgId: client.referenceId,
    roleSlug,
    scopes: resolved.scopes,
  };
}

/** JWKS is small and changes rarely; caching it avoids a read per request. */
let jwksCache: { keys: { keys: Record<string, unknown>[] }; at: number } | null = null;
const JWKS_TTL_MS = 5 * 60_000;

async function localJwks(db: WorkerDb) {
  if (jwksCache && Date.now() - jwksCache.at < JWKS_TTL_MS) {
    return createLocalJWKSet(jwksCache.keys as never);
  }
  const rows = await db
    .select({ id: jwks.id, publicKey: jwks.publicKey, alg: jwks.alg, crv: jwks.crv })
    .from(jwks);

  // The stored public_key is the bare JWK: no `kid`, no `alg`. The published
  // /jwks endpoint adds them from the row's id and alg columns, so a set built
  // straight from the column cannot match a token's kid and every signature
  // check fails. Reassemble the same way the endpoint does.
  const keys: Record<string, unknown>[] = [];
  for (const r of rows) {
    try {
      const jwk = JSON.parse(r.publicKey) as Record<string, unknown>;
      keys.push({ ...jwk, kid: r.id, alg: r.alg ?? "EdDSA", ...(r.crv ? { crv: r.crv } : {}) });
    } catch {
      // A malformed key row must not take down every signature check.
    }
  }
  jwksCache = { keys: { keys }, at: Date.now() };
  return createLocalJWKSet({ keys } as never);
}

async function resolveJwt(
  db: WorkerDb,
  token: string,
): Promise<{ clientId: string; scopes: string[] } | null> {
  try {
    // Reject anything not shaped like an access token before doing key work.
    const header = decodeProtectedHeader(token);
    if (!header.alg) return null;

    const { payload } = await jwtVerify(token, await localJwks(db));
    const clientId =
      typeof payload.client_id === "string"
        ? payload.client_id
        : typeof payload.sub === "string"
          ? payload.sub
          : null;
    if (!clientId) return null;
    return { clientId, scopes: parseScope(payload.scope) };
  } catch {
    // Bad signature, expired, malformed — all indistinguishable to a caller.
    return null;
  }
}

/** Matches the plugin's token storage: SHA-256, base64url, unpadded. */
async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const bin = String.fromCharCode(...new Uint8Array(digest));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function resolveOpaque(
  db: WorkerDb,
  token: string,
): Promise<{ clientId: string; scopes: string[] } | null> {
  const [row] = await db
    .select({
      clientId: oauthAccessTokens.clientId,
      scopes: oauthAccessTokens.scopes,
      expiresAt: oauthAccessTokens.expiresAt,
      revoked: oauthAccessTokens.revoked,
    })
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.token, await hashToken(token)))
    .limit(1);

  if (!row || row.revoked) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  return { clientId: row.clientId, scopes: row.scopes ?? [] };
}

function parseScope(scope: unknown): string[] {
  return typeof scope === "string" ? scope.split(/\s+/).filter(Boolean) : [];
}
