/**
 * The dev server proxies some prefixes to the Worker. A prefix that is broader
 * than the API path it exists for silently swallows the console's own routes.
 *
 * This is not hypothetical: `"/reports"` was proxied for the sake of
 * `/reports/v1/:id`, and every page in the console's Reports section answered
 * with the API's 404 envelope from the day it was built. Nothing caught it —
 * nav.test.ts asserts a destination exists in the route tree, which it did,
 * and the route simply never got the chance to render.
 *
 * So the rule is: a proxy prefix may not be a prefix of any console route.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const here = import.meta.dirname;

/** Proxy keys, read as text: importing the config would need the Vite plugins. */
function proxyPrefixes(): string[] {
  const config = readFileSync(join(here, "..", "vite.config.ts"), "utf8");
  const block = config.match(/proxy:\s*\{([\s\S]*?)\n {4}\}/);
  if (!block?.[1]) throw new Error("Could not find the proxy block in vite.config.ts");
  return [...block[1].matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1] ?? "");
}

function routePaths(): string[] {
  const generated = readFileSync(join(here, "routeTree.gen.ts"), "utf8");
  return [...generated.matchAll(/fullPath: '([^']+)'/g)].map(
    (match) => (match[1] ?? "").replace(/\/$/, "") || "/",
  );
}

describe("dev proxy", () => {
  it("does not shadow any console route", () => {
    const prefixes = proxyPrefixes();
    const shadowed = routePaths().flatMap((route) =>
      prefixes
        // A route is shadowed when the proxy claims it outright or claims
        // everything beneath a segment it shares.
        .filter((prefix) => route === prefix || route.startsWith(`${prefix}/`))
        .map((prefix) => `${prefix} shadows ${route}`),
    );

    expect(
      shadowed,
      `The dev proxy forwards routes the console owns to the API, which answers\n` +
        `with its own 404 envelope:\n${shadowed.join("\n")}\n\n` +
        `Narrow the prefix to the exact API path it exists for.`,
    ).toEqual([]);
  });

  it("proxies every prefix the API actually serves under a version segment", () => {
    // Every API surface is versioned (/rpc/v1, /reports/v1, /ingest/v1). A
    // proxy key without one is a prefix claim over a whole namespace, which is
    // how the bug above happened.
    const shared = proxyPrefixes().filter((prefix) => prefix.startsWith("/reports"));
    expect(
      shared,
      "The console owns /reports; only its versioned API path may be proxied.",
    ).toEqual(["/reports/v1"]);
  });
});
