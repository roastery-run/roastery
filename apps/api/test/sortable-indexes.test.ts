/**
 * Every column an operation says it can order by has an index behind it.
 *
 * A sort key is the one input that turns a click into a query plan. Ordering a
 * 12,000-lot tenant by an unindexed column is a sequential scan plus an
 * external sort — the slowest thing the product can do, reached by clicking a
 * table header, and invisible in development where every tenant has twelve
 * rows.
 *
 * So `sortable` is not a promise, it is a claim this checks. The index has to
 * lead with the tenant column, because every listing is org-scoped: an index on
 * `(best_before_at)` alone cannot serve `where org_id = $1 order by
 * best_before_at`, and declaring one would pass a naive check while helping
 * nothing.
 */
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
// The registry is populated by `registerRpc` as each module loads, so the app
// has to be imported for there to be anything to check.
import "../src/index";
import { RPC_REGISTRY } from "../src/lib/api/rpc";

const declared = RPC_REGISTRY.filter((def) => def.sortable);

describe("sortable columns", () => {
  it("are declared by at least one operation", () => {
    // Guards against this whole file passing vacuously if `sortable` is ever
    // renamed or the registry stops being populated.
    expect(declared.length).toBeGreaterThan(0);
  });

  it.each(declared.map((def) => [`${def.namespace}.${def.operation}`, def] as const))(
    "%s orders only by indexed columns",
    (_name, def) => {
      const sortable = def.sortable;
      if (!sortable) throw new Error("filtered above");
      const config = getTableConfig(sortable.table);
      const tenantColumn = config.columns.find((c) => c.name === "org_id")?.name;
      expect(tenantColumn, `${config.name} has no org_id to scope by`).toBeDefined();

      // The sort column has to come IMMEDIATELY after the tenant column.
      // `(org_id, status, current_weight_kg)` contains the weight but only
      // serves an ordering when status is also pinned by an equality — so
      // accepting "appears anywhere in the index" would bless a sort that
      // still scans. Strict here; add the index if the sort is wanted.
      const usable = (columnName: string) =>
        config.indexes.some((index) => {
          const names = index.config.columns.map((c) => (c as { name?: string }).name);
          return names[0] === "org_id" && names[1] === columnName;
        });

      for (const property of sortable.columns) {
        const column = config.columns.find((c) => c.name === snakeCase(property));
        expect(column, `${config.name} has no column \`${property}\``).toBeDefined();
        expect(
          usable(snakeCase(property)),
          `${config.name}.${snakeCase(property)} is declared sortable with no ` +
            "index leading (org_id, …) that includes it. Add one, or stop offering the sort.",
        ).toBe(true);
      }
    },
  );

  it("never declares a column the table does not have", () => {
    // The property name is what reaches `OrgDb.find`, so a typo here throws at
    // runtime on the first request rather than failing here.
    for (const def of declared) {
      const sortable = def.sortable;
      if (!sortable) continue;
      const config = getTableConfig(sortable.table);
      const properties = new Set(config.columns.map((c) => c.name));
      for (const property of sortable.columns) {
        expect(properties.has(snakeCase(property)), `${config.name}.${property}`).toBe(true);
      }
    }
  });
});

/** `bestBeforeAt` is the TypeScript property; `best_before_at` is the column. */
function snakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
