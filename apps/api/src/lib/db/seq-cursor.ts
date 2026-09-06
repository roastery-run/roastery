/**
 * Keyset pagination on a per-subject sequence number.
 *
 * A deliberate deviation from the `(created_at, id)` cursor every other list
 * uses, and the reason is the ledger's own ordering rule: `occurredAt` can be
 * backdated and `seq` cannot, so the inventory ledger is ordered by `seq` and
 * paginating it on a timestamp would hand back pages in an order the screen
 * does not display. A cursor has to key on the column the query sorts by, or
 * the boundary between page one and page two is not where the reader saw it.
 *
 * `seq` alone is enough of a key: it is monotonic per subject and carries a
 * unique index on `(subject, seq)`, which is the same guarantee `(created_at,
 * id)` is constructed to provide elsewhere.
 *
 * Opaque on the wire like every other cursor here, so a client cannot start
 * treating it as an offset and nothing outside this file depends on its shape.
 */
type SeqPayload = { s: number };

export function encodeSeqCursor(seq: number): string {
  return btoa(JSON.stringify({ s: seq } satisfies SeqPayload));
}

/**
 * Returns null for absent, malformed or hand-edited cursors.
 *
 * A stale bookmark degrades to the first page rather than to an error, which is
 * the same choice `tableSearchSchema` makes on the client for the same reason:
 * somebody following a link should see the list.
 */
export function decodeSeqCursor(cursor: string | undefined): number | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(atob(cursor)) as SeqPayload;
    return Number.isInteger(parsed.s) ? parsed.s : null;
  } catch {
    return null;
  }
}
