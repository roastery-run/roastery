import { orgEntitlementOverrides, orgSubscriptions, planEntitlements } from "@roastery/db/schema";
import type { ModuleKey } from "@roastery/schemas";
import { eq } from "drizzle-orm";
import type { Env } from "../env";
import type { WorkerDb } from "./db";

export type Entitlements = {
  planSlug: string;
  status: string;
  /** `module:<key>` → boolean, `limit:<key>` → number | null (null = unlimited) */
  values: Record<string, unknown>;
};

export type EntitlementCheck =
  | { ok: true }
  | { ok: false; reason: "module"; availableOn: string[] }
  | { ok: false; reason: "quota"; key: string; limit: number; current: number };

export function entitlementEpochKey(orgId: string): string {
  return `ent-epoch:${orgId}`;
}

export async function bumpEntitlementEpoch(env: Env, orgId: string): Promise<void> {
  await env.ROASTERY_KV.put(entitlementEpochKey(orgId), String(Date.now()));
}

/**
 * Effective entitlements = plan defaults, overlaid with per-org overrides.
 *
 * Add-ons and negotiated limits are both just overrides, so there is one
 * resolution path rather than a separate add-on concept to keep in sync.
 * Expired overrides are ignored rather than deleted, so the history of what
 * was granted and when stays answerable.
 */
export async function loadEntitlements(
  env: Env,
  db: WorkerDb,
  orgId: string,
): Promise<Entitlements> {
  const epoch = (await env.ROASTERY_KV.get(entitlementEpochKey(orgId))) ?? "0";
  const kvKey = `ent:${orgId}:${epoch}`;

  const cached = await env.ROASTERY_KV.get<Entitlements>(kvKey, "json");
  if (cached) return cached;

  const [sub] = await db
    .select()
    .from(orgSubscriptions)
    .where(eq(orgSubscriptions.orgId, orgId))
    .limit(1);

  // No subscription row means the org predates billing or was created by a
  // seed. Treat it as the free tier rather than failing every request.
  const planSlug = sub?.planSlug ?? "starter";
  const status = sub?.status ?? "active";

  const planRows = await db
    .select({ key: planEntitlements.key, value: planEntitlements.value })
    .from(planEntitlements)
    .where(eq(planEntitlements.planSlug, planSlug));

  const overrideRows = await db
    .select()
    .from(orgEntitlementOverrides)
    .where(eq(orgEntitlementOverrides.orgId, orgId));

  const values: Record<string, unknown> = {};
  for (const row of planRows) values[row.key] = row.value;
  const now = Date.now();
  for (const row of overrideRows) {
    if (row.expiresAt && row.expiresAt.getTime() < now) continue;
    values[row.key] = row.value;
  }

  const result: Entitlements = { planSlug, status, values };
  await env.ROASTERY_KV.put(kvKey, JSON.stringify(result), { expirationTtl: 300 });
  return result;
}

/** Which plans include a module — used to make a 402 actionable. */
export async function plansOfferingModule(db: WorkerDb, module: ModuleKey): Promise<string[]> {
  const rows = await db
    .select({
      plan: planEntitlements.planSlug,
      key: planEntitlements.key,
      value: planEntitlements.value,
    })
    .from(planEntitlements)
    .where(eq(planEntitlements.key, `module:${module}`));
  return rows.filter((r) => r.value === true).map((r) => r.plan);
}

export function hasModule(ents: Entitlements, module: ModuleKey): boolean {
  // `core` is implicit: it is what every plan, including the free tier, gets.
  if (module === "core") return true;
  return ents.values[`module:${module}`] === true;
}

export function limitFor(ents: Entitlements, key: string): number | null {
  const raw = ents.values[`limit:${key}`];
  if (raw === null || raw === undefined || raw === "unlimited") return null;
  return typeof raw === "number" ? raw : Number(raw);
}

/**
 * Raised when an organization is at a plan limit.
 *
 * A 402, not a 403: the caller is permitted to do this, the plan is what
 * stands in the way. Keeping the two apart is what lets the console show an
 * upgrade path rather than a generic "forbidden", and it is why permission is
 * checked FIRST — someone who could not perform the action anyway learns
 * nothing about the plan.
 */
export class QuotaExceeded extends Error {
  readonly status = 402 as const;
  readonly code = "quota_exceeded" as const;

  constructor(
    readonly key: string,
    readonly limit: number,
    readonly current: number,
  ) {
    super(`Your plan allows ${limit} ${key}; this organization already has ${current}.`);
    this.name = "QuotaExceeded";
  }
}

/**
 * Enforces a counted plan limit at the operation that grows the count.
 *
 * `count` is a callback rather than a number so the query is skipped entirely
 * for an unlimited plan — the common case for the tiers that matter, and there
 * is no reason to make them pay for a COUNT they can never fail.
 */
export async function requireQuota(
  ctx: { entitlements: Entitlements },
  key: string,
  count: () => Promise<number>,
): Promise<void> {
  const limit = limitFor(ctx.entitlements, key);
  if (limit === null) return;
  const current = await count();
  if (current >= limit) throw new QuotaExceeded(key, limit, current);
}
