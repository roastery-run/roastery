import { z } from "zod";
import { codeSchema, listOutput, pageInputSchema, uuidSchema } from "./common";

export const cuppingModeSchema = z.enum(["open", "blind", "double_blind"]);
export const cuppingSessionStatusSchema = z.enum([
  "draft",
  "scheduled",
  "in_progress",
  "scored",
  "finalized",
  "canceled",
]);
export const gradingStandardSchema = z.enum([
  "sca",
  "coe",
  "brazil_ny",
  "indonesian",
  "vietnamese",
  "custom",
]);

/** SCA attributes: 6.00-10.00 in quarter points. */
const attribute = z.number().min(6).max(10);

export const scaScoresSchema = z.object({
  fragrance: attribute.optional(),
  flavor: attribute.optional(),
  aftertaste: attribute.optional(),
  acidity: attribute.optional(),
  body: attribute.optional(),
  balance: attribute.optional(),
  uniformity: attribute.optional(),
  cleanCup: attribute.optional(),
  sweetness: attribute.optional(),
  overall: attribute.optional(),
});

export const cuppingSessionSchema = z.object({
  id: uuidSchema,
  sessionNumber: z.string(),
  name: z.string(),
  mode: cuppingModeSchema,
  status: cuppingSessionStatusSchema,
  scheduledAt: z.string().nullable(),
  finalizedAt: z.string().nullable(),
  sampleCount: z.number().int(),
  createdAt: z.string(),
});

export const listCuppingSessionsInput = z.object({
  filter: z.object({ status: cuppingSessionStatusSchema.optional() }).optional(),
  page: pageInputSchema,
});
export const listCuppingSessionsOutput = listOutput(cuppingSessionSchema);

export const createCuppingSessionInput = z.object({
  sessionNumber: codeSchema,
  name: z.string().min(1).max(200),
  mode: cuppingModeSchema.default("blind"),
  scheduledAt: z.iso.datetime().optional(),
  samples: z
    .array(
      z.object({
        sampleId: uuidSchema.optional(),
        greenLotId: uuidSchema.optional(),
        roastedLotId: uuidSchema.optional(),
        roastBatchId: uuidSchema.optional(),
      }),
    )
    .min(1)
    .max(40),
});

/**
 * What a cupper sees.
 *
 * In a blind session the identity fields are ABSENT, not merely hidden by the
 * client — a cupper who can read the identity out of a network response is not
 * blind, whatever the interface shows.
 */
export const cuppingTableSchema = z.object({
  sessionId: uuidSchema,
  mode: cuppingModeSchema,
  status: cuppingSessionStatusSchema,
  samples: z.array(
    z.object({
      id: uuidSchema,
      position: z.number().int(),
      blindCode: z.string(),
      /** Present only once the session is finalized, or in an open session. */
      identity: z
        .object({
          sampleId: uuidSchema.nullable(),
          greenLotId: uuidSchema.nullable(),
          label: z.string(),
        })
        .nullable(),
      avgTotalScore: z.string().nullable(),
      scoreCount: z.number().int(),
      scoreStdDev: z.string().nullable(),
    }),
  ),
});

export const getCuppingTableInput = z.object({ sessionId: uuidSchema });

export const submitCuppingScoreInput = z.object({
  sessionSampleId: uuidSchema,
  /** For a visiting grader with no account. */
  cupperName: z.string().max(120).optional(),
  scores: scaScoresSchema,
  defectsPenalty: z.number().min(0).max(40).default(0),
  descriptors: z.array(z.string().max(80)).max(20).optional(),
  notes: z.string().max(2000).optional(),
});

export const cuppingScoreSchema = z.object({
  id: uuidSchema,
  sessionSampleId: uuidSchema,
  cupperName: z.string().nullable(),
  totalScore: z.string().nullable(),
  defectsPenalty: z.string(),
  descriptors: z.array(z.string()),
  submittedAt: z.string(),
});

export const finalizeCuppingSessionInput = z.object({ sessionId: uuidSchema });
export const finalizeCuppingSessionOutput = z.object({
  sessionId: uuidSchema,
  status: cuppingSessionStatusSchema,
  results: z.array(
    z.object({
      sessionSampleId: uuidSchema,
      blindCode: z.string(),
      label: z.string(),
      average: z.number().nullable(),
      stdDev: z.number().nullable(),
      count: z.number().int(),
      /** Cuppers far from the panel: a calibration conversation, not bad data. */
      outliers: z.array(z.object({ cupper: z.string(), total: z.number(), deviation: z.number() })),
    }),
  ),
});

/* --------------------------------------------------------------- grading */

export const greenGradingSchema = z.object({
  id: uuidSchema,
  greenLotId: uuidSchema.nullable(),
  sampleId: uuidSchema.nullable(),
  standard: gradingStandardSchema,
  moisturePct: z.string().nullable(),
  waterActivity: z.string().nullable(),
  screenSizeAvg: z.string().nullable(),
  defectsPrimary: z.number().int(),
  defectsSecondary: z.number().int(),
  fullDefectEquivalents: z.string().nullable(),
  grade: z.string().nullable(),
  passed: z.boolean(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});

export const recordGradingInput = z.object({
  greenLotId: uuidSchema.optional(),
  sampleId: uuidSchema.optional(),
  standard: gradingStandardSchema.default("sca"),
  moisturePct: z.number().min(0).max(30).optional(),
  waterActivity: z.number().min(0).max(1).optional(),
  screenSizeAvg: z.number().min(8).max(20).optional(),
  densityGPerL: z.number().min(300).max(900).optional(),
  defectsPrimary: z.number().int().min(0).max(500).default(0),
  defectsSecondary: z.number().int().min(0).max(500).default(0),
  screenDistribution: z.record(z.string(), z.number()).optional(),
  defectCounts: z.record(z.string(), z.number()).optional(),
  notes: z.string().max(2000).optional(),
});

export const listGradingsInput = z.object({
  filter: z
    .object({ greenLotId: uuidSchema.optional(), passed: z.boolean().optional() })
    .optional(),
  page: pageInputSchema,
});
export const listGradingsOutput = listOutput(greenGradingSchema);

export const releaseQuarantineInput = z.object({
  greenLotId: uuidSchema,
  reason: z.string().min(1).max(1000),
});
