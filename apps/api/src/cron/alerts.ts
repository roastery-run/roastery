/**
 * The daily alert digest.
 *
 * Cron decides what work exists and does it per organization, one at a time.
 * A scan is a handful of indexed queries, so this stays inside a scheduled
 * handler's budget for a realistic number of tenants — and when it stops
 * doing so, the fix is to enqueue per org rather than to make the scan
 * cleverer.
 *
 * The whole design points at one failure mode: an alerting system fails by
 * being muted, not by missing an alert. So it is ONE email containing
 * everything, dedupe is a unique index rather than a check, and an alert is
 * only stamped as sent once it actually was.
 */
import { organizations, orgMembers, users } from "@roastery/db/schema";
import { eq } from "drizzle-orm";
import type { Env } from "../env";
import { closeWorkerDb, createWorkerDb, type WorkerDb } from "../lib/db/db";
import { withOrgDb } from "../lib/db/org-db";
import { markAlertsSent, recordNewAlerts, scanAlerts } from "../lib/domain/alerts";
import { trySend } from "../lib/email/send";
import { alertDigest } from "../lib/email/templates";

/** Who hears about it. Owners and managers, not every member. */
const NOTIFIED_ROLES = ["owner", "manager"];

export async function sendAlertDigests(env: Env): Promise<void> {
  const db = createWorkerDb(env);
  try {
    const orgs = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations);

    let scanned = 0;
    let sent = 0;

    for (const org of orgs) {
      const alerts = await withOrgDb(db, org.id, (odb) => scanAlerts(odb));
      scanned += alerts.length;
      if (!alerts.length) continue;

      // Recorded BEFORE sending, and only the new ones come back. Two
      // concurrent runs both pass a read check; only one wins the insert.
      const fresh = await withOrgDb(db, org.id, (odb) => recordNewAlerts(odb, alerts));
      if (!fresh.length) continue;

      const recipients = await notifiedAddresses(db, org.id);
      if (!recipients.length) {
        console.warn(JSON.stringify({ msg: "alert_digest_no_recipients", orgId: org.id }));
        continue;
      }

      const message = alertDigest(org.name, fresh, resolveConsoleUrl(env));
      const results = await Promise.all(recipients.map((to) => trySend(env, { to, ...message })));

      // Stamped only if somebody actually received it. Marking a failed send
      // as sent would suppress it tomorrow too, which turns one bad morning
      // into a permanently missing alert.
      if (results.some((result) => result.delivered)) {
        await withOrgDb(db, org.id, (odb) => markAlertsSent(odb, fresh));
        sent += fresh.length;
      }
    }

    console.log(JSON.stringify({ msg: "alert_digests_run", orgs: orgs.length, scanned, sent }));
  } finally {
    await closeWorkerDb(db);
  }
}

/**
 * Who hears about it.
 *
 * Owners and managers only. A digest sent to every member is one every member
 * filters, and the people who can act on an overdue fixation are the two who
 * would have been told anyway.
 */
export async function notifiedAddresses(db: WorkerDb, orgId: string): Promise<string[]> {
  const rows = await db
    .select({ email: users.email, roleSlug: orgMembers.roleSlug })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(eq(orgMembers.orgId, orgId));

  return [
    ...new Set(rows.filter((row) => NOTIFIED_ROLES.includes(row.roleSlug)).map((row) => row.email)),
  ].filter(Boolean);
}

function resolveConsoleUrl(env: Env): string {
  return (env.CONSOLE_URL ?? "https://app.roastery.run").replace(/\/$/, "");
}
