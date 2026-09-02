import { oauthClients } from "@roastery/db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { OrgDb } from "../db/org-db";

/**
 * Issuance of `client_credentials` OAuth clients.
 *
 * Same division as API keys: @better-auth/oauth-provider owns the token
 * endpoint, signing, introspection and verification; we own issuance, because
 * its own registration endpoint authorizes through Better Auth's organization
 * plugin — a second membership and role system beside the one this app has.
 *
 * The client is bound to an organization through `referenceId`, and carries
 * its role in `metadata`, exactly as api_keys does.
 */

const CLIENT_ID_BYTES = 16;
const CLIENT_SECRET_BYTES = 32;

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Must match the plugin's `storeClientSecret` under `storeTokens: "hashed"`:
 * SHA-256, base64url, no padding.
 *
 * Reimplemented rather than imported because the plugin does not export it.
 * The guard against drift is not this comment — it is the end-to-end test that
 * mints a token through the real endpoint with a client created here. If the
 * plugin ever changes its hashing, that test fails.
 */
async function hashClientSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const bin = String.fromCharCode(...new Uint8Array(digest));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type IssuedOAuthClient = {
  id: string;
  clientId: string;
  /** The only time the secret exists in plaintext. Never stored or logged. */
  clientSecret: string;
  name: string;
  roleSlug: string;
  scopes: string[];
  createdAt: Date;
};

export async function issueOAuthClient(
  db: OrgDb,
  input: { name: string; roleSlug: string; scopes: string[] },
): Promise<IssuedOAuthClient> {
  const clientId = `rc_${randomHex(CLIENT_ID_BYTES)}`;
  const clientSecret = `rcs_${randomHex(CLIENT_SECRET_BYTES)}`;
  const now = new Date();

  // unscoped-ok: oauth_clients is TENANT_GLOBAL — the plugin resolves a client
  // by clientId before any tenant is known. Tenancy is carried on the row:
  // referenceId is set to db.orgId here, and orgScope binds every request to
  // THAT value rather than to a caller-supplied header.
  const [row] = await db.query(async (tx) =>
    tx
      .insert(oauthClients)
      .values({
        id: crypto.randomUUID(),
        clientId,
        clientSecret: await hashClientSecret(clientSecret),
        name: input.name,
        // Machine-to-machine only. No redirect flow, so no redirect URIs —
        // the column is NOT NULL, hence the empty array.
        redirectUris: [],
        grantTypes: ["client_credentials"],
        responseTypes: [],
        tokenEndpointAuthMethod: "client_secret_basic",
        // Fail-closed by the plugin's design: a client's user-delegated scopes
        // never authorize machine access, so this must be set deliberately.
        // These are OUR permission slugs, so the grant and the permissions
        // table share one vocabulary.
        clientCredentialsScopes: input.scopes,
        scopes: [],
        disabled: false,
        skipConsent: true,
        referenceId: db.orgId,
        metadata: { roleSlug: input.roleSlug },
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
  );

  if (!row) throw new Error("Failed to issue OAuth client");

  return {
    id: row.id,
    clientId,
    clientSecret,
    name: input.name,
    roleSlug: input.roleSlug,
    scopes: input.scopes,
    createdAt: now,
  };
}

/**
 * Disables a client. The row is kept so its audit trail stays joinable.
 *
 * The referenceId predicate is NOT optional. oauth_clients is tenant-global,
 * so OrgDb adds no predicate of its own here — without this, one organization
 * could revoke another's integration by guessing a client id.
 */
export async function revokeOAuthClient(db: OrgDb, clientId: string): Promise<boolean> {
  // unscoped-ok: TENANT_GLOBAL table; the referenceId predicate below is the
  // tenant check and is not optional.
  const rows = await db.query(async (tx) =>
    tx
      .update(oauthClients)
      .set({ disabled: true, updatedAt: new Date() })
      .where(and(eq(oauthClients.clientId, clientId), eq(oauthClients.referenceId, db.orgId)))
      .returning({ id: oauthClients.id }),
  );
  return rows.length > 0;
}

export async function listOAuthClients(db: OrgDb) {
  // unscoped-ok: TENANT_GLOBAL table; filtered by referenceId below.
  return db.query(async (tx) =>
    tx
      .select({
        id: oauthClients.id,
        clientId: oauthClients.clientId,
        name: oauthClients.name,
        disabled: oauthClients.disabled,
        scopes: oauthClients.clientCredentialsScopes,
        metadata: oauthClients.metadata,
        createdAt: oauthClients.createdAt,
      })
      .from(oauthClients)
      .where(eq(oauthClients.referenceId, db.orgId))
      .orderBy(desc(oauthClients.createdAt)),
  );
}
