import { z } from "zod";
import { codeSchema, listOutput, pageInputSchema, uuidSchema } from "./common";

export const machineTypeSchema = z.enum([
  "drum",
  "fluid_bed",
  "recirculating",
  "sample",
  "tangential",
  "centrifugal",
]);

/**
 * How telemetry reaches us. `artisan` and `bridge` are the shop-floor agents;
 * `none` means batches are entered by hand.
 */
export const machineConnectivitySchema = z.enum([
  "none",
  "artisan",
  "bridge",
  "modbus",
  "serial",
  "cloud_api",
]);

export const machineSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  code: z.string(),
  locationId: uuidSchema.nullable(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  machineType: machineTypeSchema,
  capacityKg: z.string().nullable(),
  minBatchKg: z.string().nullable(),
  maxBatchKg: z.string().nullable(),
  connectivity: machineConnectivitySchema,
  /** Never returned in full once set; identifies a bridge at ingest. */
  hasDeviceId: z.boolean(),
  isActive: z.boolean(),
  installedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const listMachinesInput = z.object({
  filter: z
    .object({
      locationId: uuidSchema.optional(),
      machineType: machineTypeSchema.optional(),
      isActive: z.boolean().optional(),
    })
    .optional(),
  page: pageInputSchema,
});
export const listMachinesOutput = listOutput(machineSchema);

export const getMachineInput = z.object({ id: uuidSchema });

export const registerMachineInput = z.object({
  name: z.string().min(1).max(200),
  code: codeSchema,
  locationId: uuidSchema.optional(),
  brand: z.string().max(120).optional(),
  model: z.string().max(120).optional(),
  machineType: machineTypeSchema.default("drum"),
  capacityKg: z.number().positive().max(10_000).optional(),
  minBatchKg: z.number().positive().max(10_000).optional(),
  maxBatchKg: z.number().positive().max(10_000).optional(),
  connectivity: machineConnectivitySchema.default("none"),
  installedAt: z.iso.datetime().optional(),
});

export const updateMachineInput = registerMachineInput
  .partial()
  .omit({ code: true })
  .extend({ id: uuidSchema, isActive: z.boolean().optional() });
