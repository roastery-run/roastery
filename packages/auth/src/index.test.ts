import { describe, expect, it } from "vitest";
import { cookieDomain, cookiePrefix } from "./index";

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
