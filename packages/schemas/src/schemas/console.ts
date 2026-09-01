import { z } from "zod";
import { builtinRoleSchema, listOutput, pageInputSchema, uuidSchema } from "./common";

/* --------------------------------------------------------------- members */

export const memberSchema = z.object({
  id: uuidSchema,
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  roleSlug: z.string(),
  createdAt: z.string(),
});

export const listMembersInput = z.object({ page: pageInputSchema });
export const listMembersOutput = listOutput(memberSchema);

export const updateMemberRoleInput = z.object({
  userId: z.string().min(1),
  roleSlug: builtinRoleSchema,
});

export const removeMemberInput = z.object({ userId: z.string().min(1) });
export const okOutput = z.object({ ok: z.boolean() });

/* ------------------------------------------------------------ credentials */

export const apiKeySummarySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  /** First characters only — enough to identify a key, useless as a credential. */
  start: z.string().nullable(),
  enabled: z.boolean(),
  roleSlug: z.string().nullable(),
  scopes: z.array(z.string()).nullable(),
  expiresAt: z.string().nullable(),
  lastRequest: z.string().nullable(),
  requestCount: z.number(),
  createdAt: z.string(),
});

export const listApiKeysInput = z.object({});
export const listApiKeysOutput = z.object({ items: z.array(apiKeySummarySchema) });

export const createApiKeyInput = z.object({
  name: z.string().min(1).max(120),
  roleSlug: builtinRoleSchema,
  /**
   * Optional down-scoping. Omit for the role's full grants; pass an empty
   * array for a deliberately inert key.
   */
  scopes: z.array(z.string().max(120)).nullable().optional(),
  expiresInDays: z.number().int().min(1).max(730).optional(),
});

export const createApiKeyOutput = z.object({
  id: z.string(),
  /** Returned exactly once, at creation. It is not recoverable afterwards. */
  key: z.string(),
  name: z.string(),
  start: z.string(),
  roleSlug: z.string(),
  scopes: z.array(z.string()).nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});

export const revokeApiKeyInput = z.object({ id: z.string().min(1) });

/* --------------------------------------------------------- oauth clients */

export const oauthClientSummarySchema = z.object({
  id: z.string(),
  clientId: z.string(),
  name: z.string().nullable(),
  disabled: z.boolean(),
  roleSlug: z.string().nullable(),
  scopes: z.array(z.string()).nullable(),
  createdAt: z.string().nullable(),
});

export const listOAuthClientsInput = z.object({});
export const listOAuthClientsOutput = z.object({ items: z.array(oauthClientSummarySchema) });

export const createOAuthClientInput = z.object({
  name: z.string().min(1).max(120),
  roleSlug: builtinRoleSchema,
  /**
   * Permission slugs this machine credential may use. Required and non-empty:
   * the grant is fail-closed, so a client with no scopes can do nothing.
   */
  scopes: z.array(z.string().max(120)).min(1),
});

export const createOAuthClientOutput = z.object({
  id: z.string(),
  clientId: z.string(),
  /** Returned exactly once. */
  clientSecret: z.string(),
  name: z.string(),
  roleSlug: z.string(),
  scopes: z.array(z.string()),
  createdAt: z.string(),
});

export const revokeOAuthClientInput = z.object({ clientId: z.string().min(1) });

/* ------------------------------------------------------------ entitlements */

export const entitlementsOutput = z.object({
  planSlug: z.string(),
  status: z.string(),
  modules: z.record(z.string(), z.boolean()),
  limits: z.record(z.string(), z.number().nullable()),
});
export const getEntitlementsInput = z.object({});
