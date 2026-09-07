import { z } from "zod";

/**
 * Entitlement module keys.
 *
 * Imported by BOTH the API's route definitions and the marketing pricing page,
 * so a plan can never advertise a module the product does not gate on, or gate
 * on one the pricing page never mentions.
 */
export const moduleKeySchema = z.enum([
  "core",
  "inventory",
  "resource_planning",
  "roasting",
  "quality",
  "orders",
  "green_contracts",
  "samples",
  "cafe",
  "api",
]);
export type ModuleKey = z.infer<typeof moduleKeySchema>;

export const builtinRoleSchema = z.enum(["owner", "manager", "roaster", "qc", "viewer"]);
export type BuiltinRole = z.infer<typeof builtinRoleSchema>;

/** Opaque keyset cursor. Never parse it client-side. */
export const cursorSchema = z.string().min(1).max(512);

export const pageInputSchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: z.number().int().min(1).max(200).default(50),
    /**
     * A column to order by, from the operation's declared `sortable` list.
     *
     * Checked against that list by the RPC wrapper, not here: what is
     * orderable differs per operation, and a schema shared by forty listings
     * cannot know which. An unknown key is rejected rather than ignored — a
     * list that looks sorted and is not is worse than one that says no.
     */
    sort: z.string().max(60).optional(),
    dir: z.enum(["asc", "desc"]).optional(),
  })
  .optional();

export const pageInfoSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export function listOutput<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), page: pageInfoSchema });
}

/** Slug/code shape shared by every business identifier a user types. */
export const codeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Use letters, digits, dot, dash or underscore");

export const uuidSchema = z.uuid();
