import { OpenAPIHono } from "@hono/zod-openapi";
import { locations } from "@roastery/db/schema";
import {
  archiveLocationInput,
  archiveLocationOutput,
  createLocationInput,
  createLocationOutput,
  getLocationInput,
  getLocationOutput,
  listLocationsInput,
  listLocationsOutput,
  updateLocationInput,
  updateLocationOutput,
} from "@roastery/schemas";
import { and, eq, ilike, type SQL } from "drizzle-orm";
import { isUniqueViolation } from "../lib/db";
import { Conflict, NotFound } from "../lib/errors";
import { type RpcAppEnv, registerRpc } from "../lib/rpc";

export const catalogLocation = new OpenAPIHono<RpcAppEnv>();

type LocationRow = typeof locations.$inferSelect;

function toDto(row: LocationRow) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    kind: row.kind,
    address: row.address ?? null,
    timezone: row.timezone ?? null,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

registerRpc(
  catalogLocation,
  {
    namespace: "catalog.location",
    operation: "listLocations",
    summary: "List locations",
    description: "Roasteries, warehouses, cafés and labs belonging to the organization.",
    input: listLocationsInput,
    output: listLocationsOutput,
    permission: "catalog.location.read",
    module: "core",
    cacheable: { maxAgeSeconds: 15 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    if (input.filter?.kind) clauses.push(eq(locations.kind, input.filter.kind));
    if (input.filter?.isActive !== undefined) {
      clauses.push(eq(locations.isActive, input.filter.isActive));
    }
    if (input.filter?.q) clauses.push(ilike(locations.name, `%${input.filter.q}%`));

    const { items, page } = await ctx.db.find(locations, {
      where: clauses.length ? and(...clauses) : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return { items: items.map(toDto), page };
  },
);

registerRpc(
  catalogLocation,
  {
    namespace: "catalog.location",
    operation: "getLocation",
    summary: "Get one location",
    input: getLocationInput,
    output: getLocationOutput,
    permission: "catalog.location.read",
    module: "core",
    cacheable: { maxAgeSeconds: 15 },
  },
  async (input, ctx) => {
    const row = await ctx.db.findOne(locations, eq(locations.id, input.id));
    // A location in another tenant is already filtered out by OrgDb, so this
    // is indistinguishable from "does not exist" — which is what we want.
    if (!row) throw new NotFound("Location not found");
    return toDto(row);
  },
);

registerRpc(
  catalogLocation,
  {
    namespace: "catalog.location",
    operation: "createLocation",
    summary: "Create a location",
    input: createLocationInput,
    output: createLocationOutput,
    permission: "catalog.location.write",
    module: "core",
  },
  async (input, ctx) => {
    try {
      const [row] = await ctx.db.insert(locations, {
        name: input.name,
        code: input.code,
        kind: input.kind,
        address: input.address ?? null,
        timezone: input.timezone ?? null,
      });
      if (!row) throw new Error("Insert returned no row");
      return toDto(row);
    } catch (err) {
      // Codes are unique per organization. Losing the race on that index is a
      // 409, not a 500.
      if (isUniqueViolation(err)) {
        throw new Conflict(`A location with code "${input.code}" already exists`);
      }
      throw err;
    }
  },
);

registerRpc(
  catalogLocation,
  {
    namespace: "catalog.location",
    operation: "updateLocation",
    summary: "Update a location",
    input: updateLocationInput,
    output: updateLocationOutput,
    permission: "catalog.location.write",
    module: "core",
  },
  async (input, ctx) => {
    const { id, ...rest } = input;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) patch[k] = v;
    }
    const [row] = await ctx.db.update(locations, patch, eq(locations.id, id));
    if (!row) throw new NotFound("Location not found");
    return toDto(row);
  },
);

registerRpc(
  catalogLocation,
  {
    namespace: "catalog.location",
    operation: "archiveLocation",
    summary: "Archive a location",
    description:
      "Soft-archives the location. Rows are never deleted: inventory history " +
      "and traceability records reference locations indefinitely.",
    input: archiveLocationInput,
    output: archiveLocationOutput,
    permission: "catalog.location.write",
    module: "core",
  },
  async (input, ctx) => {
    const [row] = await ctx.db.update(
      locations,
      { isActive: false, archivedAt: new Date(), updatedAt: new Date() },
      eq(locations.id, input.id),
    );
    if (!row) throw new NotFound("Location not found");
    return toDto(row);
  },
);
