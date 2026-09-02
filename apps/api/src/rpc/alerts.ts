/**
 * What needs attention.
 *
 * A flat file rather than a directory: alerts are one namespace, and they are
 * cross-cutting by nature — a contract milestone, a green lot below its
 * minimum and a material at its reorder point are the same question asked of
 * three domains, which is exactly why none of those domains owns this.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { alertNotifications } from "@roastery/db/schema";
import { listAlertsInput, listAlertsOutput } from "@roastery/schemas";
import { and, eq, inArray } from "drizzle-orm";
import { type RpcAppEnv, registerRpc } from "../lib/api/rpc";
import { scanAlerts } from "../lib/domain/alerts";

export const alerts = new OpenAPIHono<RpcAppEnv>();

registerRpc(
  alerts,
  {
    namespace: "alerts",
    operation: "listAlerts",
    summary: "List what needs attention",
    description:
      "The live scan, not the digest log. An alert emailed this morning and resolved at " +
      "ten is no longer outstanding and is not returned — `notifiedAt` says whether a " +
      "digest has already carried it today.",
    input: listAlertsInput,
    output: listAlertsOutput,
    permission: "alerts.read",
    module: "core",
    // Short: the scan is three indexed reads, and a stale "needs attention"
    // panel is worse than a slightly slower one.
    cacheable: { maxAgeSeconds: 30 },
  },
  async (input, ctx) => {
    const scanned = await scanAlerts(ctx.db);
    const items = input.filter?.severity
      ? scanned.filter((a) => a.severity === input.filter?.severity)
      : scanned;

    const digestDate = new Date().toISOString().slice(0, 10);
    const subjects = items.map((a) => a.subjectId);
    const sent = subjects.length
      ? await ctx.db.find(alertNotifications, {
          where: and(
            eq(alertNotifications.digestDate, digestDate),
            inArray(alertNotifications.subjectId, subjects),
          ),
          limit: 500,
        })
      : { items: [] };

    // Keyed on (rule, subject) to match the dedupe index: one subject can be
    // both below its minimum and overdue, and those are separate alerts.
    const notified = new Map(
      sent.items.map((row) => [`${row.ruleId}:${row.subjectId}`, row.sentAt]),
    );

    return {
      items: items.map((a) => ({
        ...a,
        notifiedAt: notified.get(`${a.ruleId}:${a.subjectId}`)?.toISOString() ?? null,
      })),
      counts: {
        critical: items.filter((a) => a.severity === "critical").length,
        warning: items.filter((a) => a.severity === "warning").length,
        info: items.filter((a) => a.severity === "info").length,
      },
    };
  },
);
