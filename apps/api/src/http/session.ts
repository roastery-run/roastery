/**
 * Who am I, and which organizations may I act in?
 *
 * Deliberately NOT an `/rpc/v1` operation. Every RPC call is tenant-scoped and
 * a session caller must name its organization in `X-Roastery-Org` — but this
 * is the question asked BEFORE any organization is known, so it cannot live
 * behind that middleware without a circular dependency the console could never
 * break out of.
 *
 * It is authenticated but not org-scoped, and it returns nothing tenant-owned:
 * only the memberships this user already has.
 */
import { organizations, orgMembers, users } from "@roastery/db/schema";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Env } from "../env";
import type { AuthVariables } from "../lib/auth/auth-middleware";

export const sessionRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

sessionRoutes.get("/session/v1/me", async (c) => {
  const auth = c.var.auth;
  if (!auth?.userId) {
    return c.json({ user: null, memberships: [] });
  }

  const rows = await c.var.unsafeDb
    .select({
      orgId: orgMembers.orgId,
      roleSlug: orgMembers.roleSlug,
      defaultLocationId: orgMembers.defaultLocationId,
      orgName: organizations.name,
      orgSlug: organizations.slug,
    })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, auth.userId));

  const [user] = await c.var.unsafeDb
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, auth.userId))
    .limit(1);

  return c.json({ user: user ?? null, memberships: rows });
});
