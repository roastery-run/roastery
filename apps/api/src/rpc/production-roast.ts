import { OpenAPIHono } from "@hono/zod-openapi";
import {
  greenLots,
  machineBridgeTokens,
  roastBatches,
  roastEvents,
  roastedLots,
  roastProfiles,
  roastSamples,
} from "@roastery/db/schema";
import {
  completeRoastBatchInput,
  createProfileInput,
  getProfileInput,
  getRoastBatchInput,
  getRoastCurveInput,
  getRoastCurveOutput,
  importArtisanInput,
  importArtisanOutput,
  issueBridgeTokenInput,
  issueBridgeTokenOutput,
  listProfilesInput,
  listProfilesOutput,
  listRoastBatchesInput,
  listRoastBatchesOutput,
  roastBatchSchema,
  roastProfileSchema,
  startRoastBatchInput,
} from "@roastery/schemas";
import { and, asc, eq, type SQL } from "drizzle-orm";
import type { RoastBatchDO } from "../durable-objects/roast-batch";
import { parseArtisan } from "../lib/artisan";
import { sha256 } from "../lib/crypto";
import { isUniqueViolation } from "../lib/db";
import { BadRequest, Conflict, NotFound } from "../lib/errors";
import { applyInventoryTransaction, kg, recordTransformation } from "../lib/inventory";
import { buildPreview, deriveMetrics, flushRoast } from "../lib/roast-flush";
import { applyRoastedTransaction } from "../lib/roasted";
import { type RpcAppEnv, registerRpc } from "../lib/rpc";

export const productionRoast = new OpenAPIHono<RpcAppEnv>();

function profileDto(p: typeof roastProfiles.$inferSelect) {
  return {
    id: p.id,
    name: p.name,
    code: p.code,
    version: p.version,
    machineId: p.machineId ?? null,
    targetChargeKg: p.targetChargeKg ?? null,
    targetDropTempC: p.targetDropTempC ?? null,
    targetTotalTimeS: p.targetTotalTimeS ?? null,
    targetDtrPct: p.targetDtrPct ?? null,
    referenceCurve: p.referenceCurve ?? null,
    isActive: p.isActive,
    createdAt: p.createdAt.toISOString(),
  };
}

function batchDto(b: typeof roastBatches.$inferSelect) {
  return {
    id: b.id,
    batchNumber: b.batchNumber,
    machineId: b.machineId ?? null,
    profileId: b.profileId ?? null,
    status: b.status,
    purpose: b.purpose,
    chargeWeightKg: b.chargeWeightKg ?? null,
    dropWeightKg: b.dropWeightKg ?? null,
    weightLossPct: b.weightLossPct ?? null,
    totalTimeS: b.totalTimeS ?? null,
    firstCrackS: b.firstCrackS ?? null,
    dryEndS: b.dryEndS ?? null,
    developmentTimeS: b.developmentTimeS ?? null,
    dtrPct: b.dtrPct ?? null,
    dropTempC: b.dropTempC ?? null,
    maxRorCPerMin: b.maxRorCPerMin ?? null,
    curvePreview: b.curvePreview ?? null,
    sampleCount: b.sampleCount ?? null,
    startedAt: b.startedAt?.toISOString() ?? null,
    endedAt: b.endedAt?.toISOString() ?? null,
  };
}

/* --------------------------------------------------------------- profiles */

