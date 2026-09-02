/**
 * The navigation is data, and wrong data fails quietly.
 *
 * A permission slug with a typo does not error — `can()` simply returns false,
 * and the item disappears for everyone including an owner. A module key that
 * is not a real `ModuleKey` makes the entitlement lookup `undefined`, which
 * reads as "not locked" and shows a section the plan does not include.
 *
 * Both are invisible in review and obvious in production, which is exactly the
 * kind of thing a test should catch instead.
 */

import { PERMISSIONS } from "@roastery/db/seed-authz";
import { moduleKeySchema } from "@roastery/schemas";
import { describe, expect, it } from "vitest";
import { NAV, sectionForPath } from "./nav";

const KNOWN_PERMISSIONS = new Set(PERMISSIONS.map((p) => p.slug));
const KNOWN_MODULES = new Set(moduleKeySchema.options);

describe("navigation", () => {
  it("names only real entitlement modules", () => {
    const unknown = NAV.filter((section) => !KNOWN_MODULES.has(section.module));
    expect(
      unknown.map((s) => `${s.id} -> ${s.module}`),
      "An unknown module key makes the entitlement lookup undefined, which reads " +
        "as 'not locked' and shows a section the plan does not include.",
    ).toEqual([]);
  });

  it("names only real permission slugs", () => {
    const unknown = NAV.flatMap((section) =>
      section.children
        .filter((child) => child.permission && !KNOWN_PERMISSIONS.has(child.permission))
        .map((child) => `${section.id}: ${child.label} -> ${child.permission}`),
    );
    expect(
      unknown,
      "A permission slug that does not exist is not an error — can() just returns " +
        "false and the item vanishes for everyone, owners included.",
    ).toEqual([]);
  });

  it("has no duplicate destinations", () => {
    // Two items pointing at the same path means one of them can never be the
    // active one, and the rail highlights the wrong section.
    const paths = NAV.flatMap((section) => section.children.map((child) => child.to));
    expect(paths).toEqual([...new Set(paths)]);
  });

  it("resolves a path to its section, longest prefix first", () => {
    expect(sectionForPath("/")?.id).toBe("dashboard");
    expect(sectionForPath("/inventory")?.id).toBe("inventory");
    expect(sectionForPath("/inventory/blends")?.id).toBe("inventory");
    // /roasting/schedule must not resolve to a shorter, unrelated prefix.
    expect(sectionForPath("/roasting/schedule")?.id).toBe("roasting");
  });

  it("does not resolve an unrelated path to a section", () => {
    expect(sectionForPath("/nonexistent")).toBeUndefined();
  });

  it("keeps the dashboard first and settings last", () => {
    // Not cosmetic: the rail is a fixed spatial memory for people who use this
    // all day, and reordering it silently is worse than not having it.
    expect(NAV[0]?.id).toBe("dashboard");
    expect(NAV.at(-1)?.id).toBe("settings");
  });
});
