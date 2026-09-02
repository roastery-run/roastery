/**
 * Tracing coffee, and freezing that trace into a certificate.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { greenLots, roastedLots, traceabilityRecords } from "@roastery/db/schema";
import {
  issueCertificateInput,
  listCertificatesInput,
  listCertificatesOutput,
  traceabilityRecordSchema,
  traceInput,
  traceOutput,
} from "@roastery/schemas";
import { eq } from "drizzle-orm";
import { NotFound } from "../lib/api/errors";
import { type RpcAppEnv, registerRpc } from "../lib/api/rpc";
import { trace } from "../lib/domain/traceability";

export const traceability = new OpenAPIHono<RpcAppEnv>();

registerRpc(
  traceability,
  {
    namespace: "traceability",
    operation: "traceBackward",
    summary: "What went into this coffee",
    description:
      "Walks the lineage graph upstream in ONE query — a shipment reaches its contracts, " +
      "a bag reaches its farms. The recall direction: given something a customer has, " +
      "find everything that could be affected.",
    input: traceInput,
    output: traceOutput,
    permission: "traceability.read",
    module: "core",
    cacheable: { maxAgeSeconds: 60 },
  },
  async (input, ctx) => trace(ctx.db, { kind: input.kind, id: input.id }, "backward"),
);

registerRpc(
  traceability,
  {
    namespace: "traceability",
    operation: "traceForward",
    summary: "Where this coffee ended up",
    description:
      "The other recall direction, and the one that actually matters when a lot is found " +
      "to be contaminated: given a green lot, find every customer who received it.",
    input: traceInput,
    output: traceOutput,
    permission: "traceability.read",
    module: "core",
    cacheable: { maxAgeSeconds: 60 },
  },
  async (input, ctx) => trace(ctx.db, { kind: input.kind, id: input.id }, "forward"),
);

registerRpc(
  traceability,
  {
    namespace: "traceability",
    operation: "issueCertificate",
    summary: "Freeze a traceability certificate",
    description:
      "Materializes the chain as it is RIGHT NOW and mints a public QR token. Deliberately " +
      "a snapshot: lots get merged, split and consumed after coffee ships, so re-deriving " +
      "the chain later would describe something other than what was in the bag.",
    input: issueCertificateInput,
    output: traceabilityRecordSchema,
    permission: "traceability.read",
    module: "core",
  },
  async (input, ctx) => {
    const lot = await ctx.db.findOne(roastedLots, eq(roastedLots.id, input.roastedLotId));
    if (!lot) throw new NotFound("Roasted lot not found");

    const chain = await trace(ctx.db, { kind: "roasted_lot", id: lot.id }, "backward");

    // The origins a drinker cares about, lifted out of the chain so the public
    // page does not have to understand a graph.
    const origins = chain.nodes
      .filter((n) => n.kind === "producer")
      .map((n) => ({
        producer: n.label,
        country: n.detail.country ?? null,
        region: n.detail.region ?? null,
        altitude: n.detail.altitude ?? null,
      }));

    const greenNodes = chain.nodes.filter((n) => n.kind === "green_lot");
    const lots = await Promise.all(
      greenNodes.map((n) => ctx.db.findOne(greenLots, eq(greenLots.id, n.id))),
    );

    const roastNode = chain.nodes.find((n) => n.kind === "roast_batch");

    const snapshot = {
      coffee: {
        name: lot.name,
        lotCode: lot.lotCode,
        roastLevel: lot.roastLevel ?? null,
        roastedAt: lot.roastedAt?.toISOString() ?? null,
      },
      origins: origins.length
        ? origins.map((o, i) => ({
            ...o,
            process: lots[i]?.processMethod ?? null,
            varieties: lots[i]?.varieties ?? [],
          }))
        : lots.filter(Boolean).map((l) => ({
            producer: null,
            country: null,
            region: null,
            altitude: null,
            process: l?.processMethod ?? null,
            varieties: l?.varieties ?? [],
          })),
      roast: roastNode
        ? {
            batchNumber: roastNode.label,
            roastedAt: roastNode.detail.roastedAt ?? null,
            weightLossPct: roastNode.detail.weightLossPct ?? null,
          }
        : null,
    };

    // Globally unique and unguessable. It is printed on a retail bag and
    // looked up with no credential, so a sequential or short code would let
    // anyone enumerate every customer's coffee.
    const qrToken = [...crypto.getRandomValues(new Uint8Array(12))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const row = await ctx.db.transaction(async (tx) => {
      const [created] = await tx.insert(traceabilityRecords, {
        qrToken,
        roastedLotId: lot.id,
        orderLineId: input.orderLineId ?? null,
        fulfillmentId: input.fulfillmentId ?? null,
        snapshot,
        chain: { nodes: chain.nodes, edges: chain.edges, truncated: chain.truncated },
      });
      if (!created) throw new Error("Insert returned no row");
      await tx.emit({
        type: "traceability.certificate.issued",
        resourceType: "traceability_record",
        resourceId: created.id,
        payload: { id: created.id, qrToken, roastedLotId: lot.id },
      });
      return created;
    });

    return {
      id: row.id,
      qrToken: row.qrToken,
      roastedLotId: row.roastedLotId ?? null,
      orderLineId: row.orderLineId ?? null,
      snapshot: row.snapshot,
      issuedAt: row.issuedAt.toISOString(),
    };
  },
);

registerRpc(
  traceability,
  {
    namespace: "traceability",
    operation: "listCertificates",
    summary: "Issued certificates",
    input: listCertificatesInput,
    output: listCertificatesOutput,
    permission: "traceability.read",
    module: "core",
    cacheable: { maxAgeSeconds: 60 },
  },
  async (input, ctx) => {
    const { items, page } = await ctx.db.find(traceabilityRecords, {
      where: input.filter?.roastedLotId
        ? eq(traceabilityRecords.roastedLotId, input.filter.roastedLotId)
        : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return {
      items: items.map((r) => ({
        id: r.id,
        qrToken: r.qrToken,
        roastedLotId: r.roastedLotId ?? null,
        orderLineId: r.orderLineId ?? null,
        snapshot: r.snapshot,
        issuedAt: r.issuedAt.toISOString(),
      })),
      page,
    };
  },
);
