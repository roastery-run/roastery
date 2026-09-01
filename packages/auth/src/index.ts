import { apiKey } from "@better-auth/api-key";
import { oauthProvider } from "@better-auth/oauth-provider";
import * as schema from "@roastery/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { magicLink } from "better-auth/plugins/magic-link";
import type { WorkerDb } from "./types";

export type { WorkerDb } from "./types";

export type AuthEnv = {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  WEB_URL?: string;
  CONSOLE_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Enterprise OIDC / SSO — the INBOUND direction (we are the client). */
  SSO_PROVIDER_ID?: string;
  SSO_CLIENT_ID?: string;
  SSO_CLIENT_SECRET?: string;
  SSO_DISCOVERY_URL?: string;
  SSO_SCOPES?: string;
};

export type EmailSender = (params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}) => Promise<void>;

const isLocal = (env: AuthEnv) => env.BETTER_AUTH_URL.includes("localhost");

export function resolveConsoleUrl(env: AuthEnv): string {
  if (env.CONSOLE_URL) return env.CONSOLE_URL.replace(/\/$/, "");
  return isLocal(env) ? "http://localhost:5174" : "https://app.roastery.io";
}

export function resolveWebUrl(env: AuthEnv): string {
  if (env.WEB_URL) return env.WEB_URL.replace(/\/$/, "");
  return isLocal(env) ? "http://localhost:5173" : "https://roastery.io";
}

function socialProviders(env: AuthEnv) {
  const providers: Record<string, { clientId: string; clientSecret: string }> = {};
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    providers.github = {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    };
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    };
  }
  return providers;
}

/**
 * Enterprise SSO. `generic-oauth` is the INBOUND direction: it makes Roastery
 * an OAuth *client* of the customer's Okta / Entra / Keycloak. It is unrelated
 * to the machine-token surface, which is the outbound direction and is served
 * by @better-auth/oauth-provider (see apps/api).
 */
function ssoPlugins(env: AuthEnv) {
  if (!env.SSO_CLIENT_ID || !env.SSO_CLIENT_SECRET || !env.SSO_DISCOVERY_URL) return [];
  return [
    genericOAuth({
      config: [
        {
          providerId: env.SSO_PROVIDER_ID?.trim() || "sso",
          clientId: env.SSO_CLIENT_ID,
          clientSecret: env.SSO_CLIENT_SECRET,
          discoveryUrl: env.SSO_DISCOVERY_URL,
          scopes: (env.SSO_SCOPES ?? "openid email profile").split(/\s+/).filter(Boolean),
        },
      ],
    }),
  ];
}

/**
 * Built per request, not once per module: the Drizzle client is request-scoped
 * because each Worker invocation opens its own Hyperdrive connection.
 */
