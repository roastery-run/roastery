/**
 * The cursor, and the walk it describes.
 *
 * Keyset pagination fails silently or not at all: a wrong boundary does not
 * error, it returns a page that skips rows or repeats them, and nobody notices
 * until a count is wrong. Two things here are worth pinning.
 *
 * The cursor carries the sort key it was made under, because replaying a
 * "newest first" cursor against a sort by best-before would otherwise compare
 * a timestamp against a different timestamp and return a plausible, wrong page.
 *
 * And nulls sort last, which needs its own branch. `best_before_at` is the
 * column everybody wants to sort by and it is nullable, so the boundary
 * between the last dated row and the first undated one is the case that
 * matters rather than an edge.
 *
 * The predicate below MODELS the SQL rather than running it — there is no
 * database in this suite. It catches a mistake in the reasoning, which is the
 * risk here; it cannot catch a mistake in the SQL.
 */
import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../src/lib/db/org-db";

/** Asserts the cursor exists, so the tests below read as one assertion each. */
function cursorFor(row: Record<string, unknown>, key: string): string {
  const cursor = encodeCursor(row, key);
  if (cursor === null) throw new Error("expected a cursor for a row with an id");
  return cursor;
}

describe("cursor", () => {
  it("round-trips a value and its id", () => {
    const cursor = encodeCursor(
      { id: "a", bestBeforeAt: new Date("2026-03-01T00:00:00Z") },
      "bestBeforeAt",
    );
    expect(decodeCursor(cursor, "bestBeforeAt")).toEqual({
      k: "bestBeforeAt",
      v: "2026-03-01T00:00:00.000Z",
      id: "a",
    });
  });

  it("marks a null value rather than encoding it as a string", () => {
    const cursor = cursorFor({ id: "a", bestBeforeAt: null }, "bestBeforeAt");
    expect(decodeCursor(cursor, "bestBeforeAt")).toMatchObject({ n: true, id: "a" });
  });

  it("refuses a cursor made under a different sort", () => {
    // The failure this prevents is not an error, it is a page that looks fine.
    const cursor = cursorFor({ id: "a", createdAt: new Date() }, "createdAt");
    expect(decodeCursor(cursor, "bestBeforeAt")).toBeNull();
  });

  it("returns null for a row with no id, rather than a cursor nothing can follow", () => {
    expect(encodeCursor({ createdAt: new Date() }, "createdAt")).toBeNull();
  });

  it("survives a hand-edited cursor", () => {
    for (const bad of ["", "nonsense", btoa("{}"), btoa('{"k":"createdAt"}')]) {
      expect(decodeCursor(bad, "createdAt")).toBeNull();
    }
  });
});

/* --------------------------------------------------- the walk, as a model */

type Row = { id: string; v: string | null };

/** `ORDER BY v <dir> NULLS LAST, id <dir>` — the order the SQL declares. */
function ordered(rows: Row[], dir: "asc" | "desc"): Row[] {
  const sign = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (a.v === null && b.v === null) return a.id < b.id ? -sign : a.id > b.id ? sign : 0;
    if (a.v === null) return 1;
    if (b.v === null) return -1;
    if (a.v !== b.v) return a.v < b.v ? -sign : sign;
    return a.id < b.id ? -sign : a.id > b.id ? sign : 0;
  });
}

/** The predicate in `cursorPredicate`, expressed over the same ordering. */
function after(rows: Row[], cursor: Row | null, dir: "asc" | "desc"): Row[] {
  if (!cursor) return rows;
  const before = dir === "desc";
  if (cursor.v === null) {
    return rows.filter((r) => r.v === null && (before ? r.id < cursor.id : r.id > cursor.id));
  }
  const value = cursor.v;
  return rows.filter((r) => {
    if (r.v === null) return true;
    if (r.v !== value) return before ? r.v < value : r.v > value;
    return before ? r.id < cursor.id : r.id > cursor.id;
  });
}

function walk(rows: Row[], dir: "asc" | "desc", pageSize: number): Row[] {
  const seen: Row[] = [];
  let cursor: Row | null = null;
  for (let guard = 0; guard < 100; guard++) {
    const page = ordered(after(rows, cursor, dir), dir).slice(0, pageSize);
    if (page.length === 0) break;
    seen.push(...page);
    cursor = page[page.length - 1] ?? null;
  }
  return seen;
}

describe("the keyset walk", () => {
  // Duplicate values, nulls, and a tie that only the id breaks.
  const rows: Row[] = [
    { id: "a", v: "2026-01-01" },
    { id: "b", v: "2026-02-01" },
    { id: "c", v: "2026-02-01" },
    { id: "d", v: null },
    { id: "e", v: "2026-03-01" },
    { id: "f", v: null },
    { id: "g", v: "2026-01-01" },
  ];

  it.each([
    ["desc", 2],
    ["desc", 3],
    ["desc", 1],
    ["asc", 2],
    ["asc", 3],
  ] as const)("visits every row exactly once, %s in pages of %i", (dir, size) => {
    const seen = walk(rows, dir, size);
    expect(seen.map((r) => r.id).sort()).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    expect(new Set(seen.map((r) => r.id)).size).toBe(rows.length);
  });

  it("puts the nulls last in both directions", () => {
    for (const dir of ["asc", "desc"] as const) {
      const seen = walk(rows, dir, 3);
      const nulls = seen.map((r) => r.v === null);
      // Once the nulls start they do not stop: no dated row after an undated one.
      expect(nulls.indexOf(true) === -1 || !nulls.slice(nulls.indexOf(true)).includes(false)).toBe(
        true,
      );
    }
  });

  it("crosses the null boundary without skipping or repeating", () => {
    // A page ending exactly on the last dated row is where an off-by-one in
    // the boundary shows up, so it is worth its own case. Ties break by id in
    // the SAME direction as the sort, so `c` precedes `b` and `g` precedes `a`.
    const seen = walk(rows, "desc", 5);
    expect(seen.map((r) => r.id)).toEqual(["e", "c", "b", "g", "a", "f", "d"]);
  });
});
