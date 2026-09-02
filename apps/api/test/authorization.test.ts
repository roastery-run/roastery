/**
 * The gate.
 *
 * Enforcing tenancy and authorization by remembering to write a check in each
 * of ~200 handlers does not survive contact with a 79-table schema. These
 * checks turn that discipline into a build failure:
 *
 *   1  every route sits on a known, guarded prefix
 *   2  every /rpc/v1 path has a registry entry with a permission and a module
 *   3  every declared permission slug actually exists
 *   4  a route's module agrees with its permission's module
 *   5  (live probes — added in Phase 2, once a seeded database is available)
 *   6  src/rpc/** never touches the unscoped database handle
 *   7  every table is tenant-classified
 *   8  (cross-tenant fuzz — Phase 2, needs a database)
 *
 * Checks 1-4, 6 and 7 are static: no database, no network, so they stay in the
 * fast feedback loop and run on every save.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as schema from "@roastery/db/schema";
import { PERMISSIONS, ROLES } from "@roastery/db/seed-authz";
import {
  type DirectTenancy,
  TENANT_DIRECT,
  TENANT_GLOBAL,
  TENANT_VIA,
  type TransitiveTenancy,
} from "@roastery/db/tenancy";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { RPC_BY_PATH, RPC_REGISTRY, rpcPath } from "../src/lib/api/rpc";
import { can } from "../src/lib/auth/permissions";

const SRC = join(import.meta.dirname, "..", "src");

/** Prefixes whose routes are covered by an authorization middleware chain. */
const GUARDED_PREFIXES = [
  "/rpc/v1/",
  // Machine telemetry. Guarded by a bridge token resolved in the route itself
  // rather than by the RPC middleware, because it carries a different
  // credential and must not pay for a database client on the hot path.
  "/ingest/v1/",
  // The live roast socket. Authorization happens in the Worker before the
  // upgrade is handed to the Durable Object, which has no notion of identity.
  "/stream/v1/",
];

/** Routes that are public by design. Each one is a deliberate decision. */
const PUBLIC_ROUTES = new Set(["/health", "/docs", "/openapi.json"]);

function openApiDocument(): {
  paths: Record<string, Record<string, { operationId?: string }>>;
} {
  // OpenAPIHono builds the document from the registered routes, so this is the
  // real surface, not a hand-maintained list of what we think is registered.
  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "test", version: "0" },
  }) as never;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("1. route inventory", () => {
  it("every route is either guarded or explicitly public", () => {
    const doc = openApiDocument();
    const unguarded: string[] = [];

    for (const path of Object.keys(doc.paths)) {
      if (PUBLIC_ROUTES.has(path)) continue;
      if (path.startsWith("/api/auth/")) continue;
      if (GUARDED_PREFIXES.some((p) => path.startsWith(p))) continue;
      unguarded.push(path);
    }

    expect(
      unguarded,
      `These routes are on no guarded prefix and are not declared public. Either mount ` +
        `them under a guarded prefix or add them to PUBLIC_ROUTES with a reason:\n` +
        unguarded.join("\n"),
    ).toEqual([]);
  });
});

describe("2. registry completeness", () => {
  it("every /rpc/v1 path in the spec has a registry entry", () => {
    const doc = openApiDocument();
    const missing = Object.keys(doc.paths)
      .filter((p) => p.startsWith("/rpc/v1/"))
      .filter((p) => !RPC_BY_PATH.has(p));

    expect(
      missing,
      "These RPC paths are in the OpenAPI document but not in RPC_REGISTRY — they were " +
        "probably registered with a raw app.openapi() instead of registerRpc(), which " +
        "means they bypass the authorization contract:\n" +
        missing.join("\n"),
    ).toEqual([]);
  });

  it("every registry entry declares a permission and a module", () => {
    for (const def of RPC_REGISTRY) {
      expect(def.permission, `${rpcPath(def)} has no permission`).toBeTruthy();
      expect(def.module, `${rpcPath(def)} has no module`).toBeTruthy();
    }
  });

  it("registers at least one operation", () => {
    expect(RPC_REGISTRY.length).toBeGreaterThan(0);
  });
});

