import { z } from "zod";
import { listOutput, pageInputSchema, uuidSchema } from "./common";

export const cafeMachineKindSchema = z.enum([
  "espresso_machine",
  "grinder",
  "batch_brewer",
  "water_system",
]);

export const shotVerdictSchema = z.enum([
  "in_spec",
  "fast",
  "slow",
  "under_dosed",
  "over_dosed",
  "channeling",
  "discarded",
]);

/* ------------------------------------------------------------------- sites */

export const cafeSiteSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  code: z.string(),
  locationId: uuidSchema.nullable(),
  timezone: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

export const listSitesInput = z.object({ page: pageInputSchema });
export const listSitesOutput = listOutput(cafeSiteSchema);

export const createSiteInput = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(60),
  locationId: uuidSchema.optional(),
  /** IANA zone. A café's business day is local, never UTC. */
  timezone: z.string().max(60).optional(),
});

export const cafeMachineSchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema,
  name: z.string(),
  code: z.string(),
  kind: cafeMachineKindSchema,
  groupCount: z.number().int().nullable(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  createdAt: z.string(),
});

export const listCafeMachinesInput = z.object({
  filter: z
    .object({ siteId: uuidSchema.optional(), kind: cafeMachineKindSchema.optional() })
    .optional(),
  page: pageInputSchema,
});
export const listCafeMachinesOutput = listOutput(cafeMachineSchema);

export const registerCafeMachineInput = z.object({
  siteId: uuidSchema,
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(60),
  kind: cafeMachineKindSchema,
  groupCount: z.number().int().min(1).max(6).optional(),
  brand: z.string().max(120).optional(),
  model: z.string().max(120).optional(),
  deviceId: z.string().max(200).optional(),
});

/* ------------------------------------------------------------------- shots */

/**
 * Grams and seconds on the wire, not kilograms.
 *
 * The deliberate exception to this API's canonical-kilograms rule: a barista
 * reads 18.5 g off a scale, and a bar integration that has to divide by a
 * thousand will eventually forget to.
 */
export const shotInputSchema = z.object({
  /** The bridge's own id. The dedupe key — a replayed buffer must not double. */
  externalId: z.string().min(1).max(200),
  machineId: uuidSchema,
  groupNumber: z.number().int().min(1).max(6).default(1),
  pulledAt: z.string(),
  doseG: z.number().min(0).max(100).nullish(),
  yieldG: z.number().min(0).max(500).nullish(),
  durationS: z.number().min(0).max(300).nullish(),
  brewTempC: z.number().min(0).max(150).nullish(),
  peakPressureBar: z.number().min(0).max(20).nullish(),
  grindSetting: z.string().max(60).nullish(),
  roastedLotId: uuidSchema.nullish(),
  blendId: uuidSchema.nullish(),
  baristaRef: z.string().max(120).nullish(),
  /** Dumped rather than served. Recorded, because waste is a number worth having. */
  discarded: z.boolean().optional(),
});

export const espressoShotSchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema,
  machineId: uuidSchema,
  groupNumber: z.number().int(),
  externalId: z.string(),
  pulledAt: z.string(),
  doseG: z.string().nullable(),
  yieldG: z.string().nullable(),
  durationS: z.string().nullable(),
  ratio: z.string().nullable(),
  verdict: shotVerdictSchema,
  roastedLotId: uuidSchema.nullable(),
  blendId: uuidSchema.nullable(),
  baristaRef: z.string().nullable(),
});

export const listShotsInput = z.object({
  filter: z.object({
    siteId: uuidSchema.optional(),
    machineId: uuidSchema.optional(),
    verdict: shotVerdictSchema.optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  limit: z.number().int().min(1).max(500).default(100),
});
export const listShotsOutput = z.object({
  items: z.array(espressoShotSchema),
  hasMore: z.boolean(),
});

/* ---------------------------------------------------------------- rollups */

export const shotRollupSchema = z.object({
  siteId: uuidSchema,
  machineId: uuidSchema,
  hourStart: z.string(),
  shotCount: z.number().int(),
  inSpecCount: z.number().int(),
  channelingCount: z.number().int(),
  discardedCount: z.number().int(),
  avgDoseG: z.string().nullable(),
  avgYieldG: z.string().nullable(),
  avgDurationS: z.string().nullable(),
  avgRatio: z.string().nullable(),
  /** Consistency. The number that separates a good bar from a lucky one. */
  stddevDurationS: z.string().nullable(),
  coffeeUsedKg: z.string().nullable(),
});

export const sitePerformanceInput = z.object({
  siteId: uuidSchema,
  from: z.string(),
  to: z.string(),
});
export const sitePerformanceOutput = z.object({
  siteId: uuidSchema,
  from: z.string(),
  to: z.string(),
  shotCount: z.number().int(),
  inSpecPct: z.number().nullable(),
  channelingPct: z.number().nullable(),
  coffeeUsedKg: z.string(),
  hours: z.array(shotRollupSchema),
});

export const liveBarInput = z.object({ siteId: uuidSchema });
export const liveBarOutput = z.object({
  siteId: uuidSchema,
  watchers: z.number().int(),
  shots: z.array(
    z.object({
      externalId: z.string(),
      machineId: uuidSchema,
      groupNumber: z.number().int(),
      pulledAt: z.number(),
      doseG: z.number().nullable(),
      yieldG: z.number().nullable(),
      durationS: z.number().nullable(),
      ratio: z.number().nullable(),
      verdict: shotVerdictSchema,
    }),
  ),
  anomalies: z.array(
    z.object({
      kind: z.enum(["channeling", "drifting", "group_down"]),
      groupNumber: z.number().int(),
      message: z.string(),
      evidence: z.number().int(),
    }),
  ),
});

/* ---------------------------------------------------------------- POS */

export const posLineInputSchema = z.object({
  externalId: z.string().min(1).max(200),
  soldAt: z.string(),
  itemName: z.string().min(1).max(200),
  /** How many espresso shots this line implies. A double is two. */
  shotEquivalents: z.number().int().min(0).max(20).default(1),
  quantity: z.number().int().min(1).max(500).default(1),
  grossAmount: z.string().optional(),
  currency: z.string().length(3).optional(),
});

export const importPosSalesInput = z.object({
  siteId: uuidSchema,
  lines: z.array(posLineInputSchema).min(1).max(1000),
});
export const importPosSalesOutput = z.object({
  siteId: uuidSchema,
  received: z.number().int(),
  imported: z.number().int(),
  duplicates: z.number().int(),
});

export const reconcilePosInput = z.object({
  siteId: uuidSchema,
  businessDate: z.string(),
});
export const posReconciliationSchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema,
  businessDate: z.string(),
  status: z.enum(["pending", "matched", "shot_missing", "sale_missing", "quantity_mismatch"]),
  shotCount: z.number().int(),
  saleShotEquivalents: z.number().int(),
  /** shots − sales. Positive is unsold coffee; negative is unreported shots. */
  variance: z.number().int(),
  variancePct: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});

export const listReconciliationsInput = z.object({
  filter: z
    .object({
      siteId: uuidSchema.optional(),
      status: z
        .enum(["pending", "matched", "shot_missing", "sale_missing", "quantity_mismatch"])
        .optional(),
    })
    .optional(),
  page: pageInputSchema,
});
export const listReconciliationsOutput = listOutput(posReconciliationSchema);
