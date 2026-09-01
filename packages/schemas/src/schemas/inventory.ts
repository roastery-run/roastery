import { z } from "zod";
import { codeSchema, listOutput, pageInputSchema, uuidSchema } from "./common";

export const greenStateSchema = z.enum([
  "green",
  "parchment",
  "dry_cherry",
  "wet_parchment",
  "raw_green",
  "decaf_green",
]);

export const lotStatusSchema = z.enum([
  "projected",
  "in_transit",
  "spot",
  "available",
  "reserved",
  "quarantined",
  "depleted",
  "archived",
]);

export const inventoryEventSchema = z.enum([
  "receive",
  "adjust",
  "allocate",
  "deallocate",
  "roast_consume",
  "transfer_out",
  "transfer_in",
  "split_out",
  "split_in",
  "merge_out",
  "merge_in",
  "sample_draw",
  "shrinkage",
  "write_off",
  "recount",
  "return",
]);

/**
 * Weights cross the wire as decimal STRINGS, never numbers.
 *
 * JSON numbers are IEEE 754 doubles, so a 5-significant-figure weight with 4
 * decimals is already at the edge of exact representation — and the ledger's
 * whole auditability argument rests on exactness. A string round-trips
 * unchanged through every client.
 */
export const weightKgSchema = z
  .string()
  .regex(/^-?\d{1,10}(\.\d{1,4})?$/, "Weight must be a decimal with at most 4 places");

export const positiveWeightKgSchema = weightKgSchema.refine(
  (v) => Number.parseFloat(v) > 0,
  "Weight must be greater than zero",
);

export const greenLotSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  lotCode: z.string(),
  supplierRef: z.string().nullable(),
  producerId: uuidSchema.nullable(),
  partnerId: uuidSchema.nullable(),
  parentLotId: uuidSchema.nullable(),
  state: greenStateSchema,
  status: lotStatusSchema,
  varieties: z.array(z.string()),
  processMethod: z.string().nullable(),
  harvestYear: z.number().int().nullable(),
  certifications: z.array(z.string()),
  initialWeightKg: z.string(),
  currentWeightKg: z.string(),
  reservedWeightKg: z.string(),
  /** current − reserved: what may actually be committed to new work. */
  availableWeightKg: z.string(),
  minWeightKg: z.string().nullable(),
  bagCount: z.number().int().nullable(),
  bagWeightKg: z.string().nullable(),
  unitCost: z.string().nullable(),
  currency: z.string().nullable(),
  totalValueBase: z.string().nullable(),
  defaultLocationId: uuidSchema.nullable(),
  registeredAt: z.string(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const listGreenLotsInput = z.object({
  filter: z
    .object({
      status: lotStatusSchema.optional(),
      state: greenStateSchema.optional(),
      producerId: uuidSchema.optional(),
      partnerId: uuidSchema.optional(),
      /** Lots at or below their configured minimum. */
      belowMinimum: z.boolean().optional(),
      q: z.string().max(200).optional(),
    })
    .optional(),
  page: pageInputSchema,
});
export const listGreenLotsOutput = listOutput(greenLotSchema);

export const getGreenLotInput = z.object({ id: uuidSchema });

export const importGreenLotInput = z.object({
  name: z.string().min(1).max(200),
  lotCode: codeSchema,
  weightKg: positiveWeightKgSchema,
  supplierRef: z.string().max(120).optional(),
  producerId: uuidSchema.optional(),
  partnerId: uuidSchema.optional(),
  state: greenStateSchema.default("green"),
  varieties: z.array(z.string().max(80)).optional(),
  processMethod: z.string().max(80).optional(),
  harvestYear: z.number().int().min(1900).max(2100).optional(),
  certifications: z.array(z.string().max(80)).optional(),
  /** Bags are per-lot: a Colombian and a Brazilian bag are different weights. */
  bagCount: z.number().int().min(0).optional(),
  bagWeightKg: z.string().optional(),
  unitCost: z.string().optional(),
  currency: z.string().length(3).optional(),
  minWeightKg: weightKgSchema.optional(),
  locationId: uuidSchema.optional(),
  notes: z.string().max(4000).optional(),
});

export const adjustGreenLotInput = z.object({
  id: uuidSchema,
  /** Signed. Negative removes. */
  deltaKg: weightKgSchema,
  reason: z.enum(["adjust", "shrinkage", "write_off", "recount", "sample_draw", "return"]),
  locationId: uuidSchema.optional(),
  comment: z.string().max(1000).optional(),
});

export const transferGreenLotInput = z.object({
  id: uuidSchema,
  fromLocationId: uuidSchema,
  toLocationId: uuidSchema,
  weightKg: positiveWeightKgSchema,
  comment: z.string().max(1000).optional(),
});
export const transferGreenLotOutput = z.object({ groupId: uuidSchema });

export const splitGreenLotInput = z.object({
  id: uuidSchema,
  weightKg: positiveWeightKgSchema,
  newLotCode: codeSchema,
  newName: z.string().min(1).max(200).optional(),
  comment: z.string().max(1000).optional(),
});
export const splitGreenLotOutput = z.object({
  source: greenLotSchema,
  created: greenLotSchema,
});

export const mergeGreenLotsInput = z.object({
  /** Absorbs the others; keeps its own code and provenance. */
  targetId: uuidSchema,
  sourceIds: z.array(uuidSchema).min(1).max(20),
  comment: z.string().max(1000).optional(),
});

export const reserveGreenLotInput = z.object({
  id: uuidSchema,
  weightKg: positiveWeightKgSchema,
  comment: z.string().max(1000).optional(),
});

export const releaseGreenLotInput = reserveGreenLotInput;

export const transactionSchema = z.object({
  id: uuidSchema,
  seq: z.number(),
  eventType: inventoryEventSchema,
  locationId: uuidSchema.nullable(),
  weightBeforeKg: z.string(),
  deltaKg: z.string(),
  weightAfterKg: z.string(),
  groupId: uuidSchema.nullable(),
  comment: z.string().nullable(),
  occurredAt: z.string(),
});

export const listTransactionsInput = z.object({
  greenLotId: uuidSchema,
  page: pageInputSchema,
});
export const listTransactionsOutput = listOutput(transactionSchema);

export const lotBalancesInput = z.object({ greenLotId: uuidSchema });
export const lotBalancesOutput = z.object({
  items: z.array(
    z.object({
      locationId: uuidSchema,
      locationName: z.string(),
      weightKg: z.string(),
    }),
  ),
});
