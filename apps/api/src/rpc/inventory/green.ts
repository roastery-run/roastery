import { OpenAPIHono } from "@hono/zod-openapi";
import {
  greenLots,
  inventoryTransactions,
  locations,
  lotLocationBalances,
} from "@roastery/db/schema";
import {
  adjustGreenLotInput,
  getGreenLotInput,
  greenLotSchema,
  importGreenLotInput,
  listGreenLotsInput,
  listGreenLotsOutput,
  listTransactionsInput,
  listTransactionsOutput,
  lotBalancesInput,
  lotBalancesOutput,
  mergeGreenLotsInput,
  releaseGreenLotInput,
  reserveGreenLotInput,
  splitGreenLotInput,
  splitGreenLotOutput,
  transferGreenLotInput,
  transferGreenLotOutput,
} from "@roastery/schemas";
import { and, desc, eq, ilike, type SQL, sql } from "drizzle-orm";
import { BadRequest, Conflict, NotFound } from "../../lib/api/errors";
import { type RpcAppEnv, type RpcContext, registerRpc } from "../../lib/api/rpc";
import { isUniqueViolation } from "../../lib/db/db";
import {
  adjustReservation,
  applyInventoryTransaction,
  kg,
  recordTransformation,
  transferBetweenLocations,
} from "../../lib/domain/inventory";

export const inventoryGreen = new OpenAPIHono<RpcAppEnv>();

