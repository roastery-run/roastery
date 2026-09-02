import { z } from "zod";
import { listOutput, pageInputSchema, uuidSchema } from "./common";

/**
 * Custom form fields.
 *
 * The rule this exists to serve: JSONB for the long tail, real columns for
 * anything in a WHERE, ORDER BY or AVG(). The ten SCA attributes and the total
 * are columns because every report aggregates them; a roaster's own "gut
 * feeling 1-5" lives in `responses` forever and no report will ever group by
 * it. Making that second kind a column per customer is how a schema dies.
 *
 * Templates are immutable per version and a response records the version it
 * was filled against, so a sheet from 2023 still renders as it was filled.
 */

export const formTemplateKindSchema = z.enum([
  "cupping_sheet",
  "green_grading",
  "roast_qc",
  "brew_feedback",
  "sample_intake",
]);

export const formFieldSchema = z
  .object({
    /** Stable across versions: it is the key in `responses`. */
    key: z
      .string()
      .min(1)
      .max(40)
      .regex(
        /^[a-z][a-z0-9_]*$/,
        "A key is lower case letters, digits and underscores, starting with a letter",
      ),
    label: z.string().min(1, "Needs a label").max(120),
    type: z.enum(["number", "text", "select", "boolean"]),
    required: z.boolean().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    options: z.array(z.string().min(1).max(80)).max(40).optional(),
    help: z.string().max(200).optional(),
  })
  .refine((f) => f.type !== "select" || (f.options?.length ?? 0) > 0, {
    message: "A select needs at least one option",
    path: ["options"],
  })
  .refine((f) => f.min === undefined || f.max === undefined || f.min <= f.max, {
    message: "Minimum must not exceed maximum",
    path: ["min"],
  });

export const formTemplateBodySchema = z.object({
  kind: formTemplateKindSchema,
  name: z.string().min(1).max(200),
  fields: z.array(formFieldSchema).max(50),
});

export const formTemplateSchema = formTemplateBodySchema.extend({
  id: uuidSchema,
  version: z.number().int(),
  isDefault: z.boolean(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const saveFormTemplateInput = formTemplateBodySchema.extend({
  id: uuidSchema.optional(),
  isDefault: z.boolean().optional(),
});

export const getFormTemplateInput = z.object({ id: uuidSchema });
export const archiveFormTemplateInput = z.object({ id: uuidSchema });
export const listFormTemplatesInput = z.object({
  filter: z.object({ kind: formTemplateKindSchema.optional() }).optional(),
  page: pageInputSchema.optional(),
});
export const listFormTemplatesOutput = listOutput(formTemplateSchema);

export type FormField = z.infer<typeof formFieldSchema>;
export type FormTemplate = z.infer<typeof formTemplateSchema>;
export type FormTemplateKind = z.infer<typeof formTemplateKindSchema>;

/**
 * Compiles a template to a validator.
 *
 * The builder's preview and the runtime form share this one path, so a field
 * that validates in the preview validates identically when a cupper fills it.
 * Two implementations of the same rules is how a preview starts lying.
 */
export function templateToZod(fields: FormField[]): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    let schema: z.ZodTypeAny;
    switch (field.type) {
      case "number": {
        let n = z.number();
        if (field.min !== undefined) n = n.min(field.min);
        if (field.max !== undefined) n = n.max(field.max);
        schema = n;
        break;
      }
      case "text":
        schema = z.string().max(2000);
        break;
      case "boolean":
        schema = z.boolean();
        break;
      case "select":
        // A response outside the option list is not a value the form could
        // have produced, so it is rejected rather than coerced.
        schema = z.enum((field.options ?? [""]) as [string, ...string[]]);
        break;
    }
    shape[field.key] = field.required ? schema : schema.optional();
  }

  // Passthrough is deliberate: a response filled against version 3 keeps its
  // answers when read back through version 4, which dropped a field. Stripping
  // them would quietly destroy data a template edit never asked to destroy.
  return z.object(shape).passthrough() as z.ZodType<Record<string, unknown>>;
}

/**
 * The first thing wrong with a set of answers, phrased with the field's own
 * label.
 *
 * Zod's raw message for a missing required number is "expected number,
 * received undefined", which is true and useless to a cupper standing at a
 * table with a spoon. The label is the only part they can act on.
 */
export function firstResponseProblem(
  fields: FormField[],
  values: Record<string, unknown>,
): string | null {
  if (!fields.length) return null;
  const parsed = templateToZod(fields).safeParse(values);
  if (parsed.success) return null;

  const issue = parsed.error.issues[0];
  if (!issue) return null;
  const key = String(issue.path[0] ?? "");
  const field = fields.find((f) => f.key === key);
  const name = field?.label || key || "A field";

  // "Required" reads as an instruction; every other issue is a correction.
  return values[key] === undefined || values[key] === ""
    ? `${name} is required`
    : `${name}: ${issue.message}`;
}
