import { z } from "zod";
import { listOutput, pageInputSchema, uuidSchema } from "./common";

/**
 * The published event catalogue.
 *
 * This list is the integration contract. It is a closed enum rather than a
 * free string so that a typo in an endpoint's subscription is rejected at
 * creation time — the alternative is an endpoint that silently receives
 * nothing and an integrator who cannot tell whether the events are missing or
 * their filter is wrong.
 *
 * Types are `{domain}.{resource}.{past-tense verb}`. Past tense matters: a
 * webhook reports something that has already committed, never something about
 * to happen, and naming them that way stops anyone treating one as a command.
 */
export const eventTypeSchema = z.enum([
  "catalog.location.created",
  "catalog.location.updated",
  "catalog.product.created",
  "catalog.product.updated",
  "catalog.partner.created",
  "catalog.machine.registered",

  "inventory.green_lot.created",
  "inventory.green_lot.adjusted",
  "inventory.green_lot.split",
  "inventory.green_lot.transferred",
  "inventory.green_lot.quarantined",
  "inventory.green_lot.released",
  "inventory.roasted_lot.created",
  "inventory.roasted_lot.adjusted",

  "sourcing.contract.created",
  "sourcing.contract.shipment_received",
  "sourcing.sample.created",
  "sourcing.sample.status_changed",

  "production.roast_batch.started",
  "production.roast_batch.completed",
  "production.schedule.released",

  "quality.cupping_session.finalized",
  "quality.grading.recorded",

  "orders.order.created",
  "orders.order.confirmed",
  "orders.order.allocated",

  "cafe.site.created",
  "cafe.machine.registered",
  "cafe.shots.recorded",
  "cafe.anomaly.detected",
  "cafe.pos.reconciled",

  "traceability.certificate.issued",
  "reporting.report.ready",
]);
export type EventType = z.infer<typeof eventTypeSchema>;

export const EVENT_TYPES = eventTypeSchema.options;

/**
 * A subscription filter: an exact type, a prefix wildcard (`inventory.*`,
 * `inventory.green_lot.*`), or `*` for everything.
 */
export const eventTypeFilterSchema = z
  .string()
  .min(1)
  .max(120)
  .refine(
    (v) =>
      v === "*" ||
      EVENT_TYPES.includes(v as EventType) ||
      (v.endsWith(".*") && EVENT_TYPES.some((t) => t.startsWith(v.slice(0, -1)))),
    { message: "Not a known event type or wildcard over one" },
  );

export const webhookEndpointStatusSchema = z.enum(["active", "disabled", "auto_disabled"]);
export const webhookDeliveryStatusSchema = z.enum(["pending", "succeeded", "failed", "dead"]);

export const webhookEndpointSchema = z.object({
  id: uuidSchema,
  url: z.string(),
  description: z.string().nullable(),
  eventTypes: z.array(z.string()),
  status: webhookEndpointStatusSchema,
  consecutiveFailures: z.number().int(),
  lastSuccessAt: z.string().nullable(),
  lastFailureAt: z.string().nullable(),
  disabledReason: z.string().nullable(),
  /** Set only during a rotation overlap, so the console can show a countdown. */
  previousSecretExpiresAt: z.string().nullable(),
  createdAt: z.string(),
});

/**
 * The secret is returned EXACTLY ONCE, by the call that mints it.
 *
 * It is never readable afterwards, because it is stored encrypted under a key
 * the API holds and there is no product reason to hand it back — an integrator
 * who lost it rotates. Returning it on read would turn every `webhooks.read`
 * grant into the ability to forge signatures.
 */
export const webhookEndpointWithSecretSchema = webhookEndpointSchema.extend({
  secret: z.string().describe("Shown once. Store it now; it cannot be retrieved later."),
});

export const listEndpointsInput = z.object({
  filter: z.object({ status: webhookEndpointStatusSchema.optional() }).optional(),
  page: pageInputSchema,
});
export const listEndpointsOutput = listOutput(webhookEndpointSchema);

export const getEndpointInput = z.object({ id: uuidSchema });

export const createEndpointInput = z.object({
  url: z
    .string()
    .url()
    .max(2000)
    .refine((v) => v.startsWith("https://"), {
      message: "Webhook URLs must be https — a signature does not protect a payload in transit",
    }),
  description: z.string().max(500).optional(),
  /** Empty subscribes to everything, including types added later. */
  eventTypes: z.array(eventTypeFilterSchema).max(50).default([]),
});

export const updateEndpointInput = z.object({
  id: uuidSchema,
  description: z.string().max(500).nullish(),
  eventTypes: z.array(eventTypeFilterSchema).max(50).optional(),
  /** Re-enables an endpoint that auto-disabled, and resets its failure count. */
  status: z.enum(["active", "disabled"]).optional(),
});

export const deleteEndpointInput = z.object({ id: uuidSchema });

export const rotateSecretInput = z.object({
  id: uuidSchema,
  /**
   * How long the old secret keeps verifying. Zero cuts over immediately, which
   * is what you want after a leak and not what you want otherwise.
   */
  overlapMinutes: z.number().int().min(0).max(10_080).default(1440),
});

export const webhookDeliverySchema = z.object({
  id: uuidSchema,
  endpointId: uuidSchema,
  eventId: uuidSchema,
  eventType: z.string(),
  status: webhookDeliveryStatusSchema,
  attempt: z.number().int(),
  nextAttemptAt: z.string().nullable(),
  lastStatusCode: z.number().int().nullable(),
  lastError: z.string().nullable(),
  lastDurationMs: z.number().int().nullable(),
  deliveredAt: z.string().nullable(),
  createdAt: z.string(),
});

export const listDeliveriesInput = z.object({
  filter: z
    .object({
      endpointId: uuidSchema.optional(),
      status: webhookDeliveryStatusSchema.optional(),
      eventType: z.string().max(120).optional(),
    })
    .optional(),
  page: pageInputSchema,
});
export const listDeliveriesOutput = listOutput(webhookDeliverySchema);

export const redeliverInput = z.object({ id: uuidSchema });

export const listEventTypesInput = z.object({});
export const listEventTypesOutput = z.object({
  types: z.array(z.object({ type: z.string(), resourceType: z.string() })),
});

export const eventSchema = z.object({
  id: uuidSchema,
  type: z.string(),
  sequence: z.number(),
  resourceType: z.string(),
  resourceId: z.string(),
  payload: z.unknown(),
  occurredAt: z.string(),
});

/**
 * The polling feed is keyed on `sequence`, not on a timestamp.
 *
 * A consumer catching up asks "everything after what I last saw", and the only
 * honest answer to that is a monotonic counter. Paginating this feed by
 * `occurredAt` while handing the consumer a `sequence` to order by would be
 * actively misleading: an event written late but timestamped earlier would
 * appear before rows the consumer had already passed, and it would never see
 * it again.
 */
export const listEventsInput = z.object({
  filter: z
    .object({
      type: z.string().max(120).optional(),
      /** Exclusive watermark. Poll with the highest sequence you have stored. */
      afterSequence: z.number().int().min(0).optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

export const listEventsOutput = z.object({
  /** Ascending by sequence: the order a consumer should apply them in. */
  items: z.array(eventSchema),
  /** Pass back as `afterSequence` to continue. Null when nothing was returned. */
  nextSequence: z.number().nullable(),
  hasMore: z.boolean(),
});
