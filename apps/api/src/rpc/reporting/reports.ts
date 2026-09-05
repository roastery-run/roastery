/**
 * Report generation and download.
 *
 * A report row exists before its artifact does, so "still rendering" is a state
 * a caller can poll rather than a request that hangs for thirty seconds. The
 * artifact goes to R2 and is served BY THE WORKER behind a signed, expiring
 * link — never from a public bucket, because a valuation or a customer list
 * gets forwarded, and a public URL is permanent and unrevocable.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { reports } from "@roastery/db/schema";
import {
  downloadUrlInput,
  downloadUrlOutput,
  generateReportInput,
  getReportInput,
  listReportsInput,
  listReportsOutput,
  reportSchema,
} from "@roastery/schemas";
import { and, eq, type SQL } from "drizzle-orm";
import { BadRequest, Conflict, NotFound } from "../../lib/api/errors";
import { type RpcAppEnv, registerRpc } from "../../lib/api/rpc";
import {
  DEFAULT_TTL_SECONDS,
  downloadSigningKey,
  signDownload,
} from "../../lib/reporting/signed-url";

export const reporting = new OpenAPIHono<RpcAppEnv>();

function reportDto(r: typeof reports.$inferSelect) {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    title: r.title,
    parameters: r.parameters,
    contentType: r.contentType ?? null,
    sizeBytes: r.sizeBytes ?? null,
    error: r.error ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

const TITLES: Record<string, string> = {
  traceability_certificate: "Traceability certificate",
  inventory_valuation: "Inventory valuation",
  production_summary: "Production summary",
  quality_summary: "Quality summary",
  cafe_performance: "Café performance",
};

registerRpc(
  reporting,
  {
    namespace: "reporting",
    operation: "generateReport",
    summary: "Generate a report",
    description:
      "Returns as soon as the report row exists. Rendering happens in the background; " +
      "poll `getReport` until the status is `ready`, then ask for a download link.",
    input: generateReportInput,
    output: reportSchema,
    permission: "reporting.read",
    module: "core",
  },
  async (input, ctx) => {
    const row = await ctx.db.transaction(async (tx) => {
      const [created] = await tx.insert(reports, {
        kind: input.kind,
        title: input.title ?? TITLES[input.kind] ?? "Report",
        parameters: input.parameters,
        status: "queued",
        requestedBy: ctx.actor.userId,
      });
      if (!created) throw new Error("Insert returned no row");
      return created;
    });

    // Handed to the queue rather than rendered here. A report can take tens
    // of seconds; the caller must not hold a connection open for it, and the
    // renderer needs a database handle that outlives this request.
    if (ctx.env.REPORT_QUEUE) {
      await ctx.env.REPORT_QUEUE.send({ reportId: row.id, orgId: ctx.orgId });
    }

    return reportDto(row);
  },
);

registerRpc(
  reporting,
  {
    namespace: "reporting",
    operation: "getReport",
    summary: "A report and its status",
    input: getReportInput,
    output: reportSchema,
    permission: "reporting.read",
    module: "core",
  },
  async (input, ctx) => {
    const row = await ctx.db.findOne(reports, eq(reports.id, input.id));
    if (!row) throw new NotFound("Report not found");
    return reportDto(row);
  },
);

registerRpc(
  reporting,
  {
    namespace: "reporting",
    operation: "listReports",
    summary: "List reports",
    input: listReportsInput,
    output: listReportsOutput,
    permission: "reporting.read",
    module: "core",
    cacheable: { maxAgeSeconds: 15 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    if (input.filter?.kind) clauses.push(eq(reports.kind, input.filter.kind));
    if (input.filter?.status) clauses.push(eq(reports.status, input.filter.status));
    const { items, page } = await ctx.db.find(reports, {
      where: clauses.length ? and(...clauses) : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return { items: items.map(reportDto), page };
  },
);

registerRpc(
  reporting,
  {
    namespace: "reporting",
    operation: "getDownloadUrl",
    summary: "A time-limited download link",
    description:
      "The link stops working when it expires. That is the difference between sharing a " +
      "document and publishing one: reports get forwarded, and a public bucket URL is " +
      "permanent and cannot be revoked.",
    input: downloadUrlInput,
    output: downloadUrlOutput,
    permission: "reporting.read",
    module: "core",
  },
  async (input, ctx) => {
    const row = await ctx.db.findOne(reports, eq(reports.id, input.id));
    if (!row) throw new NotFound("Report not found");
    if (row.status === "failed")
      throw new BadRequest(`This report failed: ${row.error ?? "unknown"}`);
    if (row.status !== "ready" || !row.objectKey) {
      throw new Conflict(`This report is still ${row.status}`);
    }

    const ttl = input.expiresInSeconds ?? DEFAULT_TTL_SECONDS;
    const expiresAt = Math.floor(Date.now() / 1000) + ttl;
    const { token } = await signDownload(downloadSigningKey(ctx.env), {
      reportId: row.id,
      orgId: ctx.orgId,
      expiresAt,
    });

    const base = ctx.env.BETTER_AUTH_URL.replace(/\/$/, "");
    return {
      url: `${base}/reports/v1/${row.id}?org=${ctx.orgId}&expires=${expiresAt}&token=${token}`,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      contentType: row.contentType ?? "application/octet-stream",
    };
  },
);