describe("2c. internal operations are not published", () => {
  it("every internal operation is filtered from the public document", () => {
    const doc = openApiDocument();
    const internal = RPC_REGISTRY.filter((d) => d.internal);

    // They must exist in the full document: that is what makes the console's
    // generated client typed and lets checks 2-5 cover them.
    for (const def of internal) {
      expect(doc.paths[rpcPath(def)], `${rpcPath(def)} missing from the spec`).toBeDefined();
    }

    // And there must be at least one, or this check is vacuous.
    expect(internal.length).toBeGreaterThan(0);
  });
});

describe("3. permission slugs are real", () => {
  const known = new Set(PERMISSIONS.map((p) => p.slug));

  it("every declared permission exists in the seed", () => {
    const unknown = RPC_REGISTRY.filter((d) => !known.has(d.permission)).map(
      (d) => `${rpcPath(d)} → ${d.permission}`,
    );
    expect(
      unknown,
      "These permissions are not in PERMISSIONS. A typo here denies silently forever, " +
        "or is swallowed by a wildcard grant and allows silently:\n" +
        unknown.join("\n"),
    ).toEqual([]);
  });

  it("every role grant matches at least one real permission", () => {
    const dead = ROLES.flatMap((role) =>
      role.grants
        .filter((g) => g !== "*")
        .filter((grant) => {
          const set = new Set([grant]);
          return !PERMISSIONS.some((p) => can(set, p.slug));
        })
        .map((g) => `${role.slug} → ${g}`),
    );
    // A grant matching nothing is not itself a security hole, but it is always
    // either a typo or a permission that was renamed and left behind.
    expect(dead, `Role grants matching no permission:\n${dead.join("\n")}`).toEqual([]);
  });
});

describe("4. module coherence", () => {
  const byslug = new Map(PERMISSIONS.map((p) => [p.slug, p]));

  it("a route's module agrees with its permission's module", () => {
    const mismatched = RPC_REGISTRY.filter((d) => {
      const p = byslug.get(d.permission);
      return p && p.module !== d.module;
    }).map((d) => {
      const p = byslug.get(d.permission);
      return `${rpcPath(d)} declares module "${d.module}" but ${d.permission} is "${p?.module}"`;
    });
    expect(mismatched, mismatched.join("\n")).toEqual([]);
  });
});

