import { describe, expect, it } from "vitest";
import { cookieDomain, cookiePrefix, isLocalEnvironment, sessionCookiePrefix } from "./index";

/**
 * A session cookie scoped to a domain that does not cover the console is not
 * an error anywhere: the sign-in succeeds, the redirect happens, the cookie is
 * simply never sent back, and the user lands on the login page again. It cost
 * a staging deployment to find, so it is pinned here.
 */
const env = (over: Partial<Parameters<typeof cookieDomain>[0]>) => ({
  BETTER_AUTH_SECRET: "x",
  BETTER_AUTH_URL: "https://api.roastery.run",
  ...over,
});

describe("cookieDomain", () => {
  it("covers a console that is a SIBLING of the web host, not a subdomain", () => {
    // The staging layout. Derived from WEB_URL alone this was
    // ".staging.roastery.run", which never reaches app-staging.roastery.run.
    expect(
      cookieDomain(
        env({
          BETTER_AUTH_URL: "https://api-staging.roastery.run",
          WEB_URL: "https://staging.roastery.run",
          CONSOLE_URL: "https://app-staging.roastery.run",
        }),
      ),
    ).toBe(".roastery.run");
  });

  it("covers the production layout, where the console is a subdomain", () => {
    expect(
      cookieDomain(
        env({ WEB_URL: "https://roastery.run", CONSOLE_URL: "https://app.roastery.run" }),
      ),
    ).toBe(".roastery.run");
  });

  it("returns undefined for localhost, where a domain attribute is invalid", () => {
    expect(
      cookieDomain(
        env({
          BETTER_AUTH_URL: "http://localhost:8787",
          WEB_URL: "http://localhost:5173",
          CONSOLE_URL: "http://localhost:5174",
        }),
      ),
    ).toBeUndefined();
  });

  it("refuses a one-label result rather than scoping a cookie to a public suffix", () => {
    // Unrelated registrable domains share only "com". No browser accepts that,
    // and pretending otherwise would produce a cookie that silently vanishes.
    expect(
      cookieDomain(
        env({
          BETTER_AUTH_URL: "https://api.example.com",
          WEB_URL: "https://other.com",
          CONSOLE_URL: "https://app.different.com",
        }),
      ),
    ).toBeUndefined();
  });

  it("ignores a www prefix rather than narrowing to it", () => {
    expect(
      cookieDomain(
        env({ WEB_URL: "https://www.roastery.run", CONSOLE_URL: "https://app.roastery.run" }),
      ),
    ).toBe(".roastery.run");
  });
});

describe("cookiePrefix", () => {
  it("namespaces non-production, which shares a cookie domain with production", () => {
    // Both are subdomains of roastery.run, so an unprefixed staging sign-in
    // would overwrite the production session in the same browser.
    expect(cookiePrefix(env({ ENVIRONMENT: "staging" }))).toBe("roastery-staging");
    expect(cookiePrefix(env({ ENVIRONMENT: "production" }))).toBe("roastery");
    expect(cookiePrefix(env({}))).toBe("roastery");
  });
});

describe("sessionCookiePrefix", () => {
  it("is the namespaced prefix once deployed", () => {
    expect(sessionCookiePrefix(env({ ENVIRONMENT: "staging" }))).toBe("roastery-staging");
    expect(sessionCookiePrefix(env({}))).toBe("roastery");
  });

  it("is Better Auth's default in development, where createAuth sets no prefix", () => {
    // The middleware skips session resolution when no cookie by this name is
    // present. Matching the deployed prefix here meant no local session was
    // ever read, and every sign-in bounced back to the login page.
    expect(
      sessionCookiePrefix(
        env({ ENVIRONMENT: "development", BETTER_AUTH_URL: "http://localhost:8787" }),
      ),
    ).toBe("better-auth");
  });

  it("treats an unset ENVIRONMENT as deployed even when the URL looks local", () => {
    // The old check sniffed the URL for "localhost", which made a MISSING
    // BETTER_AUTH_URL look like local development and quietly dropped the
    // secure cookie attributes from a deployed Worker. Unset is deployed.
    expect(sessionCookiePrefix(env({ BETTER_AUTH_URL: "http://localhost:8787" }))).toBe("roastery");
  });
});

describe("isLocalEnvironment", () => {
  it("is true only for the two environments that are genuinely not deployed", () => {
    expect(isLocalEnvironment({ ENVIRONMENT: "development" })).toBe(true);
    expect(isLocalEnvironment({ ENVIRONMENT: "test" })).toBe(true);
    expect(isLocalEnvironment({ ENVIRONMENT: "staging" })).toBe(false);
    expect(isLocalEnvironment({ ENVIRONMENT: "production" })).toBe(false);
    // The one that matters: a config that forgot to set it.
    expect(isLocalEnvironment({})).toBe(false);
  });
});
