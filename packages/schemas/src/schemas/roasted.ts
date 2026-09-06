import { z } from "zod";
import { codeSchema, listOutput, pageInputSchema, uuidSchema } from "./common";
import { lotStatusSchema, positiveWeightKgSchema, weightKgSchema } from "./inventory";

export const roastedLotKindSchema = z.enum(["loose", "packaged", "blended"]);
export const blendTypeSchema = z.enum(["pre_roast", "post_roast"]);
export const roastLevelSchema = z.enum(["light", "medium", "dark"]);

export const roastedLotSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  lotCode: z.string(),
  lotKind: roastedLotKindSchema,
  blendId: uuidSchema.nullable(),
  roastBatchId: uuidSchema.nullable(),
  roastLevel: z.string().nullable(),
  initialWeightKg: z.string(),
  currentWeightKg: z.string(),
  reservedWeightKg: z.string(),
  availableWeightKg: z.string(),
  /** Negative once past its best-before date. */
  daysUntilBestBefore: z.number().int().nullable(),
  locationId: uuidSchema.nullable(),
  roastedAt: z.string(),
  bestBeforeAt: z.string().nullable(),
  status: lotStatusSchema,
});

export const listRoastedLotsInput = z.object({
  filter: z
    .object({
      lotKind: roastedLotKindSchema.optional(),
      status: lotStatusSchema.optional(),
      blendId: uuidSchema.optional(),
      /** Past, or close to, its best-before date. */
      expiringWithinDays: z.number().int().min(0).max(365).optional(),
      /** Matches the lot name or its code. */
      q: z.string().max(200).optional(),
    })
    .optional(),
  page: pageInputSchema,
});
export const listRoastedLotsOutput = listOutput(roastedLotSchema);

export const getRoastedLotInput = z.object({ id: uuidSchema });

export const adjustRoastedLotInput = z.object({
  id: uuidSchema,
  deltaKg: weightKgSchema,
  reason: z.enum(["adjust", "shrinkage", "write_off", "recount", "sample_draw", "return"]),
  comment: z.string().max(1000).optional(),
});

/* ----------------------------------------------------------------- blends */

export const blendComponentSchema = z.object({
  id: uuidSchema,
  greenLotId: uuidSchema.nullable(),
  roastedLotId: uuidSchema.nullable(),
  targetRatioPct: z.string(),
  position: z.number().int(),
});

export const blendSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  code: z.string(),
  blendType: blendTypeSchema,
  targetWeightLossPct: z.string().nullable(),
  roastLevel: roastLevelSchema.nullable(),
  isDecaf: z.boolean(),
  isActive: z.boolean(),
  components: z.array(blendComponentSchema),
  createdAt: z.string(),
});

export const listBlendsInput = z.object({
  filter: z
    .object({
      blendType: blendTypeSchema.optional(),
      isActive: z.boolean().optional(),
      /** Matches the blend name or its code. */
      q: z.string().max(200).optional(),
    })
    .optional(),
  page: pageInputSchema,
});
export const listBlendsOutput = listOutput(blendSchema.omit({ components: true }));

export const getBlendInput = z.object({ id: uuidSchema });

export const createBlendInput = z.object({
  name: z.string().min(1).max(200),
  code: codeSchema,
  blendType: blendTypeSchema,
  targetWeightLossPct: z.string().optional(),
  /** Both feed production sequencing; see the note on the blends table. */
  roastLevel: roastLevelSchema.optional(),
  isDecaf: z.boolean().optional(),
  components: z
    .array(
      z.object({
        greenLotId: uuidSchema.optional(),
        roastedLotId: uuidSchema.optional(),
        /** Ratios must total exactly 100. */
        targetRatioPct: z.string(),
      }),
    )
    .min(1)
    .max(20),
});

export const validateBlendInput = z.object({
  blendId: uuidSchema,
  /** The ROASTED weight wanted; green is grossed up for roast loss. */
  requestedKg: positiveWeightKgSchema,
});

export const validateBlendOutput = z.object({
  blendId: uuidSchema,
  requestedKg: z.string(),
  greenRequiredKg: z.string(),
  feasible: z.boolean(),
  components: z.array(
    z.object({
      componentId: uuidSchema,
      greenLotId: uuidSchema.nullable(),
      lotName: z.string(),
      targetRatioPct: z.string(),
      requiredKg: z.string(),
      availableKg: z.string(),
      /** Zero when there is enough; a surplus is not a shortfall. */
      shortfallKg: z.string(),
    }),
  ),
});

/* --------------------------------------------------------- traceability */

export const traceRoastedLotInput = z.object({ id: uuidSchema });
export const traceRoastedLotOutput = z.object({
  roastedLotId: uuidSchema,
  chain: z.array(
    z.object({
      kind: z.string(),
      id: uuidSchema,
      label: z.string(),
      weightKg: z.string().nullable(),
    }),
  ),
});
