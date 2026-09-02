import { OpenAPIHono } from "@hono/zod-openapi";
import { products } from "@roastery/db/schema";
import {
  createProductInput,
  getProductInput,
  listProductsInput,
  listProductsOutput,
  productSchema,
  updateProductInput,
} from "@roastery/schemas";
import { and, eq, ilike, or, type SQL } from "drizzle-orm";
import { Conflict, NotFound } from "../../lib/api/errors";
import { type RpcAppEnv, registerRpc } from "../../lib/api/rpc";
import { isUniqueViolation } from "../../lib/db/db";

export const catalogProduct = new OpenAPIHono<RpcAppEnv>();

function toDto(r: typeof products.$inferSelect) {
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    format: r.format,
    // Numerics stay strings end to end. Parsing them into JS numbers is how a
    // weight or a price silently loses precision.
    netWeightKg: r.netWeightKg ?? null,
    listPrice: r.listPrice ?? null,
    currency: r.currency ?? null,
    barcode: r.barcode ?? null,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function patch(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(input)) {
    if (k === "id" || v === undefined) continue;
    out[k] = typeof v === "number" && (k === "netWeightKg" || k === "listPrice") ? String(v) : v;
  }
  return out;
}

registerRpc(
  catalogProduct,
  {
    namespace: "catalog.product",
    operation: "listProducts",
    summary: "List products",
    input: listProductsInput,
    output: listProductsOutput,
    permission: "catalog.product.read",
    module: "core",
    cacheable: { maxAgeSeconds: 30 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    if (input.filter?.format) clauses.push(eq(products.format, input.filter.format));
    if (input.filter?.isActive !== undefined) {
      clauses.push(eq(products.isActive, input.filter.isActive));
    }
    if (input.filter?.q) {
      // Operators search by SKU as often as by name, and typing a SKU into a
      // name-only search returning nothing reads as broken.
      const q = `%${input.filter.q}%`;
      const match = or(ilike(products.name, q), ilike(products.sku, q));
      if (match) clauses.push(match);
    }

    const { items, page } = await ctx.db.find(products, {
      where: clauses.length ? and(...clauses) : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return { items: items.map(toDto), page };
  },
);

registerRpc(
  catalogProduct,
  {
    namespace: "catalog.product",
    operation: "getProduct",
    summary: "Get one product",
    input: getProductInput,
    output: productSchema,
    permission: "catalog.product.read",
    module: "core",
    cacheable: { maxAgeSeconds: 30 },
  },
  async (input, ctx) => {
    const row = await ctx.db.findOne(products, eq(products.id, input.id));
    if (!row) throw new NotFound("Product not found");
    return toDto(row);
  },
);

registerRpc(
  catalogProduct,
  {
    namespace: "catalog.product",
    operation: "createProduct",
    summary: "Create a product",
    input: createProductInput,
    output: productSchema,
    permission: "catalog.product.write",
    module: "core",
  },
  async (input, ctx) => {
    try {
      const row = await ctx.db.transaction(async (tx) => {
        const [created] = await tx.insert(products, {
          ...input,
          netWeightKg: input.netWeightKg?.toString(),
          listPrice: input.listPrice?.toString(),
        });
        if (!created) throw new Error("Insert returned no row");
        await tx.emit({
          type: "catalog.product.created",
          resourceType: "product",
          resourceId: created.id,
          payload: { id: created.id, sku: created.sku, name: created.name, format: created.format },
        });
        return created;
      });
      return toDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw new Conflict(`SKU "${input.sku}" already exists`);
      throw err;
    }
  },
);

registerRpc(
  catalogProduct,
  {
    namespace: "catalog.product",
    operation: "updateProduct",
    summary: "Update a product",
    input: updateProductInput,
    output: productSchema,
    permission: "catalog.product.write",
    module: "core",
  },
  async (input, ctx) => {
    const [row] = await ctx.db.update(products, patch(input), eq(products.id, input.id));
    if (!row) throw new NotFound("Product not found");
    return toDto(row);
  },
);
