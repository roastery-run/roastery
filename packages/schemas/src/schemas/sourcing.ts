import { z } from "zod";
import { codeSchema, listOutput, pageInputSchema, uuidSchema } from "./common";
import { positiveWeightKgSchema, weightKgSchema } from "./inventory";

export const contractStatusSchema = z.enum([
  "draft",
  "pending",
  "confirmed",
  "partially_shipped",
  "shipped",
  "arrived",
  "closed",
  "canceled",
  "defaulted",
]);

export const contractPriceTypeSchema = z.enum(["fixed", "differential", "to_be_fixed", "formula"]);

export const incotermSchema = z.enum([
  "EXW",
  "FCA",
  "FAS",
  "FOB",
  "CFR",
  "CIF",
  "CPT",
  "CIP",
  "DAP",
  "DPU",
  "DDP",
]);

export const milestoneKindSchema = z.enum([
  "contract_signed",
  "fixation",
  "shipment",
  "vessel_departure",
  "vessel_arrival",
  "customs_clearance",
  "warehouse_receipt",
  "sample_approval",
  "payment",
]);

export const milestoneStatusSchema = z.enum([
  "pending",
  "on_track",
  "at_risk",
  "completed",
  "missed",
]);

export const shipmentStatusSchema = z.enum([
  "booked",
  "loaded",
  "in_transit",
  "arrived",
  "cleared",
  "delivered",
  "delayed",
  "canceled",
]);

export const contractLineSchema = z.object({
  id: uuidSchema,
  position: z.number().int(),
  description: z.string(),
  producerId: uuidSchema.nullable(),
  weightKg: z.string(),
  receivedWeightKg: z.string(),
  /** contracted − received: the line's remaining exposure. */
  outstandingWeightKg: z.string(),
  bagCount: z.number().int().nullable(),
  bagWeightKg: z.string().nullable(),
  unitPrice: z.string().nullable(),
  differential: z.string().nullable(),
  futuresMonth: z.string().nullable(),
  fixedAt: z.string().nullable(),
});

