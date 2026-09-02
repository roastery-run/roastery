import { z } from "zod";
import { codeSchema, listOutput, pageInputSchema, uuidSchema } from "./common";
import { positiveWeightKgSchema } from "./inventory";

export const roastBatchStatusSchema = z.enum([
  "scheduled",
  "in_progress",
  "cooling",
  "completed",
  "aborted",
  "discarded",
]);

export const roastEventKindSchema = z.enum([
  "charge",
  "turning_point",
  "dry_end",
  "first_crack_start",
  "first_crack_end",
  "second_crack_start",
  "drop",
  "gas_change",
  "air_change",
  "drum_change",
  "note",
]);

/** A downsampled curve, struct-of-arrays: ~5x smaller than array-of-objects. */
export const curvePreviewSchema = z.object({
  t: z.array(z.number()),
  bt: z.array(z.number()),
  et: z.array(z.number()),
  ror: z.array(z.number()),
});

export const roastProfileSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  code: z.string(),
  version: z.number().int(),
  machineId: uuidSchema.nullable(),
  targetChargeKg: z.string().nullable(),
  targetDropTempC: z.string().nullable(),
  targetTotalTimeS: z.number().int().nullable(),
  targetDtrPct: z.string().nullable(),
  referenceCurve: curvePreviewSchema.nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

export const listProfilesInput = z.object({
  filter: z
    .object({ machineId: uuidSchema.optional(), isActive: z.boolean().optional() })
    .optional(),
  page: pageInputSchema,
});
export const listProfilesOutput = listOutput(roastProfileSchema);

export const getProfileInput = z.object({ id: uuidSchema });

export const createProfileInput = z.object({
  name: z.string().min(1).max(200),
  code: codeSchema,
  machineId: uuidSchema.optional(),
  targetChargeKg: z.string().optional(),
  targetDropTempC: z.string().optional(),
  targetTotalTimeS: z.number().int().min(60).max(3600).optional(),
  targetDtrPct: z.string().optional(),
  notes: z.string().max(4000).optional(),
});

export const roastBatchSchema = z.object({
  id: uuidSchema,
  batchNumber: z.string(),
  machineId: uuidSchema.nullable(),
  profileId: uuidSchema.nullable(),
  status: roastBatchStatusSchema,
  purpose: z.string(),
  chargeWeightKg: z.string().nullable(),
  dropWeightKg: z.string().nullable(),
  weightLossPct: z.string().nullable(),
  totalTimeS: z.number().int().nullable(),
  firstCrackS: z.number().int().nullable(),
  dryEndS: z.number().int().nullable(),
  developmentTimeS: z.number().int().nullable(),
  dtrPct: z.string().nullable(),
  dropTempC: z.string().nullable(),
  maxRorCPerMin: z.string().nullable(),
  curvePreview: curvePreviewSchema.nullable(),
  sampleCount: z.number().int().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});

export const listRoastBatchesInput = z.object({
  filter: z
    .object({
      machineId: uuidSchema.optional(),
      profileId: uuidSchema.optional(),
      status: roastBatchStatusSchema.optional(),
    })
    .optional(),
  page: pageInputSchema,
});
export const listRoastBatchesOutput = listOutput(roastBatchSchema);

export const getRoastBatchInput = z.object({ id: uuidSchema });

export const startRoastBatchInput = z.object({
  batchNumber: codeSchema,
  machineId: uuidSchema,
  profileId: uuidSchema.optional(),
  /** The green consumed. Deducted from inventory when the batch completes. */
  greenLotId: uuidSchema.optional(),
  chargeWeightKg: positiveWeightKgSchema,
  locationId: uuidSchema.optional(),
});

export const completeRoastBatchInput = z.object({
  id: uuidSchema,
  dropWeightKg: positiveWeightKgSchema.optional(),
  notes: z.string().max(2000).optional(),
});

export const getRoastCurveInput = z.object({ id: uuidSchema });
export const getRoastCurveOutput = z.object({
  batchId: uuidSchema,
  /** 1 Hz downsample from Postgres; the full curve lives in object storage. */
  samples: z.array(
    z.object({
      t: z.string(),
      beanTempC: z.string().nullable(),
      envTempC: z.string().nullable(),
      rorCPerMin: z.string().nullable(),
    }),
  ),
  events: z.array(
    z.object({ kind: roastEventKindSchema, atSeconds: z.string(), note: z.string().nullable() }),
  ),
});

export const issueBridgeTokenInput = z.object({
  machineId: uuidSchema,
  expiresInHours: z.number().int().min(1).max(720).default(24),
});
export const issueBridgeTokenOutput = z.object({
  token: z.string(),
  machineId: uuidSchema,
  expiresAt: z.string(),
});

export const importArtisanInput = z.object({
  /** Raw file contents. JSON or CSV; .alog is rejected with a clear message. */
  content: z.string().min(2).max(10_000_000),
  batchNumber: codeSchema,
  machineId: uuidSchema.optional(),
});
export const importArtisanOutput = z.object({
  batchId: uuidSchema,
  batchNumber: z.string(),
  sampleCount: z.number().int(),
  eventCount: z.number().int(),
  source: z.string(),
});
