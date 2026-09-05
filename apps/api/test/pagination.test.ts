import { TENANT_DIRECT, TENANT_VIA } from "@roastery/db/tenancy";
import { getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
// Importing the app is what registers the operations; the registry is empty
// without it.
import "../src/index";
import { RPC_REGISTRY } from "../src/lib/api/rpc";

/**
 * Which tables the keyset paginator can actually page.
 *
 * `find()` orders by `(createdAt|occurredAt, id)` and encodes the cursor from
 * the last row. A table with neither timestamp used to degrade silently:
 * ordered by id alone, cursor `null`, and a response saying `hasMore: true`
 * with nothing to follow it with — page two unreachable, no error raised.
 *
 * `sortColumn` now throws, which turns that into a loud failure the first time
 * anybody lists such a table. This test is the earlier warning: it names the
 * tables that cannot be paginated, so adding one is a decision rather than a
 * discovery.
 */

const hasTimestamp = (table: PgTable) => {
  const cols = getTableColumns(table) as Record<string, unknown>;
  return Boolean(cols.createdAt || cols.occurredAt);
};

describe("keyset pagination", () => {
  const unpageable = [
    ...Object.entries(TENANT_DIRECT).map(([name, t]) => [name, t.table] as const),
    ...Object.entries(TENANT_VIA).map(([name, t]) => [name, t.child] as const),
  ]
    .filter(([, table]) => !hasTimestamp(table as PgTable))
    .map(([name]) => name)
    .sort();

  it("names the tables that cannot be paginated", () => {
    // Not a failure — several of these are join tables and per-key balances
    // that are read by their parent rather than listed. The point is that the
    // list is visible and changing it is deliberate: give a table a timestamp
    // before building a list screen on it.
    expect(unpageable).toEqual([
      "allocations",
      "blend_components",
      "bom_lines",
      "cupping_scores",
      "cupping_session_samples",
      "landed_costs",
      "lot_location_balances",
      "org_subscriptions",
      "roast_goals",
      "roast_samples",
      "shot_rollups_hourly",
    ]);
  });

  it("has a registered list operation for none of them", () => {
    // The property that actually matters. A `list*` over one of these tables
    // would return a first page and no way to reach the second.
    const listOperations = RPC_REGISTRY.filter((d) => /^list[A-Z]/.test(d.operation)).map(
      (d) => `${d.namespace}.${d.operation}`,
    );
    expect(listOperations.length).toBeGreaterThan(10);

    // A crude but honest check: no list operation is named after one of these
    // tables. Anything subtler would be re-implementing the handler.
    const suspicious = listOperations.filter((op) =>
      unpageable.some((table) => op.toLowerCase().includes(table.replace(/_/g, ""))),
    );
    expect(suspicious).toEqual([]);
  });
});
