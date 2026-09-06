import { compare, type Decimal, subtract } from "@roastery/units";

/**
 * Whether the cached balance still agrees with the ledger under it.
 *
 * `green_lots.current_weight_kg` is a CACHE. The truth is the sum of the
 * ledger, and `applyInventoryTransaction` updates both inside one transaction
 * so they cannot diverge — in theory. In practice a divergence is the single
 * most important thing this screen can tell somebody, because every figure
 * elsewhere in the product reads the cache and none of them would notice.
 *
 * Reported, never corrected. Silently writing the ledger's figure over the
 * cache would hide the bug that caused the drift, and the bug is the thing
 * worth knowing about.
 */
export type LedgerDrift = {
  /** What the lot record says. Every other screen reads this. */
  cachedKg: Decimal;
  /** What the newest ledger entry says the balance became. */
  ledgerKg: Decimal;
  /** Cached minus ledger. Signed: positive means the cache claims more. */
  differenceKg: Decimal;
};

export function detectLedgerDrift(input: {
  cachedKg: Decimal | null | undefined;
  /** The `weightAfterKg` of the newest entry, or null when there are none. */
  newestBalanceKg: Decimal | null | undefined;
  /**
   * Whether the newest entry on screen is genuinely the newest.
   *
   * The API caps this list and cannot page it, so a truncated ledger is
   * showing the most recent entries — which is exactly the case where the
   * comparison IS valid. It stops being valid only if the list is empty.
   */
  hasEntries: boolean;
}): LedgerDrift | null {
  const cachedKg = input.cachedKg;
  if (cachedKg === null || cachedKg === undefined) return null;

  // No entries at all: the only balance a ledger with no rows can justify is
  // zero, so anything else is drift worth naming.
  if (!input.hasEntries) {
    return compare(cachedKg, "0") === 0
      ? null
      : { cachedKg, ledgerKg: "0", differenceKg: cachedKg };
  }

  const ledgerKg = input.newestBalanceKg;
  if (ledgerKg === null || ledgerKg === undefined) return null;
  if (compare(cachedKg, ledgerKg) === 0) return null;

  return { cachedKg, ledgerKg, differenceKg: subtract(cachedKg, ledgerKg) };
}
