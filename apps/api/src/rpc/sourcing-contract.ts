import { OpenAPIHono } from "@hono/zod-openapi";
import { contractLines, contractMilestones, contracts, shipments } from "@roastery/db/schema";
import {
  completeMilestoneInput,
  contractSchema,
  createContractInput,
  createMilestoneInput,
  createShipmentInput,
  getContractInput,
  listContractsInput,
  listContractsOutput,
  listMilestonesInput,
  listMilestonesOutput,
  listShipmentsInput,
  listShipmentsOutput,
  milestoneSchema,
  openPositionsInput,
  openPositionsOutput,
  receiveShipmentInput,
  receiveShipmentOutput,
  shipmentSchema,
  updateContractStatusInput,
} from "@roastery/schemas";
import { and, asc, eq, ilike, isNull, lte, type SQL, sql } from "drizzle-orm";
import { receiveShipment, refreshContractPosition } from "../lib/contracts";
import { isUniqueViolation } from "../lib/db";
import { Conflict, NotFound } from "../lib/errors";
import { kg } from "../lib/inventory";
import { type RpcAppEnv, type RpcContext, registerRpc } from "../lib/rpc";

export const sourcingContract = new OpenAPIHono<RpcAppEnv>();

function contractDto(c: typeof contracts.$inferSelect) {
  return {
    id: c.id,
    contractNumber: c.contractNumber,
    partnerId: c.partnerId,
    status: c.status,
    contractDate: c.contractDate ?? null,
    incoterm: c.incoterm ?? null,
    currency: c.currency,
    priceType: c.priceType,
    paymentTermsDays: c.paymentTermsDays ?? null,
    totalWeightKg: c.totalWeightKg,
    receivedWeightKg: c.receivedWeightKg,
    // Computed: the number a green buyer actually watches.
    outstandingWeightKg: kg.sub(c.totalWeightKg, c.receivedWeightKg),
    totalValue: c.totalValue,
    notes: c.notes ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function lineDto(l: typeof contractLines.$inferSelect) {
  return {
    id: l.id,
    position: l.position,
    description: l.description,
    producerId: l.producerId ?? null,
    weightKg: l.weightKg,
    receivedWeightKg: l.receivedWeightKg,
    outstandingWeightKg: kg.sub(l.weightKg, l.receivedWeightKg),
    bagCount: l.bagCount ?? null,
    bagWeightKg: l.bagWeightKg ?? null,
    unitPrice: l.unitPrice ?? null,
    differential: l.differential ?? null,
    futuresMonth: l.futuresMonth ?? null,
    fixedAt: l.fixedAt?.toISOString() ?? null,
  };
}

function shipmentDto(s: typeof shipments.$inferSelect) {
  return {
    id: s.id,
    contractId: s.contractId,
    reference: s.reference,
    status: s.status,
    vessel: s.vessel ?? null,
    carrier: s.carrier ?? null,
    containerNumber: s.containerNumber ?? null,
    portOfLoading: s.portOfLoading ?? null,
    portOfDischarge: s.portOfDischarge ?? null,
    etd: s.etd ?? null,
    eta: s.eta ?? null,
    ata: s.ata ?? null,
    weightKg: s.weightKg,
    receivedAt: s.receivedAt?.toISOString() ?? null,
    destinationLocationId: s.destinationLocationId ?? null,
  };
}

async function linesOf(ctx: RpcContext, contractId: string) {
  return ctx.db.query(async (t, scope) =>
    t
      .select()
      .from(contractLines)
      .where(and(scope(contractLines), eq(contractLines.contractId, contractId)))
      .orderBy(asc(contractLines.position)),
  );
}

registerRpc(
  sourcingContract,
  {
    namespace: "sourcing.contract",
    operation: "listContracts",
    summary: "List green purchase contracts",
    input: listContractsInput,
    output: listContractsOutput,
    permission: "sourcing.contract.read",
    module: "green_contracts",
    cacheable: { maxAgeSeconds: 20 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    const f = input.filter;
    if (f?.status) clauses.push(eq(contracts.status, f.status));
    if (f?.partnerId) clauses.push(eq(contracts.partnerId, f.partnerId));
    if (f?.openOnly) {
      clauses.push(sql`${contracts.receivedWeightKg} < ${contracts.totalWeightKg}`);
    }
    if (f?.q) clauses.push(ilike(contracts.contractNumber, `%${f.q}%`));

    const { items, page } = await ctx.db.find(contracts, {
      where: clauses.length ? and(...clauses) : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return { items: items.map(contractDto), page };
  },
);

registerRpc(
  sourcingContract,
  {
    namespace: "sourcing.contract",
    operation: "getContract",
    summary: "Get a contract with its lines",
    input: getContractInput,
    output: contractSchema,
    permission: "sourcing.contract.read",
    module: "green_contracts",
    cacheable: { maxAgeSeconds: 20 },
  },
  async (input, ctx) => {
    const c = await ctx.db.findOne(contracts, eq(contracts.id, input.id));
    if (!c) throw new NotFound("Contract not found");
    return { ...contractDto(c), lines: (await linesOf(ctx, c.id)).map(lineDto) };
  },
);

registerRpc(
  sourcingContract,
  {
    namespace: "sourcing.contract",
    operation: "createContract",
    summary: "Create a green purchase contract",
    description:
      "Lines carry the weight and price. The contract's rolled-up position is DERIVED " +
      "from them, so a corrected line cannot leave the header out of step.",
    input: createContractInput,
    output: contractSchema,
    permission: "sourcing.contract.write",
    module: "green_contracts",
  },
  async (input, ctx) => {
    const id = await ctx.db.transaction(async (tx) => {
      let contract: typeof contracts.$inferSelect | undefined;
      try {
        [contract] = await tx.insert(contracts, {
          contractNumber: input.contractNumber,
          partnerId: input.partnerId,
          currency: input.currency,
          priceType: input.priceType,
          incoterm: input.incoterm ?? null,
          contractDate: input.contractDate ?? null,
          paymentTermsDays: input.paymentTermsDays ?? null,
          notes: input.notes ?? null,
          status: "confirmed",
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new Conflict(`Contract "${input.contractNumber}" already exists`);
        }
        throw err;
      }
      if (!contract) throw new Error("Insert returned no row");

      await tx.insert(
        contractLines,
        input.lines.map((line, i) => ({
          contractId: contract.id,
          position: i,
          description: line.description,
          producerId: line.producerId ?? null,
          weightKg: line.weightKg,
          bagCount: line.bagCount ?? null,
          bagWeightKg: line.bagWeightKg ?? null,
          unitPrice: line.unitPrice ?? null,
          differential: line.differential ?? null,
          futuresMonth: line.futuresMonth ?? null,
        })),
      );

      await refreshContractPosition(tx, contract.id);
      return contract.id;
    });

    const c = await ctx.db.findOne(contracts, eq(contracts.id, id));
    if (!c) throw new NotFound("Contract not found");
    return { ...contractDto(c), lines: (await linesOf(ctx, id)).map(lineDto) };
  },
);

registerRpc(
  sourcingContract,
  {
    namespace: "sourcing.contract",
    operation: "updateContractStatus",
    summary: "Change a contract's status",
    input: updateContractStatusInput,
    output: contractSchema,
    permission: "sourcing.contract.approve",
    module: "green_contracts",
  },
  async (input, ctx) => {
    const [c] = await ctx.db.update(
      contracts,
      { status: input.status, updatedAt: new Date() },
      eq(contracts.id, input.id),
    );
    if (!c) throw new NotFound("Contract not found");
    return { ...contractDto(c), lines: (await linesOf(ctx, c.id)).map(lineDto) };
  },
);

/* ------------------------------------------------------------- milestones */

function milestoneDto(m: typeof contractMilestones.$inferSelect) {
  const due = m.dueAt?.getTime();
  return {
    id: m.id,
    contractId: m.contractId,
    kind: m.kind,
    status: m.status,
    dueAt: m.dueAt?.toISOString() ?? null,
    completedAt: m.completedAt?.toISOString() ?? null,
    // Negative when overdue, which is what the alert scan sorts on.
    daysUntilDue: due ? Math.ceil((due - Date.now()) / 86_400_000) : null,
    notes: m.notes ?? null,
  };
}

registerRpc(
  sourcingContract,
  {
    namespace: "sourcing.contract",
    operation: "listContractMilestones",
    summary: "Milestones across contracts",
    description:
      "The cost of missing a fixation or a vessel is asymmetric — expensive, and " +
      "recoverable only if noticed early — so this is org-wide by default rather than " +
      "per contract.",
    input: listMilestonesInput,
    output: listMilestonesOutput,
    permission: "sourcing.contract.read",
    module: "green_contracts",
    cacheable: { maxAgeSeconds: 20 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    const f = input.filter;
    if (f?.contractId) clauses.push(eq(contractMilestones.contractId, f.contractId));
    if (f?.status) clauses.push(eq(contractMilestones.status, f.status));
    if (f?.dueWithinDays !== undefined) {
      const cutoff = new Date(Date.now() + f.dueWithinDays * 86_400_000);
      clauses.push(lte(contractMilestones.dueAt, cutoff));
      // A completed milestone is not "due", however old its date.
      clauses.push(isNull(contractMilestones.completedAt));
    }

    const rows = await ctx.db.query(async (t, scope) =>
      t
        .select()
        .from(contractMilestones)
        .where(and(scope(contractMilestones), ...clauses))
        .orderBy(asc(contractMilestones.dueAt))
        .limit(200),
    );
    return { items: rows.map(milestoneDto) };
  },
);

registerRpc(
  sourcingContract,
  {
    namespace: "sourcing.contract",
    operation: "createContractMilestone",
    summary: "Add a milestone to a contract",
    input: createMilestoneInput,
    output: milestoneSchema,
    permission: "sourcing.contract.write",
    module: "green_contracts",
  },
  async (input, ctx) => {
    const [row] = await ctx.db.insert(contractMilestones, {
      contractId: input.contractId,
      kind: input.kind,
      dueAt: new Date(input.dueAt),
      notes: input.notes ?? null,
    });
    if (!row) throw new Error("Insert returned no row");
    return milestoneDto(row);
  },
);

registerRpc(
  sourcingContract,
  {
    namespace: "sourcing.contract",
    operation: "completeContractMilestone",
    summary: "Mark a milestone complete",
    input: completeMilestoneInput,
    output: milestoneSchema,
    permission: "sourcing.contract.write",
    module: "green_contracts",
  },
  async (input, ctx) => {
    const [row] = await ctx.db.update(
      contractMilestones,
      { status: "completed", completedAt: new Date(), updatedAt: new Date() },
      eq(contractMilestones.id, input.id),
    );
    if (!row) throw new NotFound("Milestone not found");
    return milestoneDto(row);
  },
);

/* -------------------------------------------------------------- shipments */

registerRpc(
  sourcingContract,
  {
    namespace: "sourcing.contract",
    operation: "listContractShipments",
    summary: "List shipments",
    input: listShipmentsInput,
    output: listShipmentsOutput,
    permission: "sourcing.contract.read",
    module: "green_contracts",
    cacheable: { maxAgeSeconds: 20 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    const f = input.filter;
    if (f?.contractId) clauses.push(eq(shipments.contractId, f.contractId));
    if (f?.status) clauses.push(eq(shipments.status, f.status));
    if (f?.pendingOnly) clauses.push(isNull(shipments.receivedAt));

    const { items, page } = await ctx.db.find(shipments, {
      where: clauses.length ? and(...clauses) : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return { items: items.map(shipmentDto), page };
  },
);

registerRpc(
  sourcingContract,
  {
    namespace: "sourcing.contract",
    operation: "createContractShipment",
    summary: "Book a shipment against a contract",
    input: createShipmentInput,
    output: shipmentSchema,
    permission: "sourcing.contract.write",
    module: "green_contracts",
  },
  async (input, ctx) => {
    try {
      const [row] = await ctx.db.insert(shipments, { ...input });
      if (!row) throw new Error("Insert returned no row");
      return shipmentDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Conflict(`Shipment reference "${input.reference}" already exists`);
      }
      throw err;
    }
  },
);

registerRpc(
  sourcingContract,
  {
    namespace: "sourcing.contract",
    operation: "receiveContractShipment",
    summary: "Receive a shipment into inventory",
    description:
      "Creates a green lot per line, books its opening weight through the ledger, and " +
      "copies the contract's pricing into cost components — so a lot's landed cost is " +
      "derived from what was bought rather than typed in twice. Atomic: a half-received " +
      "shipment is worse than a failed one, because nobody knows to look for it.",
    input: receiveShipmentInput,
    output: receiveShipmentOutput,
    permission: "sourcing.contract.write",
    module: "green_contracts",
  },
  async (input, ctx) => receiveShipment(ctx.db, input),
);

/* -------------------------------------------------------------- positions */

registerRpc(
  sourcingContract,
  {
    namespace: "sourcing.contract",
    operation: "listOpenPositions",
    summary: "What is committed and not yet received",
    description:
      "The green buyer's daily question. Outstanding weight is where a roastery's money " +
      "sits between signing a contract and the coffee arriving.",
    input: openPositionsInput,
    output: openPositionsOutput,
    permission: "sourcing.contract.read",
    module: "green_contracts",
    cacheable: { maxAgeSeconds: 30 },
  },
  async (_input, ctx) => {
    const rows = await ctx.db.query(async (t, scope) =>
      t
        .select({
          contractId: contracts.id,
          contractNumber: contracts.contractNumber,
          partnerId: contracts.partnerId,
          status: contracts.status,
          contractedKg: contracts.totalWeightKg,
          receivedKg: contracts.receivedWeightKg,
        })
        .from(contracts)
        .where(
          and(
            scope(contracts),
            sql`${contracts.receivedWeightKg} < ${contracts.totalWeightKg}`,
            sql`${contracts.status} not in ('canceled', 'closed', 'draft')`,
          ),
        )
        .orderBy(asc(contracts.contractNumber)),
    );

    let contracted = "0";
    let received = "0";
    const items = rows.map((r) => {
      contracted = kg.add(contracted, r.contractedKg);
      received = kg.add(received, r.receivedKg);
      return { ...r, outstandingKg: kg.sub(r.contractedKg, r.receivedKg) };
    });

    return {
      totalContractedKg: contracted,
      totalReceivedKg: received,
      totalOutstandingKg: kg.sub(contracted, received),
      items,
    };
  },
);
