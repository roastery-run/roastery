import { z } from "zod";
import { listOutput, pageInputSchema, uuidSchema } from "./common";

export const traceNodeKindSchema = z.enum([
  "producer",
  "green_lot",
  "roast_batch",
  "roasted_lot",
  "blend_lot",
  "product_batch",
  "order_line",
]);

export const traceNodeSchema = z.object({
  kind: traceNodeKindSchema,
  id: uuidSchema,
  label: z.string(),
  detail: z.record(z.string(), z.string().nullable()),
});

export const traceEdgeSchema = z.object({
  depth: z.number().int(),
  sourceKind: traceNodeKindSchema,
  sourceId: uuidSchema,
  targetKind: traceNodeKindSchema,
  targetId: uuidSchema,
  weightKg: z.string(),
  ratioPct: z.string().nullable(),
  occurredAt: z.string(),
});

export const traceInput = z.object({
  kind: traceNodeKindSchema,
  id: uuidSchema,
});

export const traceOutput = z.object({
  root: z.object({ kind: traceNodeKindSchema, id: uuidSchema }),
  direction: z.enum(["backward", "forward"]),
  nodes: z.array(traceNodeSchema),
  edges: z.array(traceEdgeSchema),
  /** The walk hit its bound. Shown rather than hidden: a partial chain that
   *  looks complete is worse than one that says it is not. */
  truncated: z.boolean(),
});

/* ------------------------------------------------------------ certificates */

/**
 * What a certificate froze at the moment it was issued.
 *
 * Typed here rather than left as `z.unknown()` because this is the payload the
 * QR page on a retail bag renders, and it was declared in two places: this
 * schema said "unknown", and `apps/web` kept its own hand-written `Trace` type
 * to make the page compile. Two definitions of one wire shape, with nothing
 * holding them together — and the one that would notice a change is the one
 * printed on a bag somebody already bought.
 *
 * Deliberately a SNAPSHOT and not a query: lots are merged, split and consumed
 * after coffee ships, so a live lookup would describe something other than
 * what is in the bag.
 */
export const traceSnapshotSchema = z.object({
  coffee: z.object({
    name: z.string(),
    lotCode: z.string(),
    roastLevel: z.string().nullable(),
    roastedAt: z.string().nullable(),
  }),
  origins: z.array(
    z.object({
      producer: z.string().nullable(),
      country: z.string().nullable(),
      region: z.string().nullable(),
      altitude: z.string().nullable(),
      process: z.string().nullable(),
      varieties: z.array(z.string()),
    }),
  ),
  roast: z
    .object({
      batchNumber: z.string(),
      roastedAt: z.string().nullable(),
      weightLossPct: z.string().nullable(),
    })
    .nullable(),
});

export type TraceSnapshot = z.infer<typeof traceSnapshotSchema>;

export const traceabilityRecordSchema = z.object({
  id: uuidSchema,
  qrToken: z.string(),
  roastedLotId: uuidSchema.nullable(),
  orderLineId: uuidSchema.nullable(),
  snapshot: traceSnapshotSchema,
  issuedAt: z.string(),
});

export const issueCertificateInput = z.object({
  roastedLotId: uuidSchema,
  orderLineId: uuidSchema.optional(),
  fulfillmentId: uuidSchema.optional(),
});

export const listCertificatesInput = z.object({
  filter: z.object({ roastedLotId: uuidSchema.optional() }).optional(),
  page: pageInputSchema,
});
export const listCertificatesOutput = listOutput(traceabilityRecordSchema);

/** The public page. No organization in hand — an unauthenticated phone in a café. */
export const publicTraceOutput = z.object({
  qrToken: z.string(),
  issuedAt: z.string(),
  coffee: z.object({
    name: z.string(),
    lotCode: z.string(),
    roastLevel: z.string().nullable(),
    roastedAt: z.string().nullable(),
  }),
  origins: z.array(
    z.object({
      producer: z.string().nullable(),
      country: z.string().nullable(),
      region: z.string().nullable(),
      altitude: z.string().nullable(),
      process: z.string().nullable(),
      varieties: z.array(z.string()),
    }),
  ),
  roast: z
    .object({
      batchNumber: z.string(),
      roastedAt: z.string().nullable(),
      weightLossPct: z.string().nullable(),
    })
    .nullable(),
  quality: z.object({ cuppingScore: z.string().nullable(), notes: z.array(z.string()) }).nullable(),
});

/* ---------------------------------------------------------------- reporting */

export const reportKindSchema = z.enum([
  "traceability_certificate",
  "inventory_valuation",
  "production_summary",
  "quality_summary",
  "cafe_performance",
]);

export const reportStatusSchema = z.enum(["queued", "rendering", "ready", "failed"]);

export const reportSchema = z.object({
  id: uuidSchema,
  kind: reportKindSchema,
  status: reportStatusSchema,
  title: z.string(),
  parameters: z.unknown(),
  contentType: z.string().nullable(),
  sizeBytes: z.string().nullable(),
  error: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const generateReportInput = z.object({
  kind: reportKindSchema,
  title: z.string().min(1).max(200).optional(),
  parameters: z
    .object({
      from: z.string().optional(),
      to: z.string().optional(),
      siteId: uuidSchema.optional(),
      roastedLotId: uuidSchema.optional(),
      locationId: uuidSchema.optional(),
    })
    .default({}),
});

export const getReportInput = z.object({ id: uuidSchema });

export const listReportsInput = z.object({
  filter: z
    .object({ kind: reportKindSchema.optional(), status: reportStatusSchema.optional() })
    .optional(),
  page: pageInputSchema,
});
export const listReportsOutput = listOutput(reportSchema);

export const downloadUrlInput = z.object({
  id: uuidSchema,
  /** Seconds. Capped, because a link that outlives the conversation is a leak. */
  expiresInSeconds: z.number().int().min(60).max(3600).default(900),
});
export const downloadUrlOutput = z.object({
  url: z.string(),
  expiresAt: z.string(),
  contentType: z.string(),
});
