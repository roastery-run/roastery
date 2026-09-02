/**
 * Webhook endpoints and their delivery attempts.
 *
 * The events they carry live in `events` (see org.ts) — the transactional
 * outbox, written in the same transaction as the change it describes. These
 * two tables are only about getting those events to somebody else's server.
 */
import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { webhookDeliveryStatusEnum, webhookEndpointStatusEnum } from "./enums";
import { events, organizations } from "./org";

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    description: text("description"),
    /**
     * Exact types (`inventory.green_lot.created`) or prefix wildcards
     * (`inventory.*`). Empty means every type, which is what a first
     * integration almost always wants.
     */
    eventTypes: text("event_types").array().notNull().default(sql`'{}'::text[]`),

    /**
     * The signing secret, AES-GCM ciphertext under a key-encryption key held
     * as a Worker secret.
     *
     * Not a hash: we have to SIGN with this value, so a one-way digest is not
     * available to us the way it is for an API key. Storing it in plaintext
     * would mean a database dump hands over the ability to forge every
     * customer's webhooks, so the KEK — which lives outside the database —
     * is what a leaked dump is missing.
     */
    secretCiphertext: text("secret_ciphertext").notNull(),
    secretIv: text("secret_iv").notNull(),

    /**
     * The PREVIOUS secret, kept live for a grace period after a rotation.
     *
     * Rotation is only safe if both secrets verify at once: an integrator
     * cannot deploy their new secret at the same instant we start signing with
     * it. During the overlap every request carries two signatures and either
     * one verifies.
     */
    previousSecretCiphertext: text("previous_secret_ciphertext"),
    previousSecretIv: text("previous_secret_iv"),
    previousSecretExpiresAt: timestamp("previous_secret_expires_at", { withTimezone: true }),

    status: webhookEndpointStatusEnum("status").notNull().default("active"),
    /** Reset by any success. Twenty in a row disables the endpoint. */
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    disabledReason: text("disabled_reason"),

    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("webhook_endpoints_org_created_idx").on(t.orgId, t.createdAt, t.id),
    // Fan-out reads only the live endpoints, and does it on every event.
    index("webhook_endpoints_org_status_idx").on(t.orgId, t.status),
  ],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** Denormalized so the deliveries list needs no join to filter by type. */
    eventType: text("event_type").notNull(),

    status: webhookDeliveryStatusEnum("status").notNull().default("pending"),
    attempt: integer("attempt").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastStatusCode: integer("last_status_code"),
    lastError: text("last_error"),
    lastDurationMs: integer("last_duration_ms"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * The whole reason fan-out can be retried safely.
     *
     * The cron sweeper and the inline enqueue both fan out the same event, and
     * a queue message can be redelivered. This index makes the second, third
     * and fourth attempt to create the same delivery a no-op at the database
     * level rather than a duplicate POST to a customer's server.
     */
    uniqueIndex("webhook_deliveries_endpoint_event_idx").on(t.endpointId, t.eventId),
    index("webhook_deliveries_org_created_idx").on(t.orgId, t.createdAt, t.id),
    index("webhook_deliveries_org_status_idx").on(t.orgId, t.status, t.createdAt),
    index("webhook_deliveries_endpoint_status_idx").on(t.endpointId, t.status),
  ],
);
