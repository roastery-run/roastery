import { createMiddleware } from "hono/factory";
import type { Env } from "../env";
import { hasModule, plansOfferingModule } from "./entitlements";
import { can } from "./permissions";
import { RPC_BY_PATH, type RpcVariables } from "./rpc";

/**
 * Enforces entitlement and permission BEFORE Hono's Zod validator runs.
 *
 * Order matters and is deliberate:
 *   401 authn → 403 org access (orgScope) → 402 entitlement → 403 permission
 *
 * Entitlement is checked after org access so a 402 never confirms the
 * existence of an organization the caller does not belong to. Permission is
 * checked last because it is the cheapest and least informative denial — a
 * viewer who cannot perform an action never learns anything about the plan.
 */
export const rpcAuthorize = createMiddleware<{ Bindings: Env; Variables: RpcVariables }>(
  async (c, next) => {
    const def = RPC_BY_PATH.get(c.req.path);
    // A route under /rpc/v1 with no registry entry is a bug, not a public
    // endpoint. Refusing it is what makes the registry authoritative.
    if (!def) {
      return c.json({ error: "Not found", code: "unknown_operation" }, 404);
    }

    if (!hasModule(c.var.entitlements, def.module)) {
      const requiredPlans = await plansOfferingModule(c.var.unsafeDb, def.module);
      return c.json(
        {
          error: `Your plan does not include the ${def.module} module.`,
          code: "entitlement_required" as const,
          module: def.module,
          plan: c.var.entitlements.planSlug,
          requiredPlans,
        },
        402,
      );
    }

    if (!can(c.var.perms, def.permission)) {
      return c.json(
        { error: "Forbidden", code: "permission_denied", required: def.permission },
        403,
      );
    }

    await next();
    return undefined;
  },
);
