/**
 * Café sites and bar equipment.
 *
 * Shots live in ./shots.ts; POS reconciliation in ./pos.ts. This file is only
 * the catalogue — the things that change monthly rather than every 28 seconds.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { cafeMachines, cafeSites } from "@roastery/db/schema";
import {
  cafeMachineSchema,
  cafeSiteSchema,
  createSiteInput,
  listCafeMachinesInput,
  listCafeMachinesOutput,
  listSitesInput,
  listSitesOutput,
  registerCafeMachineInput,
} from "@roastery/schemas";
import { and, eq, type SQL } from "drizzle-orm";
import { Conflict } from "../../lib/api/errors";
import { type RpcAppEnv, registerRpc } from "../../lib/api/rpc";
import { isUniqueViolation } from "../../lib/db/db";

export const cafeSitesRoutes = new OpenAPIHono<RpcAppEnv>();

function siteDto(s: typeof cafeSites.$inferSelect) {
  return {
    id: s.id,
    name: s.name,
    code: s.code,
    locationId: s.locationId ?? null,
    timezone: s.timezone ?? null,
    isActive: s.isActive,
    createdAt: s.createdAt.toISOString(),
  };
}

function machineDto(m: typeof cafeMachines.$inferSelect) {
  return {
    id: m.id,
    siteId: m.siteId,
    name: m.name,
    code: m.code,
    kind: m.kind,
    groupCount: m.groupCount ?? null,
    brand: m.brand ?? null,
    model: m.model ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

registerRpc(
  cafeSitesRoutes,
  {
    namespace: "cafe",
    operation: "listSites",
    summary: "List café sites",
    input: listSitesInput,
    output: listSitesOutput,
    permission: "cafe.read",
    module: "cafe",
    cacheable: { maxAgeSeconds: 60 },
  },
  async (input, ctx) => {
    const { items, page } = await ctx.db.find(cafeSites, {
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return { items: items.map(siteDto), page };
  },
);

registerRpc(
  cafeSitesRoutes,
  {
    namespace: "cafe",
    operation: "createSite",
    summary: "Create a café site",
    description:
      "A site is the unit that has somebody standing in it, which is why live views " +
      "and anomaly detection are scoped here rather than to a machine.",
    input: createSiteInput,
    output: cafeSiteSchema,
    permission: "cafe.write",
    module: "cafe",
  },
  async (input, ctx) => {
    try {
      const row = await ctx.db.transaction(async (tx) => {
        const [created] = await tx.insert(cafeSites, {
          name: input.name,
          code: input.code,
          locationId: input.locationId ?? null,
          timezone: input.timezone ?? null,
        });
        if (!created) throw new Error("Insert returned no row");
        await tx.emit({
          type: "cafe.site.created",
          resourceType: "cafe_site",
          resourceId: created.id,
          payload: { id: created.id, name: created.name, code: created.code },
        });
        return created;
      });
      return siteDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw new Conflict(`Site code "${input.code}" already exists`);
      throw err;
    }
  },
);

registerRpc(
  cafeSitesRoutes,
  {
    namespace: "cafe",
    operation: "listMachines",
    summary: "List bar equipment",
    input: listCafeMachinesInput,
    output: listCafeMachinesOutput,
    permission: "cafe.read",
    module: "cafe",
    cacheable: { maxAgeSeconds: 60 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    if (input.filter?.siteId) clauses.push(eq(cafeMachines.siteId, input.filter.siteId));
    if (input.filter?.kind) clauses.push(eq(cafeMachines.kind, input.filter.kind));
    const { items, page } = await ctx.db.find(cafeMachines, {
      where: clauses.length ? and(...clauses) : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return { items: items.map(machineDto), page };
  },
);

registerRpc(
  cafeSitesRoutes,
  {
    namespace: "cafe",
    operation: "registerMachine",
    summary: "Register bar equipment",
    description:
      "`groupCount` matters: every group head is judged separately, because one failing " +
      "group on a three-group machine is the most common real fault and a machine-level " +
      "average hides it behind two groups that are fine.",
    input: registerCafeMachineInput,
    output: cafeMachineSchema,
    permission: "cafe.write",
    module: "cafe",
  },
  async (input, ctx) => {
    try {
      const row = await ctx.db.transaction(async (tx) => {
        const [created] = await tx.insert(cafeMachines, { ...input });
        if (!created) throw new Error("Insert returned no row");
        await tx.emit({
          type: "cafe.machine.registered",
          resourceType: "cafe_machine",
          resourceId: created.id,
          payload: {
            id: created.id,
            siteId: created.siteId,
            code: created.code,
            kind: created.kind,
          },
        });
        return created;
      });
      return machineDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw new Conflict(`Machine code "${input.code}" already exists`);
      throw err;
    }
  },
);
