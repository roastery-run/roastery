import { OpenAPIHono } from "@hono/zod-openapi";
import { events as eventsTable, webhookDeliveries, webhookEndpoints } from "@roastery/db/schema";
import {
  createEndpointInput,
  deleteEndpointInput,
  EVENT_TYPES,
  getEndpointInput,
  listDeliveriesInput,
  listDeliveriesOutput,
  listEndpointsInput,
  listEndpointsOutput,
  listEventsInput,
  listEventsOutput,
  listEventTypesInput,
  listEventTypesOutput,
  redeliverInput,
  rotateSecretInput,
  updateEndpointInput,
  webhookDeliverySchema,
  webhookEndpointSchema,
  webhookEndpointWithSecretSchema,
} from "@roastery/schemas";
import { and, asc, eq, gt, type SQL, sql } from "drizzle-orm";
import { Conflict, NotFound } from "../lib/api/errors";
import { type RpcAppEnv, type RpcContext, registerRpc } from "../lib/api/rpc";
import { generateSecret, sealSecret } from "../lib/events/webhook-crypto";

export const webhooks = new OpenAPIHono<RpcAppEnv>();

function endpointDto(e: typeof webhookEndpoints.$inferSelect) {
  return {
    id: e.id,
    url: e.url,
    description: e.description ?? null,
    eventTypes: e.eventTypes,
    status: e.status,
    consecutiveFailures: e.consecutiveFailures,
    lastSuccessAt: e.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: e.lastFailureAt?.toISOString() ?? null,
    disabledReason: e.disabledReason ?? null,
    previousSecretExpiresAt: e.previousSecretExpiresAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}

function deliveryDto(d: typeof webhookDeliveries.$inferSelect) {
  return {
    id: d.id,
    endpointId: d.endpointId,
    eventId: d.eventId,
    eventType: d.eventType,
    status: d.status,
    attempt: d.attempt,
    nextAttemptAt: d.nextAttemptAt?.toISOString() ?? null,
    lastStatusCode: d.lastStatusCode ?? null,
    lastError: d.lastError ?? null,
    lastDurationMs: d.lastDurationMs ?? null,
    deliveredAt: d.deliveredAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

/* -------------------------------------------------------------- catalogue */

registerRpc(
  webhooks,
  {
    namespace: "webhooks",
    operation: "listEventTypes",
    summary: "Every event type this API publishes",
    description:
      "The integration contract. An endpoint may subscribe to any of these exactly, " +
      "to a prefix wildcard such as `inventory.*`, or to nothing at all — which " +
      "subscribes it to everything, including types added later.",
    input: listEventTypesInput,
    output: listEventTypesOutput,
    permission: "webhooks.read",
    module: "api",
    cacheable: { maxAgeSeconds: 300 },
  },
  async () => ({
    types: EVENT_TYPES.map((type) => ({
      type,
      resourceType: type.split(".").slice(0, 2).join("."),
    })),
  }),
);

/* -------------------------------------------------------------- endpoints */

registerRpc(
  webhooks,
  {
    namespace: "webhooks",
    operation: "listEndpoints",
    summary: "List webhook endpoints",
    input: listEndpointsInput,
    output: listEndpointsOutput,
    permission: "webhooks.read",
    module: "api",
    cacheable: { maxAgeSeconds: 15 },
  },
  async (input, ctx) => {
    const { items, page } = await ctx.db.find(webhookEndpoints, {
      where: input.filter?.status ? eq(webhookEndpoints.status, input.filter.status) : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return { items: items.map(endpointDto), page };
  },
);

registerRpc(
  webhooks,
  {
    namespace: "webhooks",
    operation: "getEndpoint",
    summary: "Get one webhook endpoint",
    input: getEndpointInput,
    output: webhookEndpointSchema,
    permission: "webhooks.read",
    module: "api",
    cacheable: { maxAgeSeconds: 15 },
  },
  async (input, ctx) => {
    const e = await ctx.db.findOne(webhookEndpoints, eq(webhookEndpoints.id, input.id));
    if (!e) throw new NotFound("Endpoint not found");
    return endpointDto(e);
  },
);

registerRpc(
  webhooks,
  {
    namespace: "webhooks",
    operation: "createEndpoint",
    summary: "Register a webhook endpoint",
    description:
      "Returns the signing secret ONCE. It is stored encrypted and is never readable " +
      "again — an integrator who loses it rotates rather than retrieves. Verify a " +
      'delivery by computing `HMAC-SHA256(secret, "{Roastery-Timestamp}.{raw body}")` ' +
      "and comparing it against any of the values in `Roastery-Signature`.",
    input: createEndpointInput,
    output: webhookEndpointWithSecretSchema,
    permission: "webhooks.write",
    module: "api",
  },
  async (input, ctx) => {
    const secret = generateSecret();
    const sealed = await sealSecret(ctx.env.WEBHOOK_KEK, secret);

    const created = await ctx.db.transaction(async (tx) => {
      const [row] = await tx.insert(webhookEndpoints, {
        url: input.url,
        description: input.description ?? null,
        eventTypes: input.eventTypes,
        secretCiphertext: sealed.ciphertext,
        secretIv: sealed.iv,
        createdBy: ctx.actor.userId,
      });
      if (!row) throw new Error("Insert returned no row");
      await tx.emit({
        // Not published as a webhook: an endpoint learning about its own
        // creation is a loop nobody asked for, and the fact still belongs in
        // the audit log.
        type: null,
        resourceType: "webhook_endpoint",
        resourceId: row.id,
        action: "created",
        audit: { url: input.url, eventTypes: input.eventTypes },
      });
      return row;
    });

    return { ...endpointDto(created), secret };
  },
);

registerRpc(
  webhooks,
  {
    namespace: "webhooks",
    operation: "updateEndpoint",
    summary: "Change an endpoint's subscription or status",
    description:
      "Setting status to `active` also clears the consecutive-failure count, which is " +
      "how an auto-disabled endpoint is brought back once its server is fixed.",
    input: updateEndpointInput,
    output: webhookEndpointSchema,
    permission: "webhooks.write",
    module: "api",
  },
  async (input, ctx) => {
    const existing = await ctx.db.findOne(webhookEndpoints, eq(webhookEndpoints.id, input.id));
    if (!existing) throw new NotFound("Endpoint not found");

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.description !== undefined) patch.description = input.description ?? null;
    if (input.eventTypes !== undefined) patch.eventTypes = input.eventTypes;
    if (input.status !== undefined) {
      patch.status = input.status;
      if (input.status === "active") {
        // Re-enabling without this leaves the endpoint one failure from being
        // switched off again, which reads as the fix not having worked.
        patch.consecutiveFailures = 0;
        patch.disabledAt = null;
        patch.disabledReason = null;
      } else {
        patch.disabledAt = new Date();
        patch.disabledReason = "Disabled by a user";
      }
    }

    const updated = await ctx.db.transaction(async (tx) => {
      const [row] = await tx.update(webhookEndpoints, patch, eq(webhookEndpoints.id, input.id));
      if (!row) throw new NotFound("Endpoint not found");
      await tx.emit({
        type: null,
        resourceType: "webhook_endpoint",
        resourceId: row.id,
        action: "updated",
        audit: { from: existing.status, to: row.status, eventTypes: row.eventTypes },
      });
      return row;
    });
    return endpointDto(updated);
  },
);

registerRpc(
  webhooks,
  {
    namespace: "webhooks",
    operation: "rotateSecret",
    summary: "Issue a new signing secret",
    description:
      "During the overlap window every delivery carries TWO signatures and either " +
      "verifies, so the new secret can be deployed whenever the integrator gets to it " +
      "rather than at the same instant we start using it. Set `overlapMinutes` to 0 to " +
      "cut over immediately, which is what you want after a leak.",
    input: rotateSecretInput,
    output: webhookEndpointWithSecretSchema,
    permission: "webhooks.write",
    module: "api",
  },
  async (input, ctx) => {
    const existing = await ctx.db.findOne(webhookEndpoints, eq(webhookEndpoints.id, input.id));
    if (!existing) throw new NotFound("Endpoint not found");

    const secret = generateSecret();
    const sealed = await sealSecret(ctx.env.WEBHOOK_KEK, secret);
    const overlapMs = input.overlapMinutes * 60_000;

    const updated = await ctx.db.transaction(async (tx) => {
      const [row] = await tx.update(
        webhookEndpoints,
        {
          secretCiphertext: sealed.ciphertext,
          secretIv: sealed.iv,
          previousSecretCiphertext: overlapMs > 0 ? existing.secretCiphertext : null,
          previousSecretIv: overlapMs > 0 ? existing.secretIv : null,
          previousSecretExpiresAt: overlapMs > 0 ? new Date(Date.now() + overlapMs) : null,
          updatedAt: new Date(),
        },
        eq(webhookEndpoints.id, input.id),
      );
      if (!row) throw new NotFound("Endpoint not found");
      await tx.emit({
        type: null,
        resourceType: "webhook_endpoint",
        resourceId: row.id,
        action: "secret_rotated",
        audit: { overlapMinutes: input.overlapMinutes },
      });
      return row;
    });

    return { ...endpointDto(updated), secret };
  },
);

registerRpc(
  webhooks,
  {
    namespace: "webhooks",
    operation: "deleteEndpoint",
    summary: "Remove a webhook endpoint",
    input: deleteEndpointInput,
    // The endpoint as it last was. A bare `{ok:true}` gives the caller nothing
    // to log and nothing to show the user about what they just removed.
    output: webhookEndpointSchema,
    permission: "webhooks.write",
    module: "api",
  },
  async (input, ctx) => {
    const existing = await ctx.db.findOne(webhookEndpoints, eq(webhookEndpoints.id, input.id));
    if (!existing) throw new NotFound("Endpoint not found");

    await ctx.db.transaction(async (tx) => {
      const n = await tx.delete(webhookEndpoints, eq(webhookEndpoints.id, input.id));
      if (n === 0) throw new NotFound("Endpoint not found");
      await tx.emit({
        type: null,
        resourceType: "webhook_endpoint",
        resourceId: input.id,
        action: "deleted",
        audit: { url: existing.url },
      });
    });
    return endpointDto(existing);
  },
);

/* ------------------------------------------------------------- deliveries */

registerRpc(
  webhooks,
  {
    namespace: "webhooks",
    operation: "listDeliveries",
    summary: "Delivery attempts and their outcomes",
    description:
      "The screen somebody debugging a broken integration is already looking at: what " +
      "was sent, what came back, and when the next attempt is due.",
    input: listDeliveriesInput,
    output: listDeliveriesOutput,
    permission: "webhooks.read",
    module: "api",
    cacheable: { maxAgeSeconds: 10 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    if (input.filter?.endpointId) {
      clauses.push(eq(webhookDeliveries.endpointId, input.filter.endpointId));
    }
    if (input.filter?.status) clauses.push(eq(webhookDeliveries.status, input.filter.status));
    if (input.filter?.eventType) {
      clauses.push(eq(webhookDeliveries.eventType, input.filter.eventType));
    }
    const { items, page } = await ctx.db.find(webhookDeliveries, {
      where: clauses.length ? and(...clauses) : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return { items: items.map(deliveryDto), page };
  },
);

registerRpc(
  webhooks,
  {
    namespace: "webhooks",
    operation: "redeliver",
    summary: "Send a delivery again",
    description:
      "Resets the attempt schedule and re-queues. The receiver sees the same event id, " +
      "so a receiver that deduplicates on it — which the docs ask for — treats a " +
      "redelivery of something it already handled as a no-op.",
    input: redeliverInput,
    output: webhookDeliverySchema,
    permission: "webhooks.write",
    module: "api",
  },
  async (input, ctx) => {
    const delivery = await ctx.db.findOne(webhookDeliveries, eq(webhookDeliveries.id, input.id));
    if (!delivery) throw new NotFound("Delivery not found");

    const endpoint = await ctx.db.findOne(
      webhookEndpoints,
      eq(webhookEndpoints.id, delivery.endpointId),
    );
    if (!endpoint) throw new NotFound("Endpoint not found");
    if (endpoint.status !== "active") {
      throw new Conflict("Re-enable the endpoint before redelivering to it");
    }

    const [reset] = await ctx.db.update(
      webhookDeliveries,
      {
        status: "pending",
        attempt: 0,
        nextAttemptAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      },
      eq(webhookDeliveries.id, input.id),
    );
    if (!reset) throw new NotFound("Delivery not found");

    await enqueueDelivery(ctx, input.id);
    return deliveryDto(reset);
  },
);

async function enqueueDelivery(ctx: RpcContext, deliveryId: string): Promise<void> {
  if (!ctx.env.WEBHOOK_QUEUE) {
    // No queue binding (local dev without queues): the cron sweeper picks it
    // up from `nextAttemptAt` instead, so this degrades to a delay rather
    // than to silence.
    return;
  }
  await ctx.env.WEBHOOK_QUEUE.send({ deliveryId, attempt: 0 });
}

/* ----------------------------------------------------------------- events */

registerRpc(
  webhooks,
  {
    namespace: "webhooks",
    operation: "listEvents",
    summary: "The raw event feed",
    description:
      "Everything the organization has emitted, whether or not an endpoint was " +
      "subscribed. This is the polling fallback for an integrator who cannot expose " +
      "a public URL — and the reason a firewalled ERP is not shut out of the platform.",
    input: listEventsInput,
    output: listEventsOutput,
    permission: "webhooks.read",
    module: "api",
    cacheable: { maxAgeSeconds: 10 },
  },
  async (input, ctx) => {
    const limit = input.limit;
    const rows = await ctx.db.query(async (t, scope) =>
      t
        .select()
        .from(eventsTable)
        .where(
          and(
            scope(eventsTable),
            input.filter?.type ? eq(eventsTable.type, input.filter.type) : sql`true`,
            input.filter?.afterSequence !== undefined
              ? gt(eventsTable.sequence, input.filter.afterSequence)
              : sql`true`,
          ),
        )
        .orderBy(asc(eventsTable.sequence))
        .limit(limit + 1),
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: items.map((e) => ({
        id: e.id,
        type: e.type,
        sequence: Number(e.sequence),
        resourceType: e.resourceType,
        resourceId: e.resourceId,
        // jsonb, so the driver types it `unknown`. Every writer goes through
        // `emit`, whose payload is a Record.
        payload: (e.payload ?? {}) as Record<string, unknown>,
        occurredAt: e.occurredAt.toISOString(),
      })),
      nextSequence: items.length ? Number(items[items.length - 1]?.sequence) : null,
      hasMore,
    };
  },
);
