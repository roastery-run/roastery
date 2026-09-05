import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EVENT_TYPES } from "@roastery/schemas";
import { describe, expect, it } from "vitest";

/**
 * Every declared event type must actually be emitted by something.
 *
 * The enum is the published contract: an integrator picks a type from it,
 * subscribes, and waits. Seven of them were emitted by no code path at all, so
 * the wait was permanent — and indistinguishable, from outside, from a filter
 * written wrongly. There is no error to see and nothing to retry.
 *
 * A grep rather than a runtime check, because the alternative is exercising
 * every mutation in the system to find the one that never publishes. It is
 * looking for the string in an `emit({ type: ... })` call, so a type that is
 * only ever mentioned in a comment does not count as covered.
 */
const SRC = join(import.meta.dirname, "..", "src");

function sourceText(): string {
  let text = "";
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        text += readFileSync(full, "utf8");
      }
    }
  };
  walk(SRC);
  return text;
}

describe("the event contract", () => {
  it("emits every type it declares", () => {
    const code = sourceText();
    const emitted = new Set(
      [...code.matchAll(/type:\s*"([a-z_]+(?:\.[a-z_]+)+)"/g)].map((m) => m[1]),
    );
    const declaredButNeverEmitted = EVENT_TYPES.filter((type) => !emitted.has(type));

    expect(
      declaredButNeverEmitted,
      "These types are published in the contract and emitted by nothing. Either emit " +
        "them where the change happens, or remove them — an integrator subscribed to " +
        "one waits forever with nothing to debug.",
    ).toEqual([]);
  });

  it("declares every type it emits", () => {
    // The other direction: a payload published under a type nobody can
    // subscribe to reaches no endpoint, because subscriptions are matched
    // against this enum.
    const code = sourceText();
    const declared = new Set<string>(EVENT_TYPES);
    const emitted = [...code.matchAll(/type:\s*"([a-z_]+(?:\.[a-z_]+)+)"/g)].map((m) => m[1]);
    const undeclared = [...new Set(emitted)].filter((type) => type && !declared.has(type));
    expect(undeclared).toEqual([]);
  });
});