function toDto(r: typeof greenLots.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    lotCode: r.lotCode,
    supplierRef: r.supplierRef ?? null,
    producerId: r.producerId ?? null,
    partnerId: r.partnerId ?? null,
    parentLotId: r.parentLotId ?? null,
    state: r.state,
    status: r.status,
    varieties: r.varieties ?? [],
    processMethod: r.processMethod ?? null,
    harvestYear: r.harvestYear ?? null,
    certifications: r.certifications ?? [],
    initialWeightKg: r.initialWeightKg,
    currentWeightKg: r.currentWeightKg,
    reservedWeightKg: r.reservedWeightKg,
    // Computed rather than stored: it is always current minus reserved, and a
    // third stored number is a third thing that can drift.
    availableWeightKg: kg.sub(r.currentWeightKg, r.reservedWeightKg),
    minWeightKg: r.minWeightKg ?? null,
    bagCount: r.bagCount ?? null,
    bagWeightKg: r.bagWeightKg ?? null,
    unitCost: r.unitCost ?? null,
    currency: r.currency ?? null,
    totalValueBase: r.totalValueBase ?? null,
    defaultLocationId: r.defaultLocationId ?? null,
    registeredAt: r.registeredAt.toISOString(),
    notes: r.notes ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

async function loadLot(ctx: RpcContext, id: string) {
  const row = await ctx.db.findOne(greenLots, eq(greenLots.id, id));
  if (!row) throw new NotFound("Lot not found");
  return row;
}

registerRpc(
  inventoryGreen,
  {
    namespace: "inventory.green",
    operation: "listGreenLots",
    summary: "List green coffee lots",
    input: listGreenLotsInput,
    output: listGreenLotsOutput,
    permission: "inventory.green.read",
    module: "inventory",
    cacheable: { maxAgeSeconds: 15 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    const f = input.filter;
    if (f?.status) clauses.push(eq(greenLots.status, f.status));
    if (f?.state) clauses.push(eq(greenLots.state, f.state));
    if (f?.producerId) clauses.push(eq(greenLots.producerId, f.producerId));
    if (f?.partnerId) clauses.push(eq(greenLots.partnerId, f.partnerId));
    if (f?.belowMinimum) {
      // A lot with no minimum set can never be "below" it.
      clauses.push(sql`${greenLots.minWeightKg} is not null
        and ${greenLots.currentWeightKg} <= ${greenLots.minWeightKg}`);
    }
    if (f?.q) clauses.push(ilike(greenLots.name, `%${f.q}%`));

    const { items, page } = await ctx.db.find(greenLots, {
      where: clauses.length ? and(...clauses) : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return { items: items.map(toDto), page };
  },
);

registerRpc(
  inventoryGreen,
  {
    namespace: "inventory.green",
    operation: "getGreenLot",
    summary: "Get one green lot",
    input: getGreenLotInput,
    output: greenLotSchema,
    permission: "inventory.green.read",
    module: "inventory",
    cacheable: { maxAgeSeconds: 15 },
  },
  async (input, ctx) => toDto(await loadLot(ctx, input.id)),
);

registerRpc(
  inventoryGreen,
  {
    namespace: "inventory.green",
    operation: "importGreenLot",
    summary: "Bring a green lot into inventory",
    description:
      "Creates the lot at zero and books its opening weight as a `receive` ledger row, " +
      "so even the first gram has an audit trail. There is no path that sets a balance " +
      "without a corresponding movement.",
    input: importGreenLotInput,
    output: greenLotSchema,
    permission: "inventory.green.write",
    module: "inventory",
  },
  async (input, ctx) => {
    const weight = kg.normalize(input.weightKg);

    const created = await ctx.db.transaction(async (tx) => {
      let lot: typeof greenLots.$inferSelect | undefined;
      try {
        [lot] = await tx.insert(greenLots, {
          name: input.name,
          lotCode: input.lotCode,
          supplierRef: input.supplierRef ?? null,
          producerId: input.producerId ?? null,
          partnerId: input.partnerId ?? null,
          state: input.state,
          varieties: input.varieties ?? [],
          processMethod: input.processMethod ?? null,
          harvestYear: input.harvestYear ?? null,
          certifications: input.certifications ?? [],
          initialWeightKg: weight,
          // Opens at zero. The receive transaction below is what moves it, so
          // the ledger explains the whole balance rather than most of it.
          currentWeightKg: "0",
          bagCount: input.bagCount ?? null,
          bagWeightKg: input.bagWeightKg ?? null,
          unitCost: input.unitCost ?? null,
          currency: input.currency ?? null,
          minWeightKg: input.minWeightKg ?? null,
          defaultLocationId: input.locationId ?? null,
          notes: input.notes ?? null,
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new Conflict(`Lot code "${input.lotCode}" already exists`);
        }
        throw err;
      }
      if (!lot) throw new Error("Insert returned no row");

      await applyInventoryTransaction(tx, {
        greenLotId: lot.id,
        eventType: "receive",
        deltaKg: weight,
        locationId: input.locationId ?? null,
        comment: input.notes ?? null,
      });

      // Provenance edge, so a recall can reach this lot from the farm.
      if (input.producerId) {
        await recordTransformation(tx, {
          sourceKind: "producer",
          sourceId: input.producerId,
          targetKind: "green_lot",
          targetId: lot.id,
          weightKg: weight,
        });
      }
      await tx.emit({
        type: "inventory.green_lot.created",
        resourceType: "green_lot",
        resourceId: lot.id,
        payload: {
          id: lot.id,
          lotCode: lot.lotCode,
          name: lot.name,
          weightKg: weight,
          locationId: input.locationId ?? null,
        },
      });
      return lot.id;
    });

    return toDto(await loadLot(ctx, created));
  },
);

registerRpc(
  inventoryGreen,
  {
    namespace: "inventory.green",
    operation: "adjustGreenLotQuantity",
    summary: "Adjust a lot's weight",
    description:
      "Every adjustment names a reason, so shrinkage, a write-off and a recount stay " +
      "distinguishable in reporting rather than collapsing into one number. Only a " +
      "recount may take a lot negative.",
    input: adjustGreenLotInput,
    output: greenLotSchema,
    permission: "inventory.green.write",
    module: "inventory",
  },
  async (input, ctx) => {
    await ctx.db.transaction(async (tx) => {
      const result = await applyInventoryTransaction(tx, {
        greenLotId: input.id,
        eventType: input.reason,
        deltaKg: input.deltaKg,
        locationId: input.locationId ?? null,
        comment: input.comment ?? null,
        allowNegative: input.reason === "recount",
      });
      await tx.emit({
        type: "inventory.green_lot.adjusted",
        resourceType: "green_lot",
        resourceId: input.id,
        payload: {
          id: input.id,
          reason: input.reason,
          deltaKg: input.deltaKg,
          // The resulting balance, so a receiver does not have to call back to
          // find out what the adjustment actually left behind.
          currentWeightKg: result.weightAfterKg,
        },
      });
    });
    return toDto(await loadLot(ctx, input.id));
  },
);

registerRpc(
  inventoryGreen,
  {
    namespace: "inventory.green",
    operation: "transferGreenLotToLocation",
    summary: "Move weight between locations",
    description:
      "Writes two ledger rows sharing a group id. The lot's total is unchanged; only " +
      "the per-location balances move.",
    input: transferGreenLotInput,
    output: transferGreenLotOutput,
    permission: "inventory.green.write",
    module: "inventory",
  },
  async (input, ctx) =>
    ctx.db.transaction(async (tx) => {
      const result = await transferBetweenLocations(tx, {
        greenLotId: input.id,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        weightKg: input.weightKg,
        comment: input.comment,
      });
      await tx.emit({
        type: "inventory.green_lot.transferred",
        resourceType: "green_lot",
        resourceId: input.id,
        payload: {
          id: input.id,
          fromLocationId: input.fromLocationId,
          toLocationId: input.toLocationId,
          weightKg: input.weightKg,
        },
      });
      return result;
    }),
);

registerRpc(
  inventoryGreen,
  {
    namespace: "inventory.green",
    operation: "splitGreenLot",
    summary: "Split weight out into a new lot",
    description:
      "Creates a child lot and records a lineage edge, so traceability follows the " +
      "coffee rather than the lot code.",
    input: splitGreenLotInput,
    output: splitGreenLotOutput,
    permission: "inventory.green.write",
    module: "inventory",
  },
  async (input, ctx) => {
    const source = await loadLot(ctx, input.id);
    const weight = kg.normalize(input.weightKg);
    if (kg.cmp(source.currentWeightKg, weight) < 0) {
      throw new BadRequest(
        `Lot holds ${source.currentWeightKg} kg; cannot split out ${weight} kg.`,
      );
    }

    const groupId = crypto.randomUUID();
    const childId = await ctx.db.transaction(async (tx) => {
      let child: typeof greenLots.$inferSelect | undefined;
      try {
        [child] = await tx.insert(greenLots, {
          name: input.newName ?? `${source.name} (split)`,
          lotCode: input.newLotCode,
          // The child inherits provenance: it is the same coffee.
          supplierRef: source.supplierRef,
          producerId: source.producerId,
          partnerId: source.partnerId,
          parentLotId: source.id,
          state: source.state,
          varieties: source.varieties,
          processMethod: source.processMethod,
          harvestYear: source.harvestYear,
          certifications: source.certifications,
          initialWeightKg: weight,
          currentWeightKg: "0",
          bagWeightKg: source.bagWeightKg,
          unitCost: source.unitCost,
          currency: source.currency,
          defaultLocationId: source.defaultLocationId,
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new Conflict(`Lot code "${input.newLotCode}" already exists`);
        }
        throw err;
      }
      if (!child) throw new Error("Insert returned no row");

      const out = await applyInventoryTransaction(tx, {
        greenLotId: source.id,
        eventType: "split_out",
        deltaKg: kg.sub("0", weight),
        locationId: source.defaultLocationId,
        groupId,
        counterpartyLotId: child.id,
        comment: input.comment ?? null,
      });
      await applyInventoryTransaction(tx, {
        greenLotId: child.id,
        eventType: "split_in",
        deltaKg: weight,
        locationId: source.defaultLocationId,
        groupId,
        counterpartyLotId: source.id,
        comment: input.comment ?? null,
      });
      await recordTransformation(tx, {
        sourceKind: "green_lot",
        sourceId: source.id,
        targetKind: "green_lot",
        targetId: child.id,
        weightKg: weight,
        transactionId: out.id,
      });
      return child.id;
    });

    return {
      source: toDto(await loadLot(ctx, source.id)),
      created: toDto(await loadLot(ctx, childId)),
    };
  },
);

registerRpc(
  inventoryGreen,
  {
    namespace: "inventory.green",
    operation: "mergeGreenLots",
    summary: "Merge lots into one",
    description:
      "Drains each source into the target and records a lineage edge per source. This " +
      "is why lineage is an edge table: a merge has many sources, which a parent " +
      "pointer cannot express.",
    input: mergeGreenLotsInput,
    output: greenLotSchema,
    permission: "inventory.green.write",
    module: "inventory",
  },
  async (input, ctx) => {
    if (input.sourceIds.includes(input.targetId)) {
      throw new BadRequest("A lot cannot be merged into itself");
    }
    const target = await loadLot(ctx, input.targetId);
    const groupId = crypto.randomUUID();

    await ctx.db.transaction(async (tx) => {
      for (const sourceId of input.sourceIds) {
        const source = await tx.findOne(greenLots, eq(greenLots.id, sourceId));
        if (!source) throw new NotFound(`Lot ${sourceId} not found`);
        const weight = kg.normalize(source.currentWeightKg);
        if (kg.cmp(weight, "0") <= 0) continue;

        const out = await applyInventoryTransaction(tx, {
          greenLotId: source.id,
          eventType: "merge_out",
          deltaKg: kg.sub("0", weight),
          locationId: source.defaultLocationId,
          groupId,
          counterpartyLotId: target.id,
          comment: input.comment ?? null,
        });
        await applyInventoryTransaction(tx, {
          greenLotId: target.id,
          eventType: "merge_in",
          deltaKg: weight,
          locationId: target.defaultLocationId,
          groupId,
          counterpartyLotId: source.id,
          comment: input.comment ?? null,
        });
        await recordTransformation(tx, {
          sourceKind: "green_lot",
          sourceId: source.id,
          targetKind: "green_lot",
          targetId: target.id,
          weightKg: weight,
          transactionId: out.id,
        });
      }
    });

    return toDto(await loadLot(ctx, target.id));
  },
);

/**
 * Reservations move a separate counter, NOT the balance.
 *
 * Reserving coffee does not make it leave the warehouse; it commits it. Moving
 * the balance instead would make the ledger claim a movement that never
 * happened, and the physical count would stop matching the system.
 */
registerRpc(
  inventoryGreen,
  {
    namespace: "inventory.green",
    operation: "reserveGreenLot",
    summary: "Reserve weight against a lot",
    input: reserveGreenLotInput,
    output: greenLotSchema,
    permission: "inventory.green.write",
    module: "inventory",
  },
  async (input, ctx) => {
    const lot = await loadLot(ctx, input.id);

    // Quarantine is enforced HERE, at the point coffee gets committed to
    // work. A grading that only sets a status nobody checks is a note, not a
    // control — and the failure it is meant to prevent is a failed lot
    // reaching production because reserving it was still allowed.
    if (lot.status === "quarantined") {
      throw new BadRequest(
        "This lot is quarantined after a failed grading and cannot be reserved. " +
          "Release the quarantine first, with a reason.",
      );
    }

    // The availability check and the write happen under one row lock inside
    // adjustReservation. Read here, checked there: two reserves arriving
    // together would otherwise both see the same free weight and both take it.
    await ctx.db.transaction(async (tx) => {
      await adjustReservation(tx, input.id, kg.normalize(input.weightKg));
    });
    return toDto(await loadLot(ctx, input.id));
  },
);

registerRpc(
  inventoryGreen,
  {
    namespace: "inventory.green",
    operation: "releaseGreenLotReservation",
    summary: "Release a reservation",
    input: releaseGreenLotInput,
    output: greenLotSchema,
    permission: "inventory.green.write",
    module: "inventory",
  },
  async (input, ctx) => {
    await ctx.db.transaction(async (tx) => {
      await adjustReservation(tx, input.id, kg.sub("0", kg.normalize(input.weightKg)));
    });
    return toDto(await loadLot(ctx, input.id));
  },
);

registerRpc(
  inventoryGreen,
  {
    namespace: "inventory.green",
    operation: "listGreenLotTransactions",
    summary: "A lot's ledger history",
    input: listTransactionsInput,
    output: listTransactionsOutput,
    permission: "inventory.green.read",
    module: "inventory",
    cacheable: { maxAgeSeconds: 15 },
  },
  async (input, ctx) => {
    const limit = Math.min(input.page?.limit ?? 50, 200);
    const rows = await ctx.db.query(async (t, scope) =>
      t
        .select()
        .from(inventoryTransactions)
        .where(
          and(scope(inventoryTransactions), eq(inventoryTransactions.greenLotId, input.greenLotId)),
        )
        // Newest first, by sequence: occurredAt can be backdated, seq cannot.
        .orderBy(desc(inventoryTransactions.seq))
        .limit(limit),
    );

    return {
      items: rows.map((r) => ({
        id: r.id,
        seq: r.seq,
        eventType: r.eventType,
        locationId: r.locationId ?? null,
        weightBeforeKg: r.weightBeforeKg,
        deltaKg: r.deltaKg,
        weightAfterKg: r.weightAfterKg,
        groupId: r.groupId ?? null,
        comment: r.comment ?? null,
        occurredAt: r.occurredAt.toISOString(),
      })),
      page: { nextCursor: null, hasMore: rows.length === limit },
    };
  },
);

registerRpc(
  inventoryGreen,
  {
    namespace: "inventory.green",
    operation: "listGreenLotBalances",
    summary: "Where a lot is held",
    input: lotBalancesInput,
    output: lotBalancesOutput,
    permission: "inventory.green.read",
    module: "inventory",
    cacheable: { maxAgeSeconds: 15 },
  },
  async (input, ctx) => {
    const rows = await ctx.db.query(async (t, scope) =>
      t
        .select({
          locationId: lotLocationBalances.locationId,
          locationName: locations.name,
          weightKg: lotLocationBalances.weightKg,
        })
        .from(lotLocationBalances)
        .innerJoin(locations, eq(locations.id, lotLocationBalances.locationId))
        .where(
          and(
            scope(lotLocationBalances),
            eq(lotLocationBalances.greenLotId, input.greenLotId),
            // A location drained to zero is noise on this screen.
            sql`${lotLocationBalances.weightKg} <> 0`,
          ),
        ),
    );
    return { items: rows };
  },
);
