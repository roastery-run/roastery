import { OpenAPIHono } from "@hono/zod-openapi";
import { billsOfMaterials, bomLines, materials } from "@roastery/db/schema";
import {
  adjustMaterialInput,
  bomSchema,
  createMaterialInput,
  explodeRequirementsInput,
  explodeRequirementsOutput,
  getBomInput,
  getMaterialInput,
  listMaterialsInput,
  listMaterialsOutput,
  materialSchema,
  setBomInput,
} from "@roastery/schemas";
import { and, asc, eq, ilike, or, type SQL, sql } from "drizzle-orm";
import { isUniqueViolation } from "../lib/db";
import { BadRequest, Conflict, NotFound } from "../lib/errors";
import { kg } from "../lib/inventory";
import { applyMaterialTransaction, explodeRequirements } from "../lib/materials";
import { type RpcAppEnv, registerRpc } from "../lib/rpc";

export const inventoryMaterial = new OpenAPIHono<RpcAppEnv>();

function toDto(r: typeof materials.$inferSelect) {
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    kind: r.kind,
    onHandQty: r.onHandQty,
    reorderPoint: r.reorderPoint ?? null,
    reorderQty: r.reorderQty ?? null,
    leadTimeDays: r.leadTimeDays ?? null,
    // A material with no reorder point can never "need" reordering; treating
    // unset as zero would flag every unmanaged item forever.
    needsReorder: r.reorderPoint !== null && kg.cmp(r.onHandQty, r.reorderPoint) <= 0,
    unitCost: r.unitCost ?? null,
    currency: r.currency ?? null,
    supplierPartnerId: r.supplierPartnerId ?? null,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

registerRpc(
  inventoryMaterial,
  {
    namespace: "inventory.material",
    operation: "listMaterials",
    summary: "List packaging and other non-coffee materials",
    description:
      "Bags, labels, valves, boxes and merchandise. Running out of these stops production " +
      "just as effectively as running out of coffee.",
    input: listMaterialsInput,
    output: listMaterialsOutput,
    permission: "inventory.material.read",
    module: "resource_planning",
    cacheable: { maxAgeSeconds: 30 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    const f = input.filter;
    if (f?.kind) clauses.push(eq(materials.kind, f.kind));
    if (f?.isActive !== undefined) clauses.push(eq(materials.isActive, f.isActive));
    if (f?.needsReorder) {
      clauses.push(
        sql`${materials.reorderPoint} is not null and ${materials.onHandQty} <= ${materials.reorderPoint}`,
      );
    }
    if (f?.q) {
      const q = `%${f.q}%`;
      const match = or(ilike(materials.name, q), ilike(materials.sku, q));
      if (match) clauses.push(match);
    }
    const { items, page } = await ctx.db.find(materials, {
      where: clauses.length ? and(...clauses) : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return { items: items.map(toDto), page };
  },
);

registerRpc(
  inventoryMaterial,
  {
    namespace: "inventory.material",
    operation: "getMaterial",
    summary: "Get one material",
    input: getMaterialInput,
    output: materialSchema,
    permission: "inventory.material.read",
    module: "resource_planning",
    cacheable: { maxAgeSeconds: 30 },
  },
  async (input, ctx) => {
    const row = await ctx.db.findOne(materials, eq(materials.id, input.id));
    if (!row) throw new NotFound("Material not found");
    return toDto(row);
  },
);

registerRpc(
  inventoryMaterial,
  {
    namespace: "inventory.material",
    operation: "createMaterial",
    summary: "Create a material",
    input: createMaterialInput,
    output: materialSchema,
    permission: "inventory.material.write",
    module: "resource_planning",
  },
  async (input, ctx) => {
    try {
      const [row] = await ctx.db.insert(materials, { ...input });
      if (!row) throw new Error("Insert returned no row");
      return toDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw new Conflict(`Material SKU "${input.sku}" already exists`);
      throw err;
    }
  },
);

registerRpc(
  inventoryMaterial,
  {
    namespace: "inventory.material",
    operation: "adjustMaterialQuantity",
    summary: "Receive, consume or adjust material stock",
    description: "Append-only, like the coffee ledger: the balance is never written directly.",
    input: adjustMaterialInput,
    output: materialSchema,
    permission: "inventory.material.write",
    module: "resource_planning",
  },
  async (input, ctx) => {
    await applyMaterialTransaction(ctx.db, {
      materialId: input.id,
      eventType: input.reason,
      deltaQty: input.deltaQty,
      locationId: input.locationId ?? null,
      comment: input.comment ?? null,
      allowNegative: input.reason === "recount",
    });
    const row = await ctx.db.findOne(materials, eq(materials.id, input.id));
    if (!row) throw new NotFound("Material not found");
    return toDto(row);
  },
);

/* ------------------------------------------------------------------- BOM */

async function loadBom(ctx: { db: RpcAppEnv["Variables"]["orgDb"] }, productId: string) {
  const bom = await ctx.db.findOne(
    billsOfMaterials,
    and(eq(billsOfMaterials.productId, productId), eq(billsOfMaterials.isActive, true)) as SQL,
  );
  if (!bom) throw new NotFound("No active bill of materials for this product");

  const lines = await ctx.db.query(async (t, scope) =>
    t
      .select({
        id: bomLines.id,
        materialId: bomLines.materialId,
        materialName: materials.name,
        quantity: bomLines.quantity,
        scrapPct: bomLines.scrapPct,
        position: bomLines.position,
        onHandQty: materials.onHandQty,
        leadTimeDays: materials.leadTimeDays,
      })
      .from(bomLines)
      .innerJoin(materials, eq(materials.id, bomLines.materialId))
      .where(and(scope(bomLines), eq(bomLines.bomId, bom.id)))
      .orderBy(asc(bomLines.position)),
  );
  return { bom, lines };
}

registerRpc(
  inventoryMaterial,
  {
    namespace: "inventory.material",
    operation: "setBillOfMaterials",
    summary: "Define what a product is made of",
    description:
      "Publishes a NEW version and retires the previous one. Editing in place would " +
      "retroactively change what a batch produced last month, which both costing and " +
      "an audit depend on being stable.",
    input: setBomInput,
    output: bomSchema,
    permission: "inventory.material.write",
    module: "resource_planning",
  },
  async (input, ctx) => {
    const created = await ctx.db.transaction(async (tx) => {
      const previous = await tx.findOne(
        billsOfMaterials,
        and(
          eq(billsOfMaterials.productId, input.productId),
          eq(billsOfMaterials.isActive, true),
        ) as SQL,
      );

      // Retire first: the partial unique index allows only one active BOM per
      // product, so inserting before retiring would collide.
      if (previous) {
        await tx.update(
          billsOfMaterials,
          { isActive: false, updatedAt: new Date() },
          eq(billsOfMaterials.id, previous.id),
        );
      }

      const [bom] = await tx.insert(billsOfMaterials, {
        productId: input.productId,
        name: input.name,
        version: (previous?.version ?? 0) + 1,
        yieldQty: input.yieldQty,
        isActive: true,
      });
      if (!bom) throw new Error("Insert returned no row");

      await tx.insert(
        bomLines,
        input.lines.map((line, i) => ({
          bomId: bom.id,
          materialId: line.materialId,
          quantity: line.quantity,
          scrapPct: line.scrapPct ?? "0",
          position: i,
        })),
      );
      return bom.id;
    });

    const { bom, lines } = await loadBom(ctx, input.productId);
    if (bom.id !== created) throw new Error("Unexpected active bill of materials");
    return {
      id: bom.id,
      productId: bom.productId,
      name: bom.name,
      version: bom.version,
      isActive: bom.isActive,
      yieldQty: bom.yieldQty,
      lines: lines.map((l) => ({
        id: l.id,
        materialId: l.materialId,
        materialName: l.materialName,
        quantity: l.quantity,
        scrapPct: l.scrapPct,
        position: l.position,
      })),
      createdAt: bom.createdAt.toISOString(),
    };
  },
);

registerRpc(
  inventoryMaterial,
  {
    namespace: "inventory.material",
    operation: "getBillOfMaterials",
    summary: "The active bill of materials for a product",
    input: getBomInput,
    output: bomSchema,
    permission: "inventory.material.read",
    module: "resource_planning",
    cacheable: { maxAgeSeconds: 30 },
  },
  async (input, ctx) => {
    const { bom, lines } = await loadBom(ctx, input.productId);
    return {
      id: bom.id,
      productId: bom.productId,
      name: bom.name,
      version: bom.version,
      isActive: bom.isActive,
      yieldQty: bom.yieldQty,
      lines: lines.map((l) => ({
        id: l.id,
        materialId: l.materialId,
        materialName: l.materialName,
        quantity: l.quantity,
        scrapPct: l.scrapPct,
        position: l.position,
      })),
      createdAt: bom.createdAt.toISOString(),
    };
  },
);

registerRpc(
  inventoryMaterial,
  {
    namespace: "inventory.material",
    operation: "explodeMaterialRequirements",
    summary: "What a production plan will consume, and what is missing",
    description:
      "Answers the question that actually matters before a production run: not just how " +
      "much is needed, but what will run out and how long a replacement takes to arrive.",
    input: explodeRequirementsInput,
    output: explodeRequirementsOutput,
    permission: "inventory.material.read",
    module: "resource_planning",
    cacheable: { maxAgeSeconds: 15 },
  },
  async (input, ctx) => {
    const { bom, lines } = await loadBom(ctx, input.productId);
    if (bom.yieldQty <= 0) throw new BadRequest("This bill of materials has no yield");

    // Partial runs still consume a whole run's materials, so round up.
    const runs = Math.ceil(input.quantity / bom.yieldQty);
    const required = explodeRequirements(
      lines.map((l) => ({ materialId: l.materialId, quantity: l.quantity, scrapPct: l.scrapPct })),
      runs,
    );

    return {
      productId: input.productId,
      runs,
      items: required.map((r) => {
        const line = lines.find((l) => l.materialId === r.materialId);
        const onHand = line?.onHandQty ?? "0";
        const shortfall = kg.sub(r.requiredQty, onHand);
        return {
          materialId: r.materialId,
          materialName: line?.materialName ?? "",
          requiredQty: r.requiredQty,
          onHandQty: onHand,
          // Zero rather than a negative: a surplus is not a shortfall, and
          // showing "-400 short" reads as a deficit at a glance.
          shortfallQty: kg.isNegative(shortfall) ? "0.0000" : shortfall,
          leadTimeDays: line?.leadTimeDays ?? null,
        };
      }),
    };
  },
);
