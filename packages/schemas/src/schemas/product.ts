import { z } from "zod";
import { codeSchema, listOutput, pageInputSchema, uuidSchema } from "./common";

export const productFormatSchema = z.enum([
  "whole_bean",
  "ground_espresso",
  "ground_filter",
  "ground_french_press",
  "capsule",
  "instant",
  "drip_bag",
  "bulk",
]);

export const productSchema = z.object({
  id: uuidSchema,
  sku: z.string(),
  name: z.string(),
  format: productFormatSchema,
  /** Canonical kilograms. Serialized as a string: exact decimals, no float. */
  netWeightKg: z.string().nullable(),
  listPrice: z.string().nullable(),
  currency: z.string().nullable(),
  barcode: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const listProductsInput = z.object({
  filter: z
    .object({
      format: productFormatSchema.optional(),
      isActive: z.boolean().optional(),
      q: z.string().max(200).optional(),
    })
    .optional(),
  page: pageInputSchema,
});
export const listProductsOutput = listOutput(productSchema);

export const getProductInput = z.object({ id: uuidSchema });

export const createProductInput = z.object({
  sku: codeSchema,
  name: z.string().min(1).max(200),
  format: productFormatSchema,
  netWeightKg: z.number().positive().max(10_000).optional(),
  listPrice: z.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  barcode: z.string().max(64).optional(),
});

export const updateProductInput = createProductInput
  .partial()
  .omit({ sku: true })
  .extend({ id: uuidSchema, isActive: z.boolean().optional() });
