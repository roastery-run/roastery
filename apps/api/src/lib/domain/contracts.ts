import {
  contractLines,
  contracts,
  costComponents,
  greenLots,
  shipments,
} from "@roastery/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { BadRequest, Conflict, NotFound } from "../api/errors";
import { isUniqueViolation } from "../db/db";
import type { OrgDb } from "../db/org-db";
import { recomputeLandedCost } from "./costing";
import { applyInventoryTransaction, kg, recordTransformation } from "./inventory";

/**
 * Receiving a shipment: the seam between a contract and inventory.
 *
 * This is the operation the whole sourcing model exists to make correct. It
 * must, atomically:
 *
 *   - create a green lot per contract line in the shipment,
 *   - book its opening weight through the ledger (never a bare column write),
 *   - copy the contract's pricing into cost components so the lot's landed
 *     cost is DERIVED from what was actually bought rather than retyped,
 *   - draw down the line and contract positions,
 *   - record provenance edges from producer to lot.
 *
 * If any part fails, none of it happened. A half-received shipment — stock
 * that exists with no cost, or a position drawn down against a lot that was
 * never created — is worse than a failed request, because nobody knows to
 * look for it.
 */

export type ReceiveInput = {
  shipmentId: string;
  locationId?: string | null;
  /** Actual weight received per line; short-shipment is normal in this trade. */
  lines: { contractLineId: string; weightKg: string; lotCode: string; lotName?: string }[];
};

export type ReceiveResult = {
  shipmentId: string;
  createdLots: { id: string; lotCode: string; weightKg: string; perKgBase: string }[];
};

