import { z } from "zod";
import { codeSchema, listOutput, pageInputSchema, uuidSchema } from "./common";
import { weightKgSchema } from "./inventory";

export const materialKindSchema = z.enum([
  "bag",
  "label",
  "valve",
  "box",
  "tin",
  "capsule",
  "tape",
  "insert",
  "merch",
  "other",
]);

export const materialSchema = z.object({
  id: uuidSchema,
  sku: z.string(),
  name: z.string(),
  kind: materialKindSchema,
  onHandQty: z.string(),
  reorderPoint: z.string().nullable(),
  reorderQty: z.string().nullable(),
  leadTimeDays: z.number().int().nullable(),
  /** True when on-hand has fallen to or below the reorder point. */
  needsReorder: z.boolean(),
  unitCost: z.string().nullable(),
  currency: z.string().nullable(),
  supplierPartnerId: uuidSchema.nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const listMaterialsInput = z.object({
  filter: z
    .object({
      kind: materialKindSchema.optional(),
      needsReorder: z.boolean().optional(),
      isActive: z.boolean().optional(),
      q: z.string().max(200).optional(),
    })
    .optional(),
  page: pageInputSchema,
});
export const listMaterialsOutput = listOutput(materialSchema);

export const getMaterialInput = z.object({ id: uuidSchema });

export const createMaterialInput = z.object({
  sku: codeSchema,
  name: z.string().min(1).max(200),
  kind: materialKindSchema,
  unitCost: z.string().optional(),
  currency: z.string().length(3).optional(),
  reorderPoint: weightKgSchema.optional(),
  reorderQty: weightKgSchema.optional(),
  leadTimeDays: z.number().int().min(0).max(365).optional(),
  supplierPartnerId: uuidSchema.optional(),
});

export const adjustMaterialInput = z.object({
  id: uuidSchema,
  deltaQty: weightKgSchema,
  reason: z.enum(["receive", "adjust", "shrinkage", "write_off", "recount", "return"]),
  locationId: uuidSchema.optional(),
  comment: z.string().max(1000).optional(),
});

/* ------------------------------------------------------------------- BOM */

export const bomLineInput = z.object({
  materialId: uuidSchema,
  quantity: weightKgSchema,
  /** Expected loss, so a requirement reflects what is actually consumed. */
  scrapPct: z.string().optional(),
});

export const setBomInput = z.object({
  productId: uuidSchema,
  name: z.string().min(1).max(200),
  yieldQty: z.number().int().min(1).default(1),
  lines: z.array(bomLineInput).min(1).max(100),
});

export const bomSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  name: z.string(),
  version: z.number().int(),
  isActive: z.boolean(),
  yieldQty: z.number().int(),
  lines: z.array(
    z.object({
      id: uuidSchema,
      materialId: uuidSchema,
      materialName: z.string(),
      quantity: z.string(),
      scrapPct: z.string(),
      position: z.number().int(),
    }),
  ),
  createdAt: z.string(),
});

export const getBomInput = z.object({ productId: uuidSchema });

export const explodeRequirementsInput = z.object({
  productId: uuidSchema,
  /** How many finished units are planned. */
  quantity: z.number().int().min(1).max(1_000_000),
});

export const explodeRequirementsOutput = z.object({
  productId: uuidSchema,
  runs: z.number().int(),
  items: z.array(
    z.object({
      materialId: uuidSchema,
      materialName: z.string(),
      requiredQty: z.string(),
      onHandQty: z.string(),
      shortfallQty: z.string(),
      leadTimeDays: z.number().int().nullable(),
    }),
  ),
});

/* ---------------------------------------------------------- landed cost */

export const costComponentKindSchema = z.enum([
  "base_price",
  "differential",
  "futures",
  "fx_adjustment",
  "carry",
  "storage",
  "freight",
  "insurance",
  "duty",
  "customs",
  "handling",
  "financing",
  "broker_fee",
  "sampling",
  "certification",
  "other",
]);

export const setCostComponentsInput = z.object({
  greenLotId: uuidSchema,
  /** Replaces the lot's components wholesale, so the rollup cannot drift. */
  components: z
    .array(
      z.object({
        kind: costComponentKindSchema,
        label: z.string().max(200).optional(),
        amount: z.string(),
        currency: z.string().length(3),
        /** True when `amount` is per kilogram rather than a flat charge. */
        perUnit: z.boolean().default(false),
      }),
    )
    .max(50),
});

export const landedCostSchema = z.object({
  greenLotId: uuidSchema,
  basePriceBase: z.string(),
  freightBase: z.string(),
  dutyBase: z.string(),
  carryBase: z.string(),
  otherBase: z.string(),
  totalBase: z.string(),
  perKgBase: z.string(),
});

export const getLandedCostInput = z.object({ greenLotId: uuidSchema });
