import { auditEvents } from "@roastery/db/schema";
import type { WorkerDb } from "./db";
import type { Actor } from "./org-db";

export async function logAudit(
  db: WorkerDb,
  event: {
    orgId?: string | null;
    actor: Actor;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(auditEvents).values({
    orgId: event.orgId ?? null,
    actorId: event.actor.id,
    actorType: event.actor.type,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId ?? null,
    metadata: event.metadata ?? null,
  });
}