export async function receiveShipment(db: OrgDb, input: ReceiveInput): Promise<ReceiveResult> {
  const shipment = await db.findOne(shipments, eq(shipments.id, input.shipmentId));
  if (!shipment) throw new NotFound("Shipment not found");
  // Receiving twice would double the stock and halve the apparent cost, and
  // the second receipt looks entirely legitimate in isolation.
  if (shipment.receivedAt) throw new Conflict("This shipment has already been received");

  const contract = await db.findOne(contracts, eq(contracts.id, shipment.contractId));
  if (!contract) throw new NotFound("Contract not found");

  const created: ReceiveResult["createdLots"] = [];

  await db.transaction(async (tx) => {
    for (const line of input.lines) {
      const cl = await tx.findOne(contractLines, eq(contractLines.id, line.contractLineId));
      if (!cl) throw new NotFound(`Contract line ${line.contractLineId} not found`);
      if (cl.contractId !== contract.id) {
        throw new BadRequest("A contract line does not belong to this shipment's contract");
      }

      const weight = kg.normalize(line.weightKg);
      if (kg.cmp(weight, "0") <= 0) throw new BadRequest("Received weight must be positive");

      const outstanding = kg.sub(cl.weightKg, cl.receivedWeightKg);
      // Over-receipt is a data-entry error often enough that refusing it is
      // more useful than accepting it: the alternative is a position that goes
      // negative and a contract that never closes.
      if (kg.cmp(weight, outstanding) > 0) {
        throw new BadRequest(
          `Line has ${outstanding} kg outstanding; cannot receive ${weight} kg against it.`,
        );
      }

      let lot: typeof greenLots.$inferSelect | undefined;
      try {
        [lot] = await tx.insert(greenLots, {
          name: line.lotName ?? cl.description,
          lotCode: line.lotCode,
          producerId: cl.producerId,
          partnerId: contract.partnerId,
          initialWeightKg: weight,
          currentWeightKg: "0",
          bagWeightKg: cl.bagWeightKg,
          bagCount: cl.bagWeightKg ? bagsFor(weight, cl.bagWeightKg) : null,
          unitCost: cl.unitPrice,
          currency: contract.currency,
          defaultLocationId: input.locationId ?? shipment.destinationLocationId,
          status: "available",
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw new Conflict(`Lot code "${line.lotCode}" already exists`);
        throw err;
      }
      if (!lot) throw new Error("Insert returned no row");

      await applyInventoryTransaction(tx, {
        greenLotId: lot.id,
        eventType: "receive",
        deltaKg: weight,
        locationId: input.locationId ?? shipment.destinationLocationId,
        contractLineId: cl.id,
        comment: `Received against ${contract.contractNumber} / ${shipment.reference}`,
      });

      // The price the coffee was bought at becomes the lot's base cost
      // component. Copied here rather than referenced, because a contract can
      // be amended later and a lot's landed cost must reflect what was true
      // when it was received.
      if (cl.unitPrice) {
        await tx.insert(costComponents, {
          greenLotId: lot.id,
          contractLineId: cl.id,
          kind: "base_price",
          label: `${contract.contractNumber} line ${cl.position + 1}`,
          amount: cl.unitPrice,
          currency: contract.currency,
          fxRateUsed: "1.00000000",
          amountBase: cl.unitPrice,
          // A contract price is per unit; the rollup multiplies it back up.
          perUnit: true,
        });
      }
      if (cl.differential) {
        await tx.insert(costComponents, {
          greenLotId: lot.id,
          contractLineId: cl.id,
          kind: "differential",
          label: cl.futuresMonth ? `Differential vs ${cl.futuresMonth}` : "Differential",
          amount: cl.differential,
          currency: contract.currency,
          fxRateUsed: "1.00000000",
          amountBase: cl.differential,
          perUnit: true,
        });
      }

      if (cl.producerId) {
        await recordTransformation(tx, {
          sourceKind: "producer",
          sourceId: cl.producerId,
          targetKind: "green_lot",
          targetId: lot.id,
          weightKg: weight,
        });
      }

      await tx.update(
        contractLines,
        { receivedWeightKg: kg.add(cl.receivedWeightKg, weight), updatedAt: new Date() },
        eq(contractLines.id, cl.id),
      );

      created.push({ id: lot.id, lotCode: line.lotCode, weightKg: weight, perKgBase: "0" });
    }

    await tx.update(
      shipments,
      { receivedAt: new Date(), status: "delivered", updatedAt: new Date() },
      eq(shipments.id, shipment.id),
    );

    await refreshContractPosition(tx, contract.id);
  });

  // Costing runs after the transaction commits: it reads the components just
  // written, and a lot with no cost is a recoverable state whereas stock that
  // does not exist is not.
  for (const lot of created) {
    const cost = await recomputeLandedCost(db, lot.id);
    lot.perKgBase = cost.perKgBase;
  }

  return { shipmentId: shipment.id, createdLots: created };
}

function bagsFor(weightKg: string, bagWeightKg: string): number | null {
  const w = Number.parseFloat(weightKg);
  const b = Number.parseFloat(bagWeightKg);
  // Display only — the authoritative quantity is always the exact decimal
  // weight, never a bag count reconstructed from it.
  return b > 0 ? Math.round(w / b) : null;
}

/**
 * Recomputes a contract's rolled-up position from its lines.
 *
 * Derived rather than incremented, so a correction to one line cannot leave
 * the contract total permanently out of step with the lines that make it up.
 */
export async function refreshContractPosition(db: OrgDb, contractId: string): Promise<void> {
  const [totals] = await db.query(async (t, scope) =>
    t
      .select({
        total: sql<string>`coalesce(sum(${contractLines.weightKg}), 0)::text`,
        received: sql<string>`coalesce(sum(${contractLines.receivedWeightKg}), 0)::text`,
        value: sql<string>`coalesce(sum(${contractLines.weightKg} * coalesce(${contractLines.unitPrice}, 0)), 0)::text`,
      })
      .from(contractLines)
      .where(and(scope(contractLines), eq(contractLines.contractId, contractId))),
  );

  const total = kg.normalize(totals?.total ?? "0");
  const received = kg.normalize(totals?.received ?? "0");

  // Status follows the position rather than being set by hand: a contract that
  // is fully received but still shows "confirmed" is how open-position reports
  // drift away from reality.
  const status =
    kg.cmp(received, "0") === 0
      ? undefined
      : kg.cmp(received, total) >= 0
        ? ("arrived" as const)
        : ("partially_shipped" as const);

  await db.update(
    contracts,
    {
      totalWeightKg: total,
      receivedWeightKg: received,
      totalValue: totals?.value ?? "0",
      ...(status ? { status } : {}),
      updatedAt: new Date(),
    },
    eq(contracts.id, contractId),
  );
}
