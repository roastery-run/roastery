import { OpenAPIHono } from "@hono/zod-openapi";
import { partners, producers } from "@roastery/db/schema";
import {
  createPartnerInput,
  createProducerInput,
  getPartnerInput,
  getProducerInput,
  listPartnersInput,
  listPartnersOutput,
  listProducersInput,
  listProducersOutput,
  partnerSchema,
  producerSchema,
  updatePartnerInput,
  updateProducerInput,
} from "@roastery/schemas";
import { and, eq, ilike, type SQL, sql } from "drizzle-orm";
import { isUniqueViolation } from "../lib/db";
import { Conflict, NotFound } from "../lib/errors";
import { type RpcAppEnv, registerRpc } from "../lib/rpc";

export const catalogParty = new OpenAPIHono<RpcAppEnv>();

function partnerDto(r: typeof partners.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    types: r.types,
    country: r.country ?? null,
    defaultCurrency: r.defaultCurrency ?? null,
    paymentTermsDays: r.paymentTermsDays ?? null,
    contactEmail: r.contactEmail ?? null,
    contactPhone: r.contactPhone ?? null,
    website: r.website ?? null,
    notes: r.notes ?? null,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function producerDto(r: typeof producers.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    kind: r.kind,
    partnerId: r.partnerId ?? null,
    country: r.country ?? null,
    region: r.region ?? null,
    subregion: r.subregion ?? null,
    altitudeMinM: r.altitudeMinM ?? null,
    altitudeMaxM: r.altitudeMaxM ?? null,
    latitude: r.latitude ?? null,
    longitude: r.longitude ?? null,
    varieties: r.varieties ?? [],
    processMethods: r.processMethods ?? [],
    farmSizeHa: r.farmSizeHa ?? null,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Drops undefined values so a partial update never nulls an untouched field. */
function patch(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(input)) {
    if (k !== "id" && v !== undefined) out[k] = v;
  }
  return out;
}

/* --------------------------------------------------------------- partners */

registerRpc(
  catalogParty,
  {
    namespace: "catalog.party",
    operation: "listPartners",
    summary: "List trading partners",
    description:
      "Suppliers, importers, exporters, cooperatives and customers. A partner may be " +
      "several of these at once, so `types` is a list.",
    input: listPartnersInput,
    output: listPartnersOutput,
    permission: "catalog.party.read",
    module: "core",
    cacheable: { maxAgeSeconds: 30 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    if (input.filter?.isActive !== undefined) {
      clauses.push(eq(partners.isActive, input.filter.isActive));
    }
    if (input.filter?.country) clauses.push(eq(partners.country, input.filter.country));
    // Array containment, so a partner typed both importer and exporter matches
    // a search for either.
    if (input.filter?.type) {
      clauses.push(sql`${partners.types} @> ARRAY[${input.filter.type}]::partner_type[]`);
    }
    if (input.filter?.q) clauses.push(ilike(partners.name, `%${input.filter.q}%`));

    const { items, page } = await ctx.db.find(partners, {
      where: clauses.length ? and(...clauses) : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return { items: items.map(partnerDto), page };
  },
);

registerRpc(
  catalogParty,
  {
    namespace: "catalog.party",
    operation: "getPartner",
    summary: "Get one trading partner",
    input: getPartnerInput,
    output: partnerSchema,
    permission: "catalog.party.read",
    module: "core",
    cacheable: { maxAgeSeconds: 30 },
  },
  async (input, ctx) => {
    const row = await ctx.db.findOne(partners, eq(partners.id, input.id));
    if (!row) throw new NotFound("Partner not found");
    return partnerDto(row);
  },
);

registerRpc(
  catalogParty,
  {
    namespace: "catalog.party",
    operation: "createPartner",
    summary: "Create a trading partner",
    input: createPartnerInput,
    output: partnerSchema,
    permission: "catalog.party.write",
    module: "core",
  },
  async (input, ctx) => {
    try {
      const [row] = await ctx.db.insert(partners, { ...input });
      if (!row) throw new Error("Insert returned no row");
      return partnerDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw new Conflict(`Partner code "${input.code}" already exists`);
      throw err;
    }
  },
);

registerRpc(
  catalogParty,
  {
    namespace: "catalog.party",
    operation: "updatePartner",
    summary: "Update a trading partner",
    input: updatePartnerInput,
    output: partnerSchema,
    permission: "catalog.party.write",
    module: "core",
  },
  async (input, ctx) => {
    const [row] = await ctx.db.update(partners, patch(input), eq(partners.id, input.id));
    if (!row) throw new NotFound("Partner not found");
    return partnerDto(row);
  },
);

/* -------------------------------------------------------------- producers */

registerRpc(
  catalogParty,
  {
    namespace: "catalog.party",
    operation: "listProducers",
    summary: "List producers",
    description:
      "Farms, cooperatives and washing stations. Distinct from a partner because " +
      "traceability follows where coffee was grown, not who sold it — the same farm's " +
      "coffee can arrive through different importers in different years.",
    input: listProducersInput,
    output: listProducersOutput,
    permission: "catalog.party.read",
    module: "core",
    cacheable: { maxAgeSeconds: 30 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    if (input.filter?.kind) clauses.push(eq(producers.kind, input.filter.kind));
    if (input.filter?.country) clauses.push(eq(producers.country, input.filter.country));
    if (input.filter?.partnerId) clauses.push(eq(producers.partnerId, input.filter.partnerId));
    if (input.filter?.q) clauses.push(ilike(producers.name, `%${input.filter.q}%`));

    const { items, page } = await ctx.db.find(producers, {
      where: clauses.length ? and(...clauses) : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return { items: items.map(producerDto), page };
  },
);

registerRpc(
  catalogParty,
  {
    namespace: "catalog.party",
    operation: "getProducer",
    summary: "Get one producer",
    input: getProducerInput,
    output: producerSchema,
    permission: "catalog.party.read",
    module: "core",
    cacheable: { maxAgeSeconds: 30 },
  },
  async (input, ctx) => {
    const row = await ctx.db.findOne(producers, eq(producers.id, input.id));
    if (!row) throw new NotFound("Producer not found");
    return producerDto(row);
  },
);

registerRpc(
  catalogParty,
  {
    namespace: "catalog.party",
    operation: "createProducer",
    summary: "Create a producer",
    input: createProducerInput,
    output: producerSchema,
    permission: "catalog.party.write",
    module: "core",
  },
  async (input, ctx) => {
    try {
      const [row] = await ctx.db.insert(producers, {
        ...input,
        // Numerics cross the wire as numbers but are stored exactly; Drizzle
        // takes them as strings so no float ever touches the value.
        latitude: input.latitude?.toString(),
        longitude: input.longitude?.toString(),
        farmSizeHa: input.farmSizeHa?.toString(),
        varieties: input.varieties ?? [],
        processMethods: input.processMethods ?? [],
      });
      if (!row) throw new Error("Insert returned no row");
      return producerDto(row);
    } catch (err) {
      if (isUniqueViolation(err))
        throw new Conflict(`Producer code "${input.code}" already exists`);
      throw err;
    }
  },
);

registerRpc(
  catalogParty,
  {
    namespace: "catalog.party",
    operation: "updateProducer",
    summary: "Update a producer",
    input: updateProducerInput,
    output: producerSchema,
    permission: "catalog.party.write",
    module: "core",
  },
  async (input, ctx) => {
    const values = patch(input);
    for (const k of ["latitude", "longitude", "farmSizeHa"]) {
      if (typeof values[k] === "number") values[k] = String(values[k]);
    }
    const [row] = await ctx.db.update(producers, values, eq(producers.id, input.id));
    if (!row) throw new NotFound("Producer not found");
    return producerDto(row);
  },
);
