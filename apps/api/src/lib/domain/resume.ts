/**
 * Which sequence a telemetry bridge must replay.
 *
 * Extracted from the Durable Object so it can be tested without the Workers
 * runtime, because this is where a subtle and expensive bug lived.
 *
 * THE BUG, recorded so it is not reintroduced: the DO originally tracked a
 * single high-water mark and rejected any `seq <= lastSeq` as a duplicate.
 * A replay, by definition, carries an OLDER sequence than the newest one
 * received — so every replayed batch was refused, and an uplink outage left a
 * permanent hole in the curve. The acknowledgement said "ok", the bridge
 * believed it had repaired the run, and the roast was quietly incomplete.
 *
 * A high-water mark cannot express "I have everything except 680 to 694",
 * which is exactly the state an outage leaves. Reporting the FIRST MISSING
 * sequence can, and it also tells the bridge to send precisely what is absent
 * rather than everything since the gap.
 */

/** The lowest sequence not yet received, or null when the run is contiguous. */
export function firstMissingSeq(received: Iterable<number>): number | null {
  const sorted = [...received].sort((a, b) => a - b);
  if (!sorted.length) return null;

  let expected = sorted[0] as number;
  for (const seq of sorted) {
    // Duplicates are not holes.
    if (seq < expected) continue;
    if (seq !== expected) return expected;
    expected += 1;
  }
  return null;
}
