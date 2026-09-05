import { auditEvents, orgMembers, users } from "@roastery/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canGrantRole } from "../src/lib/auth/permissions";
import type { WorkerDb } from "../src/lib/db/db";
import type { OrgDb } from "../src/lib/db/org-db";
import { connect, createTestOrg, dropTestOrg, hasTestDb, orgDb } from "./helpers/db";

/**
 * Membership and credential changes leave a trail.
 *
 * These six mutations — who is an owner, which API keys exist, which machine
 * credentials exist — are the ones an incident review asks about first, and
 * they were the only mutations in the system that emitted nothing at all.
 * `console.audit.read` and an audit screen both existed; neither could show
 * that somebody had made themselves an owner.
 *
 * The emits carry no published event type on purpose: who can do what inside
 * one tenant is not an integrator's notification, and adding it to the webhook
 * contract would ship membership changes to everyone subscribed.
 */
describe.skipIf(!hasTestDb)("console audit trail", () => {
  let db: WorkerDb;
  let close: () => Promise<void>;
  const orgs: string[] = [];
  let scoped: OrgDb;

  beforeAll(async () => {
    ({ db, close } = connect());
  });

  beforeEach(async () => {
    const orgId = await createTestOrg(db);
    orgs.push(orgId);
    scoped = orgDb(db, orgId);
  });

  afterAll(async () => {
    for (const orgId of orgs) await dropTestOrg(db, orgId);
    await close?.();
  });

  async function auditRows(resourceType: string) {
    return scoped.query(async (t, scope) =>
      t
        .select()
        .from(auditEvents)
        .where(and(scope(auditEvents), eq(auditEvents.resourceType, resourceType))),
    );
  }

  it("records a role change with what it changed from and to", async () => {
    const [user] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        email: `u-${crypto.randomUUID()}@example.test`,
        name: "U",
      })
      .returning();
    if (!user) throw new Error("no user");
    await scoped.insert(orgMembers, { userId: user.id, roleSlug: "roaster" });

    // The shape the handler uses: read the old value, write the new one and
    // the audit row, in one transaction.
    await scoped.transaction(async (tx) => {
      await tx.update(orgMembers, { roleSlug: "manager" }, eq(orgMembers.userId, user.id));
      await tx.emit({
        type: null,
        resourceType: "org_member",
        resourceId: user.id,
        action: "role_changed",
        audit: { from: "roaster", to: "manager" },
      });
    });

    const rows = await auditRows("org_member");
    expect(rows).toHaveLength(1);
    // recordChange namespaces the verb with the resource type, so the audit
    // log reads `org_member.role_changed` rather than a bare `role_changed`
    // that could mean any of a dozen resources.
    expect(rows[0]?.action).toBe("org_member.role_changed");
    expect(rows[0]?.resourceId).toBe(user.id);
    expect(rows[0]?.metadata).toMatchObject({ from: "roaster", to: "manager" });
  });

  it("rolls the audit row back with the change it describes", async () => {
    const [user] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        email: `u-${crypto.randomUUID()}@example.test`,
        name: "U",
      })
      .returning();
    if (!user) throw new Error("no user");
    await scoped.insert(orgMembers, { userId: user.id, roleSlug: "roaster" });

    // An audit row that survives a failed change is worse than none: it says
    // something happened that did not.
    await expect(
      scoped.transaction(async (tx) => {
        await tx.update(orgMembers, { roleSlug: "manager" }, eq(orgMembers.userId, user.id));
        await tx.emit({
          type: null,
          resourceType: "org_member",
          resourceId: user.id,
          action: "role_changed",
        });
        throw new Error("failed after the audit row");
      }),
    ).rejects.toThrow();

    expect(await auditRows("org_member")).toHaveLength(0);
    const [member] = await scoped.query(async (t, scope) =>
      t
        .select({ roleSlug: orgMembers.roleSlug })
        .from(orgMembers)
        .where(and(scope(orgMembers), eq(orgMembers.userId, user.id)))
        .limit(1),
    );
    expect(member?.roleSlug).toBe("roaster");
  });

  it("never records the key itself, only which key and what it can do", async () => {
    await scoped.emit({
      type: null,
      resourceType: "api_key",
      resourceId: "key-1",
      action: "created",
      audit: { name: "Bridge", start: "sk_abc123", roleSlug: "roaster" },
    });

    const rows = await auditRows("api_key");
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]?.metadata)).not.toMatch(/secret|clientSecret/i);
    expect(rows[0]?.metadata).toMatchObject({ roleSlug: "roaster" });
  });
});

/**
 * The escalation guard.
 *
 * `console.credentials.write` says a role may issue credentials; it does not
 * say which. Comparing permission sets is what stops it issuing one more
 * capable than the issuer — and it is deliberately not a comparison of
 * `roles.rank`, which the schema and the seed both document as never being an
 * authorization input.
 */
describe("canGrantRole", () => {
  const set = (...perms: string[]) => new Set(perms);

  it("lets an owner grant anything", () => {
    expect(canGrantRole(set("*"), set("inventory.green.write", "console.members.write"))).toBe(
      true,
    );
  });

  it("refuses to grant a permission the granter does not hold", () => {
    // The escalation: a role that can issue credentials, issuing one that can
    // do more than it can.
    expect(canGrantRole(set("console.credentials.write"), set("*"))).toBe(false);
    expect(canGrantRole(set("console.credentials.write"), set("inventory.green.write"))).toBe(
      false,
    );
  });

  it("honours a wildcard the granter actually holds", () => {
    expect(canGrantRole(set("inventory.*"), set("inventory.green.write"))).toBe(true);
    // A prefix wildcard does not cover a different branch.
    expect(canGrantRole(set("inventory.*"), set("orders.write"))).toBe(false);
  });

  it("does not let an enumerated set satisfy a wildcard", () => {
    // `*` means "everything, including permissions that do not exist yet", so
    // only `*` can confer it.
    expect(canGrantRole(set("inventory.green.write", "orders.write"), set("*"))).toBe(false);
  });
});
