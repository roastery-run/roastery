import { z } from "zod";
import { codeSchema, listOutput, pageInputSchema, uuidSchema } from "./common";
import { positiveWeightKgSchema } from "./inventory";

export const customerTypeSchema = z.enum([
  "wholesale",
  "cafe",
  "retail",
  "distributor",
  "subscription",
  "internal",
  "export",
]);
export const salesOrderStatusSchema = z.enum([
  "draft",
  "confirmed",
  "in_production",
  "partially_fulfilled",
  "fulfilled",
  "invoiced",
  "paid",
  "canceled",
]);
export const salesChannelSchema = z.enum(["direct", "webstore", "edi", "marketplace", "api"]);
export const scheduleStatusSchema = z.enum([
  "draft",
  "released",
  "in_progress",
  "completed",
  "canceled",
]);

export const customerSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  code: z.string(),
  customerType: customerTypeSchema,
  currency: z.string(),
  paymentTermsDays: z.number().int().nullable(),
  contactEmail: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

export const listCustomersInput = z.object({
  filter: z
    .object({ customerType: customerTypeSchema.optional(), q: z.string().max(200).optional() })
    .optional(),
  page: pageInputSchema,
});
export const listCustomersOutput = listOutput(customerSchema);

export const createCustomerInput = z.object({
  name: z.string().min(1).max(200),
  code: codeSchema,
  customerType: customerTypeSchema.default("wholesale"),
  currency: z.string().length(3).default("USD"),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  contactEmail: z.email().optional(),
  shippingAddress: z.string().max(1000).optional(),
});

export const orderLineSchema = z.object({
  id: uuidSchema,
  position: z.number().int(),
  productId: uuidSchema.nullable(),
  blendId: uuidSchema.nullable(),
  description: z.string(),
  quantity: z.string(),
  weightKg: z.string(),
  allocatedWeightKg: z.string(),
  /** weight − allocated: what production still has to cover. */
  outstandingWeightKg: z.string(),
  unitPrice: z.string().nullable(),
});

export const salesOrderSchema = z.object({
  id: uuidSchema,
  orderNumber: z.string(),
  customerId: uuidSchema,
  channel: salesChannelSchema,
  status: salesOrderStatusSchema,
  currency: z.string(),
  total: z.string(),
  orderedAt: z.string(),
  requestedShipAt: z.string().nullable(),
  lines: z.array(orderLineSchema),
});

export const listOrdersInput = z.object({
  filter: z
    .object({
      status: salesOrderStatusSchema.optional(),
      customerId: uuidSchema.optional(),
      /** Anything not yet fully shipped. */
      openOnly: z.boolean().optional(),
    })
    .optional(),
  page: pageInputSchema,
});
export const listOrdersOutput = listOutput(salesOrderSchema.omit({ lines: true }));

export const getOrderInput = z.object({ id: uuidSchema });

export const createOrderInput = z.object({
  orderNumber: codeSchema,
  customerId: uuidSchema,
  channel: salesChannelSchema.default("direct"),
  externalOrderId: z.string().max(120).optional(),
  currency: z.string().length(3).default("USD"),
  requestedShipAt: z.iso.date().optional(),
  lines: z
    .array(
      z.object({
        productId: uuidSchema.optional(),
        blendId: uuidSchema.optional(),
        description: z.string().min(1).max(300),
        quantity: z.string(),
        weightKg: positiveWeightKgSchema,
        unitPrice: z.string().optional(),
      }),
    )
    .min(1)
    .max(200),
});

export const confirmOrderInput = z.object({ id: uuidSchema });

export const allocateOrderInput = z.object({
  id: uuidSchema,
  strategy: z.enum(["fefo", "fifo"]).default("fefo"),
});
export const allocateOrderOutput = z.object({
  orderId: uuidSchema,
  lines: z.array(
    z.object({
      orderLineId: uuidSchema,
      requestedKg: z.string(),
      allocatedKg: z.string(),
      shortfallKg: z.string(),
      picks: z.array(
        z.object({
          roastedLotId: uuidSchema,
          lotCode: z.string(),
          weightKg: z.string(),
          bestBeforeAt: z.string().nullable(),
        }),
      ),
    }),
  ),
});

export const releaseAllocationInput = z.object({ orderLineId: uuidSchema });

/* ------------------------------------------------------------ scheduling */

export const listDemandInput = z.object({
  /** Only orders due on or before this date. */
  dueBefore: z.iso.date().optional(),
});
export const listDemandOutput = z.object({
  items: z.array(
    z.object({
      blendId: uuidSchema.nullable(),
      profileId: uuidSchema.nullable(),
      label: z.string(),
      roastedKg: z.string(),
      dueAt: z.string().nullable(),
      orderLineCount: z.number().int(),
    }),
  ),
  totalRoastedKg: z.string(),
});

export const generateScheduleInput = z.object({
  name: z.string().min(1).max(200),
  scheduledDate: z.iso.date(),
  locationId: uuidSchema.optional(),
  dueBefore: z.iso.date().optional(),
  /** Cap per machine for the window, so a plan stays runnable in a day. */
  maxBatchesPerMachine: z.number().int().min(1).max(60).default(12),
});

export const scheduledBatchSchema = z.object({
  id: uuidSchema,
  machineId: uuidSchema.nullable(),
  profileId: uuidSchema.nullable(),
  blendId: uuidSchema.nullable(),
  position: z.number().int(),
  plannedChargeKg: z.string(),
  plannedYieldKg: z.string().nullable(),
  demandLineIds: z.array(z.string()),
  roastBatchId: uuidSchema.nullable(),
});

export const productionScheduleSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  scheduledDate: z.string(),
  status: scheduleStatusSchema,
  /** Why this plan may not run: shortfalls found while planning. */
  feasibilityNotes: z.array(z.string()),
  batches: z.array(scheduledBatchSchema),
  createdAt: z.string(),
});

export const getScheduleInput = z.object({ id: uuidSchema });

export const releaseScheduleInput = z.object({ id: uuidSchema });