export const contractSchema = z.object({
  id: uuidSchema,
  contractNumber: z.string(),
  partnerId: uuidSchema,
  status: contractStatusSchema,
  contractDate: z.string().nullable(),
  incoterm: incotermSchema.nullable(),
  currency: z.string(),
  priceType: contractPriceTypeSchema,
  paymentTermsDays: z.number().int().nullable(),
  totalWeightKg: z.string(),
  receivedWeightKg: z.string(),
  outstandingWeightKg: z.string(),
  totalValue: z.string(),
  notes: z.string().nullable(),
  lines: z.array(contractLineSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const listContractsInput = z.object({
  filter: z
    .object({
      status: contractStatusSchema.optional(),
      partnerId: uuidSchema.optional(),
      /** Anything not yet fully received. */
      openOnly: z.boolean().optional(),
      q: z.string().max(200).optional(),
    })
    .optional(),
  page: pageInputSchema,
});
export const listContractsOutput = listOutput(contractSchema.omit({ lines: true }));

export const getContractInput = z.object({ id: uuidSchema });

export const createContractInput = z.object({
  contractNumber: codeSchema,
  partnerId: uuidSchema,
  currency: z.string().length(3).default("USD"),
  priceType: contractPriceTypeSchema.default("fixed"),
  incoterm: incotermSchema.optional(),
  contractDate: z.iso.date().optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  notes: z.string().max(4000).optional(),
  lines: z
    .array(
      z.object({
        description: z.string().min(1).max(300),
        producerId: uuidSchema.optional(),
        weightKg: positiveWeightKgSchema,
        bagCount: z.number().int().min(0).optional(),
        bagWeightKg: z.string().optional(),
        unitPrice: z.string().optional(),
        differential: z.string().optional(),
        futuresMonth: z.string().max(16).optional(),
      }),
    )
    .min(1)
    .max(100),
});

export const updateContractStatusInput = z.object({
  id: uuidSchema,
  status: contractStatusSchema,
});

/* ------------------------------------------------------------- milestones */

export const milestoneSchema = z.object({
  id: uuidSchema,
  contractId: uuidSchema,
  kind: milestoneKindSchema,
  status: milestoneStatusSchema,
  dueAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  /** Negative when overdue. */
  daysUntilDue: z.number().int().nullable(),
  notes: z.string().nullable(),
});

export const listMilestonesInput = z.object({
  filter: z
    .object({
      contractId: uuidSchema.optional(),
      status: milestoneStatusSchema.optional(),
      /** Due within N days, or already overdue. */
      dueWithinDays: z.number().int().min(0).max(365).optional(),
    })
    .optional(),
});
export const listMilestonesOutput = z.object({ items: z.array(milestoneSchema) });

export const createMilestoneInput = z.object({
  contractId: uuidSchema,
  kind: milestoneKindSchema,
  dueAt: z.iso.datetime(),
  notes: z.string().max(1000).optional(),
});

export const completeMilestoneInput = z.object({ id: uuidSchema });

/* -------------------------------------------------------------- shipments */

export const shipmentSchema = z.object({
  id: uuidSchema,
  contractId: uuidSchema,
  reference: z.string(),
  status: shipmentStatusSchema,
  vessel: z.string().nullable(),
  carrier: z.string().nullable(),
  containerNumber: z.string().nullable(),
  portOfLoading: z.string().nullable(),
  portOfDischarge: z.string().nullable(),
  etd: z.string().nullable(),
  eta: z.string().nullable(),
  ata: z.string().nullable(),
  weightKg: z.string(),
  receivedAt: z.string().nullable(),
  destinationLocationId: uuidSchema.nullable(),
});

export const listShipmentsInput = z.object({
  filter: z
    .object({
      contractId: uuidSchema.optional(),
      status: shipmentStatusSchema.optional(),
      pendingOnly: z.boolean().optional(),
    })
    .optional(),
  page: pageInputSchema,
});
export const listShipmentsOutput = listOutput(shipmentSchema);

export const createShipmentInput = z.object({
  contractId: uuidSchema,
  reference: codeSchema,
  weightKg: positiveWeightKgSchema,
  vessel: z.string().max(120).optional(),
  carrier: z.string().max(120).optional(),
  containerNumber: z.string().max(64).optional(),
  portOfLoading: z.string().max(120).optional(),
  portOfDischarge: z.string().max(120).optional(),
  etd: z.iso.date().optional(),
  eta: z.iso.date().optional(),
  destinationLocationId: uuidSchema.optional(),
});

export const receiveShipmentInput = z.object({
  shipmentId: uuidSchema,
  locationId: uuidSchema.optional(),
  lines: z
    .array(
      z.object({
        contractLineId: uuidSchema,
        /** Actual weight received; short shipment is normal in this trade. */
        weightKg: positiveWeightKgSchema,
        lotCode: codeSchema,
        lotName: z.string().max(200).optional(),
      }),
    )
    .min(1)
    .max(100),
});

export const receiveShipmentOutput = z.object({
  shipmentId: uuidSchema,
  createdLots: z.array(
    z.object({
      id: uuidSchema,
      lotCode: z.string(),
      weightKg: z.string(),
      /** Derived from the contract, not typed in again. */
      perKgBase: z.string(),
    }),
  ),
});

/* -------------------------------------------------------------- positions */

export const openPositionsInput = z.object({});
export const openPositionsOutput = z.object({
  totalContractedKg: z.string(),
  totalReceivedKg: z.string(),
  totalOutstandingKg: z.string(),
  items: z.array(
    z.object({
      contractId: uuidSchema,
      contractNumber: z.string(),
      partnerId: uuidSchema,
      status: contractStatusSchema,
      contractedKg: z.string(),
      receivedKg: z.string(),
      outstandingKg: z.string(),
    }),
  ),
});

/* ---------------------------------------------------------------- samples */

export const sampleTypeSchema = z.enum([
  "offer",
  "pre_shipment",
  "arrival",
  "type",
  "spot",
  "production",
  "competition",
]);

export const sampleStatusSchema = z.enum([
  "requested",
  "in_transit",
  "received",
  "roasted",
  "cupped",
  "approved",
  "rejected",
  "archived",
]);

export const sampleSchema = z.object({
  id: uuidSchema,
  sampleNumber: z.string(),
  sampleType: sampleTypeSchema,
  status: sampleStatusSchema,
  name: z.string(),
  partnerId: uuidSchema.nullable(),
  producerId: uuidSchema.nullable(),
  contractId: uuidSchema.nullable(),
  greenLotId: uuidSchema.nullable(),
  poNumber: z.string().nullable(),
  salesNumber: z.string().nullable(),
  trackingNumbers: z.array(z.string()),
  weightKg: z.string().nullable(),
  requestedAt: z.string().nullable(),
  receivedAt: z.string().nullable(),
  dueAt: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionNotes: z.string().nullable(),
  createdAt: z.string(),
});

export const listSamplesInput = z.object({
  filter: z
    .object({
      status: sampleStatusSchema.optional(),
      sampleType: sampleTypeSchema.optional(),
      partnerId: uuidSchema.optional(),
      contractId: uuidSchema.optional(),
      /** Awaiting a decision from us. */
      pendingOnly: z.boolean().optional(),
      trackingNumber: z.string().max(120).optional(),
      q: z.string().max(200).optional(),
    })
    .optional(),
  page: pageInputSchema,
});
export const listSamplesOutput = listOutput(sampleSchema);

export const getSampleInput = z.object({ id: uuidSchema });

export const createSampleInput = z.object({
  sampleNumber: codeSchema,
  name: z.string().min(1).max(200),
  sampleType: sampleTypeSchema,
  partnerId: uuidSchema.optional(),
  producerId: uuidSchema.optional(),
  contractId: uuidSchema.optional(),
  contractLineId: uuidSchema.optional(),
  poNumber: z.string().max(64).optional(),
  salesNumber: z.string().max(64).optional(),
  trackingNumbers: z.array(z.string().max(120)).max(10).optional(),
  weightKg: weightKgSchema.optional(),
  dueAt: z.iso.datetime().optional(),
});

export const updateSampleStatusInput = z.object({
  id: uuidSchema,
  status: sampleStatusSchema,
  decisionNotes: z.string().max(2000).optional(),
  trackingNumbers: z.array(z.string().max(120)).max(10).optional(),
});

export const transferSampleToInventoryInput = z.object({
  id: uuidSchema,
  lotCode: codeSchema,
  weightKg: positiveWeightKgSchema,
  locationId: uuidSchema.optional(),
});
