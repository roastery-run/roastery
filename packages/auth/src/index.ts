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
  /** Namespaces cookies so environments sharing a domain do not collide. */
  ENVIRONMENT?: string;
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

/**
 * Whether this deployment is a genuinely local one, where secure/domain-scoped
 * cookie attributes are invalid and localhost URLs are the right fallback.
 *
 * Keyed on ENVIRONMENT, not on the URL containing "localhost". Sniffing the
 * URL made the *absence* of configuration look local: a deployed Worker whose
 * BETTER_AUTH_URL was wrong or unset took the local branch and dropped
 * `secure`, `sameSite` and the cookie prefix from every session cookie. An
 * unrecognised ENVIRONMENT is treated as deployed, so the failure is a cookie
 * that is too strict rather than one that is not protected at all.
 *
 * `apps/api/src/env.ts` makes the same judgement for its binding checks; the
 * two are deliberately independent so neither package has to import the other.
 */
const NON_PRODUCTION_ENVIRONMENTS = new Set(["development", "test"]);

export function isLocalEnvironment(env: Pick<AuthEnv, "ENVIRONMENT">): boolean {
  return NON_PRODUCTION_ENVIRONMENTS.has(env.ENVIRONMENT ?? "");
}

const isLocal = (env: AuthEnv) => isLocalEnvironment(env);

export function resolveConsoleUrl(env: AuthEnv): string {
  if (env.CONSOLE_URL) return env.CONSOLE_URL.replace(/\/$/, "");
  return isLocal(env) ? "http://localhost:5174" : "https://app.roastery.run";
}

export function resolveWebUrl(env: AuthEnv): string {
  if (env.WEB_URL) return env.WEB_URL.replace(/\/$/, "");
  return isLocal(env) ? "http://localhost:5173" : "https://roastery.run";
}

/**
 * The cookie domain that covers EVERY origin this deployment serves.
 *
 * Derived from the web URL alone, this returned `.staging.roastery.run` for a
 * staging deployment whose console is `app-staging.roastery.run` — a SIBLING,
 * not a subdomain. The session cookie was therefore never sent to the console,
 * and a successful sign-in landed straight back on the login page. Production
 * worked only by accident: its console happens to be a subdomain of its web
 * URL, so the same logic produced a domain wide enough.
 *
 * So it is the longest domain suffix shared by all three origins, not one of
 * them. Hardcoding ".roastery.run" instead would break the moment this runs on
 * a preview domain or a customer's own.
 *
 * Better Auth's docs caution against scoping to a root domain, since the
 * cookie then reaches every subdomain. That is accepted deliberately: the
 * console has to be reachable and it is a sibling host, so no narrower scope
 * exists. Two things bound the cost — every subdomain of roastery.run is ours,
 * and `cookiePrefix` namespaces the environments, so a staging session cookie
 * cannot be mistaken for a production one even though both are sent to both.
 *
 * Returns undefined for a single-label host (localhost), where a domain
 * attribute is invalid, and when the origins share no usable parent — better
 * to fall back to host-only cookies than to scope one to a public suffix.
 */
export function cookieDomain(env: AuthEnv): string | undefined {
  const hosts: string[] = [];
  for (const url of [resolveWebUrl(env), resolveConsoleUrl(env), env.BETTER_AUTH_URL]) {
    try {
      hosts.push(new URL(url).hostname.replace(/^www\./, ""));
    } catch {
      // A malformed URL narrows nothing; the remaining origins still decide.
    }
  }
  if (hosts.length === 0) return undefined;

  const labels = hosts.map((h) => h.split(".").reverse());
  const shared: string[] = [];
  for (let i = 0; i < Math.min(...labels.map((l) => l.length)); i++) {
    const label = labels[0]?.[i];
    if (!label || !labels.every((l) => l[i] === label)) break;
    shared.push(label);
  }

  // Two labels minimum: a one-label result is either "localhost" or a public
  // suffix like "com", and no browser accepts a cookie scoped to either.
  if (shared.length < 2) return undefined;
  return `.${shared.reverse().join(".")}`;
}

/**
 * Namespaces the cookies, so staging and production do not overwrite each
 * other's session in one browser.
 *
 * They share a cookie domain by construction — both are subdomains of
 * roastery.run — so without this, signing in to staging silently signs you out
 * of production and vice versa.
 */
export function cookiePrefix(env: AuthEnv): string {
  const environment = env.ENVIRONMENT?.trim();
  return environment && environment !== "production" ? `roastery-${environment}` : "roastery";
}

/**
 * The prefix Better Auth ACTUALLY writes, which is what anything sniffing the
 * cookie header must match. `createAuth` leaves the prefix at Better Auth's
 * default on localhost — there is no sibling environment to collide with, and
 * the domain-scoped attributes are invalid there — so the namespaced prefix
 * above is only the answer once deployed. Checking for `roastery.session_token`
 * locally finds nothing, and every local sign-in silently lands back on the
 * login page.
 */
export function sessionCookiePrefix(env: AuthEnv): string {
  return isLocal(env) ? "better-auth" : cookiePrefix(env);
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
          cookiePrefix: cookiePrefix(env),
          crossSubDomainCookies: { enabled: true, domain: cookieDomain(env) },
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
        // NOTE: the plugin's `deferUpdates` does not cover verification — its
        // usage claim is awaited regardless — which is why authentication
        // verifies the key itself. See `verifyApiKey` in the API's
        // lib/auth/api-keys.
      }),
      magicLink({
        expiresIn: 300,
        sendMagicLink: async ({ email, url }) => {
          if (!sendEmail) {
            // A magic link is a bearer credential and the address is personal
            // data, so the link is only ever printed where the person reading
            // the console is the person signing in. Anywhere else this is a
            // silent outage that `assertProductionBindings` refuses to boot
            // into, and writing the credential to a log aggregator on the way
            // out would make the outage a breach as well.
            if (isLocalEnvironment(env)) {
              console.log(`[dev] magic link for ${email}: ${url}`);
            } else {
              console.error(JSON.stringify({ msg: "magic_link_undeliverable" }));
            }
            return;
          }
          await sendEmail({
            to: email,
            subject: "Sign in to ROASTERY",
            text: `Sign in: ${url}\n\nThis link expires in 5 minutes.`,
            html: `<p>Sign in to ROASTERY.</p><p><a href="${url}">Sign in</a></p><p>This link expires in 5 minutes.</p>`,
          });
        },
      }),
      ...ssoPlugins(env),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
