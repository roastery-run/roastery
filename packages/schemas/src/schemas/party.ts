import { z } from "zod";
import { codeSchema, listOutput, pageInputSchema, uuidSchema } from "./common";

/**
 * Trading partners and the people who grow the coffee.
 *
 * Kept as one entity with a `types` array rather than separate supplier and
 * exporter tables, because in this trade one company is routinely several of
 * them at once — an importer who also exports and runs a warehouse.
 */
export const partnerTypeSchema = z.enum([
  "supplier",
  "importer",
  "exporter",
  "cooperative",
  "producer",
  "mill",
  "broker",
  "warehouse",
  "customer",
]);

export const partnerSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  code: z.string(),
  types: z.array(partnerTypeSchema),
  country: z.string().nullable(),
  defaultCurrency: z.string().nullable(),
  paymentTermsDays: z.number().int().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  website: z.string().nullable(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const listPartnersInput = z.object({
  filter: z
    .object({
      type: partnerTypeSchema.optional(),
      country: z.string().length(2).optional(),
      isActive: z.boolean().optional(),
      q: z.string().max(200).optional(),
    })
    .optional(),
  page: pageInputSchema,
});
export const listPartnersOutput = listOutput(partnerSchema);

export const getPartnerInput = z.object({ id: uuidSchema });

export const createPartnerInput = z.object({
  name: z.string().min(1).max(200),
  code: codeSchema,
  types: z.array(partnerTypeSchema).min(1),
  country: z.string().length(2).optional(),
  defaultCurrency: z.string().length(3).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  contactEmail: z.email().optional(),
  contactPhone: z.string().max(64).optional(),
  website: z.url().optional(),
  notes: z.string().max(4000).optional(),
});

export const updatePartnerInput = createPartnerInput
  .partial()
  .omit({ code: true })
  .extend({ id: uuidSchema, isActive: z.boolean().optional() });

/* ------------------------------------------------------------- producers */

/**
 * Where the coffee was grown. Distinct from a partner because traceability
 * follows the farm, not whoever sold the lot — the same farm's coffee can
 * arrive through different importers in different years.
 */
export const producerKindSchema = z.enum([
  "farm",
  "cooperative",
  "washing_station",
  "estate",
  "smallholder_group",
]);

export const producerSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  code: z.string(),
  kind: producerKindSchema,
  partnerId: uuidSchema.nullable(),
  country: z.string().nullable(),
  region: z.string().nullable(),
  subregion: z.string().nullable(),
  altitudeMinM: z.number().int().nullable(),
  altitudeMaxM: z.number().int().nullable(),
  latitude: z.string().nullable(),
  longitude: z.string().nullable(),
  varieties: z.array(z.string()),
  processMethods: z.array(z.string()),
  farmSizeHa: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const listProducersInput = z.object({
  filter: z
    .object({
      kind: producerKindSchema.optional(),
      country: z.string().length(2).optional(),
      partnerId: uuidSchema.optional(),
      q: z.string().max(200).optional(),
    })
    .optional(),
  page: pageInputSchema,
});
export const listProducersOutput = listOutput(producerSchema);

export const getProducerInput = z.object({ id: uuidSchema });

export const createProducerInput = z.object({
  name: z.string().min(1).max(200),
  code: codeSchema,
  kind: producerKindSchema,
  partnerId: uuidSchema.optional(),
  country: z.string().length(2).optional(),
  region: z.string().max(120).optional(),
  subregion: z.string().max(120).optional(),
  altitudeMinM: z.number().int().min(0).max(4000).optional(),
  altitudeMaxM: z.number().int().min(0).max(4000).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  varieties: z.array(z.string().max(80)).optional(),
  processMethods: z.array(z.string().max(80)).optional(),
  farmSizeHa: z.number().min(0).optional(),
});

export const updateProducerInput = createProducerInput
  .partial()
  .omit({ code: true })
  .extend({ id: uuidSchema, isActive: z.boolean().optional() });
