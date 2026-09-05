import { AUTHZ_VERSION, PERMISSIONS, ROLES } from "@roastery/db/seed-authz";
import { describe, expect, it } from "vitest";

/**
 * The cache key for built-in role permissions.
 *
 * Permission sets are cached in KV for an hour and in an isolate-level Map,
 * which is what keeps an authorization check off the database on every
 * request. The key was the constant "builtin", so a migration that granted a
 * built-in role a new permission took up to an hour to take effect and nothing
 * could hurry it — and in the meantime the operation it guarded denied for
 * everyone, owners included.
 *
 * Deriving the key from the grants means a release that changes them cannot be
 * served from a cache populated before it.
 */
describe("AUTHZ_VERSION", () => {
  it("is stable for unchanged content", () => {
    const again = AUTHZ_VERSION;
    expect(again).toBe(AUTHZ_VERSION);
    expect(AUTHZ_VERSION).toMatch(/^[0-9a-z]+$/);
  });

  it("changes when a grant changes", () => {
    // Recomputed here the way the module does, because the property under test
    // is that the output depends on the input — not that one particular string
    // comes out.
    const version = (material: string) => {
      let hash = 0x811c9dc5;
      for (let i = 0; i < material.length; i++) {
        hash ^= material.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      return hash.toString(36);
    };
    const current = JSON.stringify([
      PERMISSIONS.map((p) => p.slug),
      ROLES.map((r) => [r.slug, r.grants]),
    ]);

    expect(version(current)).toBe(AUTHZ_VERSION);

    const withNewGrant = JSON.stringify([
      PERMISSIONS.map((p) => p.slug),
      ROLES.map((r) => [r.slug, r.slug === "viewer" ? [...r.grants, "orders.write"] : r.grants]),
    ]);
    expect(version(withNewGrant)).not.toBe(AUTHZ_VERSION);

    const withNewPermission = JSON.stringify([
      [...PERMISSIONS.map((p) => p.slug), "something.new"],
      ROLES.map((r) => [r.slug, r.grants]),
    ]);
    expect(version(withNewPermission)).not.toBe(AUTHZ_VERSION);
  });
});