registerRpc(
  productionRoast,
  {
    namespace: "production.profile",
    operation: "listProfiles",
    summary: "List roast profiles",
    input: listProfilesInput,
    output: listProfilesOutput,
    permission: "production.profile.read",
    module: "roasting",
    cacheable: { maxAgeSeconds: 30 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    if (input.filter?.machineId) clauses.push(eq(roastProfiles.machineId, input.filter.machineId));
    if (input.filter?.isActive !== undefined) {
      clauses.push(eq(roastProfiles.isActive, input.filter.isActive));
    }
    const { items, page } = await ctx.db.find(roastProfiles, {
      where: clauses.length ? and(...clauses) : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return { items: items.map(profileDto), page };
  },
);

registerRpc(
  productionRoast,
  {
    namespace: "production.profile",
    operation: "getProfile",
    summary: "Get a roast profile",
    input: getProfileInput,
    output: roastProfileSchema,
    permission: "production.profile.read",
    module: "roasting",
    cacheable: { maxAgeSeconds: 30 },
  },
  async (input, ctx) => {
    const row = await ctx.db.findOne(roastProfiles, eq(roastProfiles.id, input.id));
    if (!row) throw new NotFound("Profile not found");
    return profileDto(row);
  },
);

registerRpc(
  productionRoast,
  {
    namespace: "production.profile",
    operation: "createProfile",
    summary: "Create a roast profile",
    input: createProfileInput,
    output: roastProfileSchema,
    permission: "production.profile.write",
    module: "roasting",
  },
  async (input, ctx) => {
    try {
      const [row] = await ctx.db.insert(roastProfiles, { ...input });
      if (!row) throw new Error("Insert returned no row");
      return profileDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw new Conflict(`Profile "${input.code}" already exists`);
      throw err;
    }
  },
);

/* ---------------------------------------------------------------- batches */

registerRpc(
  productionRoast,
  {
    namespace: "production.roast",
    operation: "listRoastBatches",
    summary: "List roast batches",
    input: listRoastBatchesInput,
    output: listRoastBatchesOutput,
    permission: "production.roast.read",
    module: "roasting",
    cacheable: { maxAgeSeconds: 15 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    const f = input.filter;
    if (f?.machineId) clauses.push(eq(roastBatches.machineId, f.machineId));
    if (f?.profileId) clauses.push(eq(roastBatches.profileId, f.profileId));
    if (f?.status) clauses.push(eq(roastBatches.status, f.status));
    const { items, page } = await ctx.db.find(roastBatches, {
      where: clauses.length ? and(...clauses) : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return { items: items.map(batchDto), page };
  },
);

registerRpc(
  productionRoast,
  {
    namespace: "production.roast",
    operation: "getRoastBatch",
    summary: "Get a roast batch",
    input: getRoastBatchInput,
    output: roastBatchSchema,
    permission: "production.roast.read",
    module: "roasting",
    cacheable: { maxAgeSeconds: 15 },
  },
  async (input, ctx) => {
    const row = await ctx.db.findOne(roastBatches, eq(roastBatches.id, input.id));
    if (!row) throw new NotFound("Batch not found");
    return batchDto(row);
  },
);

registerRpc(
  productionRoast,
  {
    namespace: "production.roast",
    operation: "startRoastBatch",
    summary: "Open a roast batch for streaming",
    description:
      "Creates the batch and opens its live session. Telemetry is then posted to " +
      "`/ingest/v1/roast/{batchId}/samples` by the machine bridge, and watched over " +
      "`/stream/v1/roast/{batchId}`.",
    input: startRoastBatchInput,
    output: roastBatchSchema,
    permission: "production.roast.write",
    module: "roasting",
  },
  async (input, ctx) => {
    let batch: typeof roastBatches.$inferSelect | undefined;
    try {
      [batch] = await ctx.db.insert(roastBatches, {
        batchNumber: input.batchNumber,
        machineId: input.machineId,
        profileId: input.profileId ?? null,
        locationId: input.locationId ?? null,
        chargeWeightKg: input.chargeWeightKg,
        status: "in_progress",
        startedAt: new Date(),
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new Conflict(`Batch "${input.batchNumber}" already exists`);
      throw err;
    }
    if (!batch) throw new Error("Insert returned no row");

    // Green is consumed at COMPLETION, not here: a batch that is aborted
    // before charge must not have taken coffee out of inventory.
    if (input.greenLotId) {
      await ctx.db.update(
        roastBatches,
        { notes: JSON.stringify({ greenLotId: input.greenLotId }) },
        eq(roastBatches.id, batch.id),
      );
    }

    const stub = ctx.env.ROAST_BATCH.get(
      ctx.env.ROAST_BATCH.idFromName(`${ctx.orgId}:${batch.id}`),
    ) as unknown as RoastBatchDO;
    await stub.open({ orgId: ctx.orgId, batchId: batch.id, profile: input.profileId });

    return batchDto(batch);
  },
);

registerRpc(
  productionRoast,
  {
    namespace: "production.roast",
    operation: "completeRoastBatch",
    summary: "Finish a roast and persist its curve",
    description:
      "Reads the buffered curve out of the live session, writes the full-fidelity copy " +
      "to object storage and a 1 Hz downsample to the database, derives the batch " +
      "metrics, and deducts the green consumed. The session buffer is discarded only " +
      "after those writes are CONFIRMED, so a failure leaves the curve recoverable.",
    input: completeRoastBatchInput,
    output: roastBatchSchema,
    permission: "production.roast.write",
    module: "roasting",
  },
  async (input, ctx) => {
    const batch = await ctx.db.findOne(roastBatches, eq(roastBatches.id, input.id));
    if (!batch) throw new NotFound("Batch not found");
    if (batch.status === "completed") throw new Conflict("This batch is already complete");

    const stub = ctx.env.ROAST_BATCH.get(
      ctx.env.ROAST_BATCH.idFromName(`${ctx.orgId}:${batch.id}`),
    ) as unknown as RoastBatchDO;

    const curve = await stub.readCurve();
    if (!curve.samples.length) throw new BadRequest("This batch has no telemetry to persist");

    await stub.complete();
    const result = await flushRoast(ctx.env, ctx.db, batch.id, curve, {
      dropWeightKg: input.dropWeightKg ?? null,
    });

    // A roast both CONSUMES green and PRODUCES roasted. Doing only the first
    // would leave a roastery whose green shrinks and whose sellable stock
    // never appears — the books balance to nothing.
    const meta = batch.notes ? (JSON.parse(batch.notes) as { greenLotId?: string }) : {};

    if (meta.greenLotId && batch.chargeWeightKg) {
      const txn = await applyInventoryTransaction(ctx.db, {
        greenLotId: meta.greenLotId,
        eventType: "roast_consume",
        deltaKg: kg.sub("0", batch.chargeWeightKg),
        roastBatchId: batch.id,
        comment: `Roasted as ${batch.batchNumber}`,
      });
      await recordTransformation(ctx.db, {
        sourceKind: "green_lot",
        sourceId: meta.greenLotId,
        targetKind: "roast_batch",
        targetId: batch.id,
        weightKg: batch.chargeWeightKg,
        transactionId: txn.id,
      });
    }

    // The roasted output, opened at zero and filled through its own ledger for
    // the same reason green is: no path may set a balance without a movement.
    const dropWeight = input.dropWeightKg ?? null;
    if (dropWeight) {
      const source = meta.greenLotId
        ? await ctx.db.findOne(greenLots, eq(greenLots.id, meta.greenLotId))
        : null;

      const [produced] = await ctx.db.insert(roastedLots, {
        name: source ? `${source.name} (roasted)` : batch.batchNumber,
        lotCode: `${batch.batchNumber}-R`,
        lotKind: "loose",
        roastBatchId: batch.id,
        initialWeightKg: dropWeight,
        currentWeightKg: "0",
        locationId: batch.locationId,
        roastedAt: new Date(),
        // Roasted coffee has a usable window measured in weeks, which is why
        // allocation is by expiry rather than by arrival order.
        bestBeforeAt: new Date(Date.now() + 42 * 86_400_000),
        status: "available",
      });

      if (produced) {
        await applyRoastedTransaction(ctx.db, {
          roastedLotId: produced.id,
          eventType: "receive",
          deltaKg: dropWeight,
          locationId: batch.locationId,
          comment: `Produced by ${batch.batchNumber}`,
        });
        // Closes the traceability chain: green lot -> roast batch -> roasted
        // lot, so a recall can walk either direction.
        await recordTransformation(ctx.db, {
          sourceKind: "roast_batch",
          sourceId: batch.id,
          targetKind: "roasted_lot",
          targetId: produced.id,
          weightKg: dropWeight,
        });
      }
    }

    // Only now is the buffer safe to drop.
    await stub.discard();
    void result;

    const updated = await ctx.db.findOne(roastBatches, eq(roastBatches.id, batch.id));
    if (!updated) throw new NotFound("Batch not found");
    return batchDto(updated);
  },
);

registerRpc(
  productionRoast,
  {
    namespace: "production.roast",
    operation: "getRoastCurve",
    summary: "A batch's curve and events",
    description:
      "Returns the 1 Hz downsample held in the database — enough resolution for every " +
      "comparison and deviation question. The full-fidelity curve lives in object " +
      "storage and is fetched separately.",
    input: getRoastCurveInput,
    output: getRoastCurveOutput,
    permission: "production.roast.read",
    module: "roasting",
    cacheable: { maxAgeSeconds: 60 },
  },
  async (input, ctx) => {
    const batch = await ctx.db.findOne(roastBatches, eq(roastBatches.id, input.id));
    if (!batch) throw new NotFound("Batch not found");

    // unscoped-ok: roast_samples and roast_events are TENANT_VIA — no org
    // column, reached through the batch, which was tenant-checked above.
    const samples = await ctx.db.query(async (t) =>
      t
        .select({
          t: roastSamples.t,
          beanTempC: roastSamples.beanTempC,
          envTempC: roastSamples.envTempC,
          rorCPerMin: roastSamples.rorCPerMin,
        })
        .from(roastSamples)
        .where(eq(roastSamples.batchId, batch.id))
        .orderBy(asc(roastSamples.t)),
    );

    // unscoped-ok: as above.
    const events = await ctx.db.query(async (t) =>
      t
        .select({
          kind: roastEvents.kind,
          atSeconds: roastEvents.atSeconds,
          note: roastEvents.note,
        })
        .from(roastEvents)
        .where(eq(roastEvents.batchId, batch.id))
        .orderBy(asc(roastEvents.atSeconds)),
    );

    return { batchId: batch.id, samples, events };
  },
);

/* ----------------------------------------------------------- bridge token */

registerRpc(
  productionRoast,
  {
    namespace: "catalog.machine",
    operation: "issueMachineBridgeToken",
    summary: "Issue a streaming credential for a machine",
    description:
      "Scoped to one machine and able to do nothing but stream telemetry. A shop-floor " +
      "PC is physically accessible and rarely patched, so it must never hold a " +
      "credential that could act on the rest of the organization.",
    input: issueBridgeTokenInput,
    output: issueBridgeTokenOutput,
    permission: "catalog.machine.write",
    module: "core",
  },
  async (input, ctx) => {
    const raw = `rb_${[...crypto.getRandomValues(new Uint8Array(24))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}`;
    const expiresAt = new Date(Date.now() + input.expiresInHours * 3_600_000);

    await ctx.db.insert(machineBridgeTokens, {
      machineId: input.machineId,
      tokenHash: await sha256(raw),
      tokenPrefix: raw.slice(0, 10),
      expiresAt,
    });

    // Returned once, like every other credential in the system.
    return { token: raw, machineId: input.machineId, expiresAt: expiresAt.toISOString() };
  },
);

/* ---------------------------------------------------------- artisan import */

registerRpc(
  productionRoast,
  {
    namespace: "production.roast",
    operation: "importArtisanRoast",
    summary: "Import a roast from an Artisan export",
    description:
      "Accepts Artisan JSON or CSV. Sample times are rebased against the charge index, " +
      "so a recorder left running before charge does not offset the whole curve.",
    input: importArtisanInput,
    output: importArtisanOutput,
    permission: "production.roast.write",
    module: "roasting",
  },
  async (input, ctx) => {
    const parsed = parseArtisan(input.content);
    const samples = parsed.samples.map((s) => ({
      t: s.t,
      bt: s.bt ?? 0,
      et: s.et,
      ror: null,
      gas: null,
      airflow: null,
    }));
    const events = parsed.events.map((e) => ({ t: e.t, kind: e.kind, note: null }));
    const metrics = deriveMetrics({ samples, events });

    let batch: typeof roastBatches.$inferSelect | undefined;
    try {
      [batch] = await ctx.db.insert(roastBatches, {
        batchNumber: input.batchNumber,
        machineId: input.machineId ?? null,
        status: "completed",
        purpose: "production",
        chargeWeightKg: parsed.weightInKg?.toFixed(4) ?? null,
        dropWeightKg: parsed.weightOutKg?.toFixed(4) ?? null,
        weightLossPct:
          parsed.weightInKg && parsed.weightOutKg
            ? (((parsed.weightInKg - parsed.weightOutKg) / parsed.weightInKg) * 100).toFixed(3)
            : null,
        curvePreview: buildPreview(samples),
        sampleCount: samples.length,
        totalTimeS: metrics.totalTimeS,
        firstCrackS: metrics.firstCrackS,
        dryEndS: metrics.dryEndS,
        developmentTimeS: metrics.developmentTimeS,
        dtrPct: metrics.dtrPct,
        dropTempC: metrics.dropTempC,
        startedAt: parsed.roastedAt ? new Date(parsed.roastedAt) : null,
        endedAt: parsed.roastedAt ? new Date(parsed.roastedAt) : null,
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new Conflict(`Batch "${input.batchNumber}" already exists`);
      throw err;
    }
    if (!batch) throw new Error("Insert returned no row");

    // unscoped-ok: roast_samples is TENANT_VIA, reached through the batch just
    // created above under this organization.
    if (samples.length) {
      await ctx.db.query(async (t) =>
        t
          .insert(roastSamples)
          .values(
            samples.map((s) => ({
              batchId: batch.id,
              t: s.t.toFixed(2),
              beanTempC: s.bt.toFixed(2),
              envTempC: s.et?.toFixed(2) ?? null,
            })),
          )
          .onConflictDoNothing(),
      );
    }

    // unscoped-ok: roast_events is TENANT_VIA, as above.
    if (events.length) {
      await ctx.db.query(async (t) =>
        t.insert(roastEvents).values(
          events.map((e) => ({
            batchId: batch.id,
            kind: e.kind as typeof roastEvents.$inferInsert.kind,
            atSeconds: e.t.toFixed(2),
          })),
        ),
      );
    }

    return {
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      sampleCount: samples.length,
      eventCount: events.length,
      source: parsed.source,
    };
  },
);
