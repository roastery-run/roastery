import { z } from "zod";
import { listOutput, pageInputSchema, uuidSchema } from "./common";

/**
 * Retail bag labels.
 *
 * A label is a rendering of a traceability certificate, so every dynamic
 * value is a path into the snapshot that certificate froze. Nothing on a
 * printed bag may be re-derived at print time — the lot it describes may have
 * been merged or consumed since, and a bag that changes its own story once it
 * leaves the building is worse than one with no story at all.
 */

/** Every value a block may bind to. Paths into `publicTraceOutput`. */
export const labelBindingSchema = z.enum([
  "coffee.name",
  "coffee.lotCode",
  "coffee.roastLevel",
  "coffee.roastedAt",
  "origin.producer",
  "origin.country",
  "origin.region",
  "origin.altitude",
  "origin.process",
  "origin.varieties",
  "roast.batchNumber",
  "quality.cuppingScore",
  "quality.notes",
]);

export const labelBlockSchema = z.object({
  id: z.string().min(1).max(64),
  /** `field` binds to the certificate; `text` is fixed copy; `rule` is a hairline. */
  kind: z.enum(["field", "text", "rule"]),
  binding: labelBindingSchema.optional(),
  text: z.string().max(200).optional(),
  /** Small-caps prefix, e.g. "ORIGIN". Empty renders the value alone. */
  caption: z.string().max(40).optional(),
  size: z.enum(["xs", "sm", "md", "lg", "xl"]).default("md"),
  weight: z.enum(["regular", "medium", "bold"]).default("regular"),
  align: z.enum(["left", "center", "right"]).default("left"),
});

export const labelTemplateBodySchema = z.object({
  name: z.string().min(1).max(120),
  /** Millimetres. A label is a physical object; pixels are not a size. */
  widthMm: z.number().min(20).max(300),
  heightMm: z.number().min(20).max(400),
  marginMm: z.number().min(0).max(30),
  qrSizeMm: z.number().min(0).max(80),
  qrPosition: z.enum(["none", "top-right", "bottom-right", "bottom-left"]),
  blocks: z.array(labelBlockSchema).max(24),
});

export const labelTemplateSchema = labelTemplateBodySchema.extend({
  id: uuidSchema,
  version: z.number().int(),
  isDefault: z.boolean(),
  createdAt: z.string(),
});

export const saveLabelTemplateInput = labelTemplateBodySchema.extend({
  /** Omitted creates; supplied publishes a new version of that template. */
  id: uuidSchema.optional(),
  isDefault: z.boolean().optional(),
});

export const getLabelTemplateInput = z.object({ id: uuidSchema });
export const deleteLabelTemplateInput = z.object({ id: uuidSchema });
export const listLabelTemplatesInput = z.object({ page: pageInputSchema.optional() });
export const listLabelTemplatesOutput = listOutput(labelTemplateSchema);

export type LabelBinding = z.infer<typeof labelBindingSchema>;
export type LabelBlock = z.infer<typeof labelBlockSchema>;
export type LabelTemplate = z.infer<typeof labelTemplateSchema>;
