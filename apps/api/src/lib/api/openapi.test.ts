/**
 * The documented vocabulary, checked against the operations that actually exist.
 *
 * The failure this prevents is quiet: add a namespace, ship it, and its section
 * in the rendered docs is headed by the raw slug — `quality.grading` sitting
 * among prose headings — because nothing anywhere required a label for it. It
 * reads as an oversight to every integrator and to nobody on the team, since
 * the people who wrote it already know what the slug means.
 */
import { describe, expect, it } from "vitest";
import { app } from "../../index";
import { NAMESPACE_TAGS } from "./openapi";
import { RPC_REGISTRY } from "./rpc";

const declared = new Set(NAMESPACE_TAGS.map((tag) => tag.name));
const inUse = new Set(RPC_REGISTRY.map((def) => def.namespace as string));

describe("namespace tags", () => {
  it("labels every namespace that has operations", () => {
    const unlabelled = [...inUse].filter((namespace) => !declared.has(namespace)).sort();
    expect(unlabelled, "add these to NAMESPACE_TAGS in openapi.ts").toEqual([]);
  });

  it("has no entry for a namespace that no longer exists", () => {
    const stale = [...declared].filter((namespace) => !inUse.has(namespace)).sort();
    expect(stale, "remove these from NAMESPACE_TAGS in openapi.ts").toEqual([]);
  });

  it("gives each one a name a person would write", () => {
    for (const { name, displayName } of NAMESPACE_TAGS) {
      // A display name carrying the dotted slug means somebody added an entry
      // to satisfy the test above without actually naming the thing.
      expect(displayName, name).not.toContain(".");
      expect(displayName, name).not.toBe(name);
      expect(displayName[0], `${name} should start capitalized`).toBe(
        displayName[0]?.toUpperCase(),
      );
    }
  });

  it("says what each namespace is for, in a sentence", () => {
    for (const { name, description } of NAMESPACE_TAGS) {
      expect(description.length, `${name} needs a real description`).toBeGreaterThan(40);
      expect(description.trimEnd().endsWith("."), `${name} description should be a sentence`).toBe(
        true,
      );
    }
  });
});

describe("the public document", () => {
  it("publishes a tag only when it has an operation left to show", async () => {
    // A bindings object is required: the app asserts its production bindings
    // on every request, and reads ENVIRONMENT to decide whether to.
    const response = await app.request(
      "http://api.test/openapi.public.json",
      {},
      { ENVIRONMENT: "test" },
    );
    expect(response.status).toBe(200);

    const doc = (await response.json()) as {
      tags: { name: string; description: string; "x-displayName": string }[];
      paths: Record<string, unknown>;
    };

    const internalOnly = new Set(
      RPC_REGISTRY.filter((def) => def.internal).map((def) => def.namespace as string),
    );
    for (const def of RPC_REGISTRY) {
      if (!def.internal) internalOnly.delete(def.namespace as string);
    }

    // `console.*` is the whole point of the filter: every one of its operations
    // is internal, so a heading for it would introduce an empty section.
    expect(internalOnly.has("console")).toBe(true);
    expect(doc.tags.map((tag) => tag.name)).not.toContain("console");

    // Everything else keeps its label and its place in the order.
    const published = NAMESPACE_TAGS.filter((tag) => !internalOnly.has(tag.name)).map(
      (tag) => tag.name,
    );
    expect(doc.tags.map((tag) => tag.name)).toEqual(published);
    expect(doc.tags.every((tag) => tag["x-displayName"].length > 0)).toBe(true);
  });
});
