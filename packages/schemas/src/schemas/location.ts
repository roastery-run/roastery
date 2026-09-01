import { z } from "zod";
import { codeSchema, listOutput, pageInputSchema, uuidSchema } from "./common";

export const locationKindSchema = z.enum([
  "roastery",
  "warehouse",
  "cafe",
  "lab",
  "transit",
  "external",
]);

export const addressSchema = z.object({
  line1: z.string().max(200).optional(),
  line2: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  region: z.string().max(120).optional(),
  postalCode: z.string().max(32).optional(),
  country: z.string().length(2).optional(),
});

export const locationSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  code: z.string(),
  kind: locationKindSchema,
  address: addressSchema.nullable(),
  timezone: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Location = z.infer<typeof locationSchema>;

export const listLocationsInput = z.object({
  filter: z
    .object({
      kind: locationKindSchema.optional(),
      isActive: z.boolean().optional(),
      q: z.string().max(200).optional(),
    })
    .optional(),
  page: pageInputSchema,
});
export const listLocationsOutput = listOutput(locationSchema);

export const getLocationInput = z.object({ id: uuidSchema });
export const getLocationOutput = locationSchema;

export const createLocationInput = z.object({
  name: z.string().min(1).max(200),
  code: codeSchema,
  kind: locationKindSchema,
  address: addressSchema.optional(),
  timezone: z.string().max(64).optional(),
});
export const createLocationOutput = locationSchema;

export const updateLocationInput = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(200).optional(),
  kind: locationKindSchema.optional(),
  address: addressSchema.optional(),
  timezone: z.string().max(64).optional(),
  isActive: z.boolean().optional(),
});
export const updateLocationOutput = locationSchema;

export const archiveLocationInput = z.object({ id: uuidSchema });
export const archiveLocationOutput = locationSchema;
