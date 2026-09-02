/**
 * Rendering one report, off the request path.
 *
 * This runs in a queue consumer with its OWN database connection, and that is
 * the whole reason it is not a `waitUntil` on the request: the request's
 * connection is closed when the response is sent, so a render continuing
 * afterwards loses its handle mid-query and leaves the report stuck in
 * `rendering` forever with nothing logged that says why.
 *
 * On the queue it also gets retries for free, and a retry is safe: the R2 key
 * is derived from the report id, so a second attempt overwrites the first
 * rather than accumulating orphaned artifacts.
 */
import { reports } from "@roastery/db/schema";
import { eq } from "drizzle-orm";
import type { Env } from "../../env";
import type { WorkerDb } from "../db/db";
import { withOrgDb } from "../db/org-db";
import { buildReport } from "./build";
import { renderArtifact } from "./render";

export async function runReport(
  db: WorkerDb,
  env: Env,
  orgId: string,
  reportId: string,
): Promise<void> {
  await withOrgDb(db, orgId, async (odb) => {
    const report = await odb.findOne(reports, eq(reports.id, reportId));
    if (!report) return;
    // Already finished, by an earlier delivery of this same message.
    if (report.status === "ready") return;

    await odb.update(
      reports,
      { status: "rendering", updatedAt: new Date() },
      eq(reports.id, reportId),
    );

    try {
      const doc = await buildReport(
        { db: odb, orgId },
        report.kind,
        (report.parameters ?? {}) as Record<string, string>,
      );
      const artifact = await renderArtifact(env, doc);

      const objectKey = `reports/${orgId}/${reportId}.${artifact.extension}`;
      await env.ROASTERY_R2.put(objectKey, artifact.body, {
        httpMetadata: { contentType: artifact.contentType },
      });

      await odb.transaction(async (tx) => {
        await tx.update(
          reports,
          {
            status: "ready",
            objectKey,
            contentType: artifact.contentType,
            sizeBytes: String(artifact.body.byteLength),
            completedAt: new Date(),
            updatedAt: new Date(),
          },
          eq(reports.id, reportId),
        );
        await tx.emit({
          type: "reporting.report.ready",
          resourceType: "report",
          resourceId: reportId,
          payload: { id: reportId, kind: report.kind, contentType: artifact.contentType },
        });
      });
    } catch (err) {
      // Recorded on the row, not just logged. A report that failed silently is
      // one a user waits on forever.
      await odb.update(
        reports,
        {
          status: "failed",
          error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
          updatedAt: new Date(),
        },
        eq(reports.id, reportId),
      );
      throw err;
    }
  });
}
