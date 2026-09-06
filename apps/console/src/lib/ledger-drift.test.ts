/**
 * The check that decides whether a stock figure can be trusted.
 *
 * It has to be exact. A tolerance here would mean the product quietly accepts
 * a class of divergence, and the canonical weight carries four decimals
 * precisely so a gram is still a difference.
 */
import { describe, expect, it } from "vitest";
import { detectLedgerDrift } from "./ledger-drift";

const drift = (cachedKg: string, newestBalanceKg: string | null, hasEntries = true) =>
  detectLedgerDrift({ cachedKg, newestBalanceKg, hasEntries });

describe("detectLedgerDrift", () => {
  it("is silent when the cache matches the ledger", () => {
    expect(drift("1200.0000", "1200.0000")).toBeNull();
  });

  it("matches across differing trailing precision", () => {
    // "1200.0" and "1200.0000" are the same weight; only a string comparison
    // would call that drift, and it would cry wolf on every lot.
    expect(drift("1200.0", "1200.0000")).toBeNull();
  });

  it("reports a cache that claims more than the ledger", () => {
    expect(drift("1200.0000", "1187.5000")).toEqual({
      cachedKg: "1200.0000",
      ledgerKg: "1187.5000",
      differenceKg: "12.5000",
    });
  });

  it("reports a cache that claims less, with a negative difference", () => {
    expect(drift("1187.5000", "1200.0000")?.differenceKg).toBe("-12.5000");
  });

  it("catches a one-gram divergence, because a tolerance is a blind spot", () => {
    expect(drift("1200.0001", "1200.0000")?.differenceKg).toBe("0.0001");
  });

  describe("a ledger with no entries", () => {
    it("justifies a zero balance and nothing else", () => {
      expect(drift("0.0000", null, false)).toBeNull();
      expect(drift("0", null, false)).toBeNull();
    });

    it("cannot justify stock, so that is drift", () => {
      expect(drift("40.0000", null, false)).toEqual({
        cachedKg: "40.0000",
        ledgerKg: "0",
        differenceKg: "40.0000",
      });
    });
  });

  it("says nothing when there is nothing to compare", () => {
    expect(
      detectLedgerDrift({ cachedKg: null, newestBalanceKg: "1", hasEntries: true }),
    ).toBeNull();
    expect(
      detectLedgerDrift({ cachedKg: "1", newestBalanceKg: null, hasEntries: true }),
    ).toBeNull();
  });
});
