import { OpenAPIHono } from "@hono/zod-openapi";
import { greenLots, samples } from "@roastery/db/schema";
import {
  createSampleInput,
  getSampleInput,
  listSamplesInput,
  listSamplesOutput,
  sampleSchema,
  transferSampleToInventoryInput,
  updateSampleStatusInput,
} from "@roastery/schemas";
import { and, eq, ilike, inArray, type SQL, sql } from "drizzle-orm";
import { BadRequest, Conflict, NotFound } from "../../lib/api/errors";
import { type RpcAppEnv, registerRpc } from "../../lib/api/rpc";
import { isUniqueViolation } from "../../lib/db/db";
import { applyInventoryTransaction, recordTransformation } from "../../lib/domain/inventory";

export const sourcingSample = new OpenAPIHono<RpcAppEnv>();

/** Statuses where the sample is waiting on a decision from us. */
const PENDING_STATUSES = ["requested", "in_transit", "received", "roasted", "cupped"] as const;

function toDto(s: typeof samples.$inferSelect) {
  return {
    id: s.id,
    sampleNumber: s.sampleNumber,
    sampleType: s.sampleType,
    status: s.status,
    name: s.name,
    partnerId: s.partnerId ?? null,
    producerId: s.producerId ?? null,
    contractId: s.contractId ?? null,
    greenLotId: s.greenLotId ?? null,
    poNumber: s.poNumber ?? null,
    salesNumber: s.salesNumber ?? null,
    trackingNumbers: s.trackingNumbers ?? [],
    weightKg: s.weightKg ?? null,
    requestedAt: s.requestedAt?.toISOString() ?? null,
    receivedAt: s.receivedAt?.toISOString() ?? null,
    dueAt: s.dueAt?.toISOString() ?? null,
    decidedAt: s.decidedAt?.toISOString() ?? null,
    decisionNotes: s.decisionNotes ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}

registerRpc(
  sourcingSample,
  {
    namespace: "sourcing.sample",
    operation: "listSamples",
    summary: "List samples",
    description:
      "The sample pipeline, from offer through arrival. A sample is evaluated rather " +
      "than stocked: its purpose is the decision it informs.",
    input: listSamplesInput,
    output: listSamplesOutput,
    permission: "sourcing.sample.read",
    module: "samples",
    cacheable: { maxAgeSeconds: 20 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    const f = input.filter;
    if (f?.status) clauses.push(eq(samples.status, f.status));
    if (f?.sampleType) clauses.push(eq(samples.sampleType, f.sampleType));
    if (f?.partnerId) clauses.push(eq(samples.partnerId, f.partnerId));
    if (f?.contractId) clauses.push(eq(samples.contractId, f.contractId));
    if (f?.pendingOnly) clauses.push(inArray(samples.status, [...PENDING_STATUSES]));
    if (f?.trackingNumber) {
      // Couriers are chased by tracking number far more often than by our id.
      clauses.push(sql`${samples.trackingNumbers} @> ARRAY[${f.trackingNumber}]::text[]`);
    }
    if (f?.q) clauses.push(ilike(samples.name, `%${f.q}%`));

    const { items, page } = await ctx.db.find(samples, {
      where: clauses.length ? and(...clauses) : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return { items: items.map(toDto), page };
  },
);

registerRpc(
  sourcingSample,
  {
    namespace: "sourcing.sample",
    operation: "getSample",
    summary: "Get one sample",
    input: getSampleInput,
    output: sampleSchema,
    permission: "sourcing.sample.read",
    module: "samples",
    cacheable: { maxAgeSeconds: 20 },
  },
  async (input, ctx) => {
    const row = await ctx.db.findOne(samples, eq(samples.id, input.id));
    if (!row) throw new NotFound("Sample not found");
    return toDto(row);
  },
);

registerRpc(
  sourcingSample,
  {
    namespace: "sourcing.sample",
    operation: "createSample",
    summary: "Register a sample",
    input: createSampleInput,
    output: sampleSchema,
    permission: "sourcing.sample.write",
    module: "samples",
  },
  async (input, ctx) => {
    try {
      const [row] = await ctx.db.insert(samples, {
        ...input,
        trackingNumbers: input.trackingNumbers ?? [],
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        requestedAt: new Date(),
      });
      if (!row) throw new Error("Insert returned no row");
      return toDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Conflict(`Sample "${input.sampleNumber}" already exists`);
      }
      throw err;
    }
  },
);

registerRpc(
  sourcingSample,
  {
    namespace: "sourcing.sample",
    operation: "updateSampleStatus",
    summary: "Move a sample through its lifecycle",
    description:
      "Approving or rejecting stamps a decision time, so 'how long did we sit on this' " +
      "is answerable — the metric a supplier will eventually ask about.",
    input: updateSampleStatusInput,
    output: sampleSchema,
    permission: "sourcing.sample.approve",
    module: "samples",
  },
  async (input, ctx) => {
    const patch: Record<string, unknown> = { status: input.status, updatedAt: new Date() };
    if (input.decisionNotes !== undefined) patch.decisionNotes = input.decisionNotes;
    if (input.trackingNumbers !== undefined) patch.trackingNumbers = input.trackingNumbers;
    if (input.status === "received") patch.receivedAt = new Date();
    if (input.status === "approved" || input.status === "rejected") patch.decidedAt = new Date();

    const row = await ctx.db.transaction(async (tx) => {
      const [updated] = await tx.update(samples, patch, eq(samples.id, input.id));
      if (!updated) throw new NotFound("Sample not found");
      await tx.emit({
        type: "sourcing.sample.status_changed",
        resourceType: "sample",
        resourceId: updated.id,
        payload: {
          id: updated.id,
          sampleNumber: updated.sampleNumber,
          status: updated.status,
          decisionNotes: updated.decisionNotes ?? null,
        },
      });
      return updated;
    });
    return toDto(row);
  },
);

registerRpc(
  sourcingSample,
  {
    namespace: "sourcing.sample",
    operation: "transferSampleToInventory",
    summary: "Turn an approved sample into a green lot",
    description:
      "For spot lots bought off a sample. Creates a lot with the sample's provenance and " +
      "books its weight through the ledger, then links the two so the lot's quality " +
      "history reaches back to what was cupped.",
    input: transferSampleToInventoryInput,
    output: sampleSchema,
    permission: "sourcing.sample.write",
    module: "samples",
  },
  async (input, ctx) => {
    const sample = await ctx.db.findOne(samples, eq(samples.id, input.id));
    if (!sample) throw new NotFound("Sample not found");
    // Transferring an un-approved sample would put coffee into stock that the
    // QC team has not signed off on.
    if (sample.status !== "approved") {
      throw new BadRequest(
        `Only an approved sample can be transferred; this one is ${sample.status}.`,
      );
    }
    if (sample.greenLotId) throw new Conflict("This sample has already been transferred");

    await ctx.db.transaction(async (tx) => {
      let lot: typeof greenLots.$inferSelect | undefined;
      try {
        [lot] = await tx.insert(greenLots, {
          name: sample.name,
          lotCode: input.lotCode,
          producerId: sample.producerId,
          partnerId: sample.partnerId,
          initialWeightKg: input.weightKg,
          currentWeightKg: "0",
          defaultLocationId: input.locationId ?? null,
        });
      } catch (err) {
        if (isUniqueViolation(err))
          throw new Conflict(`Lot code "${input.lotCode}" already exists`);
        throw err;
      }
      if (!lot) throw new Error("Insert returned no row");

      await applyInventoryTransaction(tx, {
        greenLotId: lot.id,
        eventType: "receive",
        deltaKg: input.weightKg,
        locationId: input.locationId ?? null,
        comment: `Transferred from sample ${sample.sampleNumber}`,
      });

      if (sample.producerId) {
        await recordTransformation(tx, {
          sourceKind: "producer",
          sourceId: sample.producerId,
          targetKind: "green_lot",
          targetId: lot.id,
          weightKg: input.weightKg,
        });
      }

      await tx.update(
        samples,
        { greenLotId: lot.id, updatedAt: new Date() },
        eq(samples.id, sample.id),
      );
    });

    const updated = await ctx.db.findOne(samples, eq(samples.id, input.id));
    if (!updated) throw new NotFound("Sample not found");
    return toDto(updated);
  },
);
