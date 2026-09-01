import { z } from "@hono/zod-openapi";

/** Every failure returns `{ error }`; 500 additionally carries a correlation id. */
export const errorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
});

export const internalErrorSchema = z.object({
  error: z.string(),
  correlationId: z.string().optional(),
});

/**
 * A 402 says the organization's PLAN is the obstacle, not the caller's role.
 * Keeping it structurally distinct from 403 is what lets the console show an
 * upgrade path instead of a generic "forbidden".
 */
export const entitlementErrorSchema = z.object({
  error: z.string(),
  code: z.enum(["entitlement_required", "quota_exceeded"]),
  module: z.string().optional(),
  plan: z.string().optional(),
  requiredPlans: z.array(z.string()).optional(),
  key: z.string().optional(),
  limit: z.number().optional(),
  current: z.number().optional(),
});

function json(schema: z.ZodTypeAny, description: string) {
  return { description, content: { "application/json": { schema } } };
}

/**
 * Standard error responses. Declared on every operation so a generated client
 * models them, and so 429 is documented — a rate limit clients cannot see in
 * the spec is one they will not back off from.
 */
export function errorResponses(opts: { conflict?: boolean; notFound?: boolean } = {}) {
  const { conflict = false, notFound = true } = opts;
  return {
    400: json(errorSchema, "Invalid request"),
    401: json(errorSchema, "Missing or invalid credentials"),
    403: json(errorSchema, "The caller's role does not grant this permission"),
    ...(notFound ? { 404: json(errorSchema, "Not found") } : {}),
    ...(conflict ? { 409: json(errorSchema, "Conflict") } : {}),
    429: json(errorSchema, "Rate limited — see Retry-After"),
    500: json(internalErrorSchema, "Internal error"),
  };
}
