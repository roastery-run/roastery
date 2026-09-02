import { z } from "zod";

/**
 * What needs attention right now.
 *
 * Deliberately the LIVE scan rather than the notification log. The log records
 * what was emailed and exists to stop a second send; a person opening the
 * console wants what is still outstanding, which is a different question — an
 * alert emailed this morning and resolved at ten should not still be shouting.
 */
export const alertSeveritySchema = z.enum(["info", "warning", "critical"]);

export const alertSchema = z.object({
  ruleId: z.string(),
  subjectId: z.string(),
  severity: alertSeveritySchema,
  message: z.string(),
  /** When the daily digest last carried this one, if it has. */
  notifiedAt: z.string().nullable(),
});

export const listAlertsInput = z.object({
  filter: z.object({ severity: alertSeveritySchema.optional() }).optional(),
});

export const listAlertsOutput = z.object({
  items: z.array(alertSchema),
  counts: z.object({
    critical: z.number().int(),
    warning: z.number().int(),
    info: z.number().int(),
  }),
});
