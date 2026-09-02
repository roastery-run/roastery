import { describe, expect, it } from "vitest";
import { firstMissingSeq } from "./resume";

/**
 * Regression tests for the resume protocol.
 *
 * The original implementation tracked only a high-water mark, which cannot
 * represent a hole — so replays were rejected as duplicates and an uplink
 * outage silently left the roast curve incomplete. These cases are the shapes
 * that broke it.
 */
describe("firstMissingSeq", () => {
  it("reports nothing missing for a contiguous run", () => {
    expect(firstMissingSeq([1, 2, 3, 4, 5])).toBeNull();
  });

  it("reports the hole an outage leaves, not the high-water mark", () => {
    // Everything except 4 and 5. A high-water mark would say "I have 8",
    // which is true and useless.
    expect(firstMissingSeq([1, 2, 3, 6, 7, 8])).toBe(4);
  });

  it("walks forward as each hole is filled", () => {
    const received = new Set([1, 2, 3, 6, 7, 8]);
    expect(firstMissingSeq(received)).toBe(4);
    received.add(4);
    // Filling one hole must reveal the next, or a multi-batch outage is only
    // ever half repaired.
    expect(firstMissingSeq(received)).toBe(5);
    received.add(5);
    expect(firstMissingSeq(received)).toBeNull();
  });

  it("is unaffected by replays arriving out of order", () => {
    expect(firstMissingSeq([8, 3, 1, 7, 2, 6])).toBe(4);
  });

  it("treats a duplicate as received, not as a hole", () => {
    expect(firstMissingSeq([1, 2, 2, 3])).toBeNull();
  });

  it("handles an empty run", () => {
    expect(firstMissingSeq([])).toBeNull();
  });

  it("does not assume sequences start at one", () => {
    // A DO adopted mid-roast starts wherever the bridge had reached.
    expect(firstMissingSeq([100, 101, 103])).toBe(102);
    expect(firstMissingSeq([100, 101, 102])).toBeNull();
  });
});
