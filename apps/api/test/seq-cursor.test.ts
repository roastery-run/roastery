/**
 * The ledger's cursor.
 *
 * Worth testing on its own because the failure it prevents is silent: a cursor
 * that decodes to the wrong number does not error, it returns a page starting
 * in the wrong place, and the reader has no way to tell. The handler that uses
 * it needs a database; this does not.
 */
import { describe, expect, it } from "vitest";
import { decodeSeqCursor, encodeSeqCursor } from "../src/lib/db/seq-cursor";

describe("seq cursor", () => {
  it("round-trips a sequence number", () => {
    for (const seq of [1, 2, 99, 100, 12_345, 2_147_483_647]) {
      expect(decodeSeqCursor(encodeSeqCursor(seq))).toBe(seq);
    }
  });

  it("is opaque, so nothing starts treating it as an offset", () => {
    expect(encodeSeqCursor(50)).not.toBe("50");
    expect(encodeSeqCursor(50)).not.toContain("50");
  });

  it("degrades to the first page rather than erroring", () => {
    // A stale bookmark, a truncated link in a chat message, somebody editing
    // the query string. The list is the right answer to all three.
    for (const bad of [undefined, "", "not-base64", btoa("{}"), btoa('{"s":"5"}'), btoa("[]")]) {
      expect(decodeSeqCursor(bad), String(bad)).toBeNull();
    }
  });

  it("rejects a non-integer sequence", () => {
    // `seq` is an integer column; a fractional cursor would silently skip rows
    // rather than fail, because `< 4.5` is a valid predicate.
    expect(decodeSeqCursor(btoa('{"s":4.5}'))).toBeNull();
  });
});