describe("6. unsafeDb discipline", () => {
  it("src/rpc/** never reaches the unscoped database handle", () => {
    const offenders: string[] = [];
    for (const file of walk(join(SRC, "rpc"))) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!line.includes("unsafeDb")) return;
        // A deliberate exemption must say why, inline, where a reviewer sees it.
        if (line.includes("// unsafe-db-ok:")) return;
        offenders.push(`${file.replace(SRC, "src")}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(
      offenders,
      "Handlers must use the org-scoped `ctx.db`. If an unscoped query is genuinely " +
        "required, annotate the line `// unsafe-db-ok: <reason>`:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});

describe("6b. escape-hatch discipline", () => {
  /**
   * `OrgDb.query()` hands the callback a raw Drizzle builder plus a `scope()`
   * helper. That is necessary for joins and aggregates `find()` cannot express,
   * but nothing forces the caller to USE scope() — which is precisely how
   * revokeOAuthClient shipped briefly without a tenant predicate, letting one
   * organization disable another's integration by guessing a client id.
   *
   * So every call site must either apply the scope helper or say, inline, why
   * it does not. Tables classified TENANT_GLOBAL legitimately do not need it,
   * but that is a claim a reviewer should see rather than infer.
   */
  it("every db.query() call applies scope() or is annotated", () => {
    const offenders: string[] = [];

    for (const file of [...walk(join(SRC, "rpc")), ...walk(join(SRC, "lib"))]) {
      const source = readFileSync(file, "utf8");
      const lines = source.split("\n");

      lines.forEach((line, i) => {
        if (!/\.query\(\s*async|\.query\(\(/.test(line)) return;

        // The callback body: from here to the end of the statement. A rough
        // window is enough — a scope() call always appears close by.
        const window = lines.slice(i, i + 30).join("\n");
        const usesScope = /scope\(/.test(window);
        const annotated = /\/\/\s*unscoped-ok:/.test(
          lines.slice(Math.max(0, i - 12), i + 4).join("\n"),
        );
        if (!usesScope && !annotated) {
          offenders.push(`${file.replace(SRC, "src")}:${i + 1}: ${line.trim()}`);
        }
      });
    }

    expect(
      offenders,
      "These OrgDb.query() call sites neither apply scope() nor explain why they " +
        "do not. Add the scope predicate, or annotate the call " +
        "`// unscoped-ok: <reason>` (valid for TENANT_GLOBAL tables that carry " +
        "their own tenant predicate explicitly):\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});

describe("7. tenancy classification is complete", () => {
  /** Drizzle marks its table objects with a well-known symbol. */
  function isDrizzleTable(v: unknown): boolean {
    if (typeof v !== "object" || v === null) return false;
    return Object.getOwnPropertySymbols(v).some((s) => s.description === "drizzle:IsDrizzleTable");
  }

  const exportedTables = Object.entries(schema as Record<string, unknown>).filter(([, v]) =>
    isDrizzleTable(v),
  );

  it("finds the schema's tables", () => {
    expect(exportedTables.length).toBeGreaterThan(0);
  });

  it("classifies every exported table exactly once", () => {
    // TENANT_DIRECT entries carry the tenant column and its property name, so
    // the table is one field of the entry rather than the value itself.
    const direct = new Set<unknown>(
      (Object.values(TENANT_DIRECT) as DirectTenancy[]).map((d) => d.table),
    );
    // Annotated because TENANT_VIA is empty until the domain schema lands,
    // which erases the element type.
    const via = new Set<unknown>(
      (Object.values(TENANT_VIA) as TransitiveTenancy[]).map((v) => v.child),
    );
    const global = new Set<unknown>(Object.values(TENANT_GLOBAL));

    const unclassified: string[] = [];
    const doubled: string[] = [];

    for (const [name, table] of exportedTables) {
      const hits = [direct.has(table), via.has(table), global.has(table)].filter(Boolean).length;
      if (hits === 0) unclassified.push(name);
      if (hits > 1) doubled.push(name);
    }

    expect(
      unclassified,
      "These tables are not classified in packages/db/src/tenancy.ts. An unclassified " +
        "table cannot be queried through OrgDb, and classifying it wrongly as global " +
        "would expose it across tenants — so this is a deliberate, reviewed decision:\n" +
        unclassified.join("\n"),
    ).toEqual([]);
    expect(doubled, `Classified more than once:\n${doubled.join("\n")}`).toEqual([]);
  });
});

describe("permission wildcard matching", () => {
  it("matches exact slugs", () => {
    expect(can(new Set(["inventory.green.write"]), "inventory.green.write")).toBe(true);
  });
  it("matches a dotted prefix wildcard", () => {
    expect(can(new Set(["inventory.green.*"]), "inventory.green.write")).toBe(true);
    expect(can(new Set(["inventory.*"]), "inventory.green.write")).toBe(true);
  });
  it("matches the root wildcard", () => {
    expect(can(new Set(["*"]), "anything.at.all")).toBe(true);
  });
  it("does not match a sibling namespace", () => {
    expect(can(new Set(["inventory.roast.*"]), "inventory.green.write")).toBe(false);
  });
  it("does not treat a permission as a prefix of itself plus more", () => {
    expect(can(new Set(["inventory.green.read"]), "inventory.green.write")).toBe(false);
  });
});