export function createAuth(db: WorkerDb, env: AuthEnv, sendEmail?: EmailSender) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      // Explicit mapping: our table names are plural, Better Auth's defaults
      // are singular.
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
        jwks: schema.jwks,
        // The plugin's model is `apikey`; our table is `api_keys`. The adapter
        // resolves fields by PROPERTY name, so the property names on the
        // Drizzle table must match the plugin's field names exactly.
        apikey: schema.apiKeys,
        oauthClient: schema.oauthClients,
        oauthResource: schema.oauthResources,
        oauthClientResource: schema.oauthClientResources,
        oauthAccessToken: schema.oauthAccessTokens,
        oauthRefreshToken: schema.oauthRefreshTokens,
        oauthConsent: schema.oauthConsents,
        oauthClientAssertion: schema.oauthClientAssertions,
      },
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    // Passwordless only. A roastery's shared floor terminal is exactly where a
    // reused password ends up on a sticky note.
    emailAndPassword: { enabled: false },
    socialProviders: socialProviders(env),
    account: { accountLinking: { trustedProviders: ["github", "google"] } },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 15,
      // Session reads happen on every SPA navigation; the cookie cache keeps
      // that off the database.
      cookieCache: { enabled: true, maxAge: 60 },
    },
    rateLimit: {
      enabled: true,
      storage: "memory",
      window: 60,
      max: 60,
      customRules: { "/sign-in/magic-link": { window: 300, max: 3 } },
    },
    // Without this Better Auth cannot determine a client IP on Workers and
    // falls back to ONE shared bucket per path — meaning a single abusive
    // caller rate-limits every other tenant. cf-connecting-ip is set by
    // Cloudflare and cannot be spoofed by the client.
    trustedOrigins: [resolveWebUrl(env), resolveConsoleUrl(env)],
    advanced: isLocal(env)
      ? { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } }
      : {
          ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
          crossSubDomainCookies: { enabled: true, domain: ".roastery.io" },
          defaultCookieAttributes: { secure: true, sameSite: "lax" },
        },
    plugins: [
      // Required for JWT-mode OAuth access tokens, which is what makes machine
      // token validation stateless (no database round-trip per API request).
      jwt(),
      /**
       * API keys.
       *
       * Adopted for the credential primitive: generation, SHA-256 hashing,
       * expiry, enable/disable, and — the reason it earns its place —
       * per-key rate limiting and refill quotas, which metered API access
       * needs and which we would otherwise have to build.
       *
       * We do NOT use its management endpoints. Those support organization
       * ownership by calling into Better Auth's organization plugin, which
       * would mean a second membership table and a second role system beside
       * the ones this app already owns. Creation and revocation live in our
       * own `console.credentials.*` operations instead, which hash with the
       * plugin's exported `defaultKeyHasher` so its verification still
       * matches. Verification itself has no such coupling.
       *
       * Its `permissions` field is likewise unused: our authorization
       * vocabulary is the permissions table, and a second one would be a
       * second source of truth. Role and scopes travel in `metadata`.
       */
      /**
       * OAuth 2.0 provider — the machine-authentication surface.
       *
       * `client_credentials` issues tokens to service integrations, which is
       * how an ERP, a webstore or a roasting bridge talks to this API. In JWT
       * mode validation is stateless, so a token check costs no database
       * round-trip; that is what makes the documented request budget
       * affordable at the edge.
       *
       * The grant is fail-closed by design: a client's user-delegated `scope`
       * never authorizes machine access, and `clientCredentialsScopes` must be
       * assigned deliberately. We set those to our own permission slugs, so
       * the OAuth grant and the permissions table speak one vocabulary rather
       * than two.
       *
       * A client_credentials JWT has no session to end, so a short lifetime is
       * the only revocation control — hence one hour. Re-minting costs a
       * machine client a single request.
       */
      oauthProvider({
        // Required by the plugin even when only client_credentials is used:
        // they are where the browser authorization-code flow sends a user.
        loginPage: `${resolveConsoleUrl(env)}/login`,
        consentPage: `${resolveConsoleUrl(env)}/oauth/consent`,
        m2mAccessTokenExpiresIn: 3600,
        accessTokenExpiresIn: 3600,
        storeTokens: "hashed",
        // Minting is a database read plus a constant-time compare, and it is
        // the one endpoint an attacker will hammer.
        rateLimit: { token: { window: 60, max: 20 } },
      }),
      apiKey({
        defaultPrefix: "sk_",
        // 5 req/s sustained, matching the documented API budget. The Worker
        // also rate-limits per credential; this is the per-key ceiling that
        // survives independently of edge limits.
        rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 300 },
      }),
      magicLink({
        expiresIn: 300,
        sendMagicLink: async ({ email, url }) => {
          if (!sendEmail) {
            console.log(`[dev] magic link for ${email}: ${url}`);
            return;
          }
          await sendEmail({
            to: email,
            subject: "Sign in to Roastery",
            text: `Sign in: ${url}\n\nThis link expires in 5 minutes.`,
            html: `<p>Sign in to Roastery.</p><p><a href="${url}">Sign in</a></p><p>This link expires in 5 minutes.</p>`,
          });
        },
      }),
      ...ssoPlugins(env),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
