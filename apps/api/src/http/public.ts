/**
 * Unauthenticated surfaces.
 *
 * Two things live here, and both are unauthenticated for the same reason: the
 * caller has no organization in hand. A QR code on a retail bag is scanned by
 * a phone in a café; a report link is opened from an email.
 */
import { reports, traceabilityRecords } from "@roastery/db/schema";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Env } from "../env";
import { closeWorkerDb, createWorkerDb, safeExecutionCtx } from "../lib/db/db";
import { verifyDownload } from "../lib/reporting/signed-url";

export const publicRoutes = new Hono<{ Bindings: Env }>();

/**
 * The QR page's data.
 *
 * Looked up by a GLOBALLY unique token — the one place this system does not
 * scope a code per organization, because there is no organization to scope by
 * until the token is resolved. The token is 12 random bytes rather than
 * sequential, so the set of a roaster's customers cannot be enumerated.
 *
 * Serves the frozen snapshot, never a live query: lots get merged and consumed
 * after coffee ships, and a certificate must describe what was in the bag.
 */
publicRoutes.get("/trace/v1/:token", async (c) => {
  const token = c.req.param("token");
  if (!/^[0-9a-f]{24}$/.test(token)) {
    return c.json({ error: "Not found", code: "not_found" }, 404);
  }

  const db = createWorkerDb(c.env);
  try {
    const [record] = await db
      .select({
        qrToken: traceabilityRecords.qrToken,
        snapshot: traceabilityRecords.snapshot,
        issuedAt: traceabilityRecords.issuedAt,
      })
      .from(traceabilityRecords)
      .where(eq(traceabilityRecords.qrToken, token))
      .limit(1);

    if (!record) return c.json({ error: "Not found", code: "not_found" }, 404);

    const snapshot = record.snapshot as Record<string, unknown>;
    return c.json(
      { qrToken: record.qrToken, issuedAt: record.issuedAt.toISOString(), ...snapshot },
      200,
      // Public and immutable — the snapshot never changes once issued — so it
      // can be cached hard at the edge. This is the most-loaded page in the
      // system and it must not reach Postgres for every scan.
      { "Cache-Control": "public, max-age=300, s-maxage=86400" },
    );
  } finally {
    await closeWorkerDb(db, safeExecutionCtx(c));
  }
});

/**
 * Report download.
 *
 * Served by the Worker out of a private bucket. The signature covers the org,
 * the report and the expiry together, so a token cannot be moved to another
 * report, another tenant, or a later deadline.
 */
publicRoutes.get("/reports/v1/:id", async (c) => {
  const id = c.req.param("id");
  const orgId = c.req.query("org");
  const expires = Number(c.req.query("expires"));
  const token = c.req.query("token");

  if (!orgId || !token || !Number.isFinite(expires)) {
    return c.json({ error: "Invalid download link", code: "bad_request" }, 400);
  }

  const verdict = await verifyDownload(
    c.env.BETTER_AUTH_SECRET,
    { reportId: id, orgId, expiresAt: expires },
    token,
  );
  if (!verdict.ok) {
    return c.json(
      verdict.reason === "expired"
        ? { error: "This download link has expired", code: "link_expired" }
        : { error: "Invalid download link", code: "forbidden" },
      403,
    );
  }

  const db = createWorkerDb(c.env);
  try {
    const [report] = await db
      .select({
        objectKey: reports.objectKey,
        contentType: reports.contentType,
        title: reports.title,
        orgId: reports.orgId,
      })
      .from(reports)
      .where(eq(reports.id, id))
      .limit(1);

    // Belt and braces: the signature already binds the org, but a report whose
    // row says otherwise must not be served on the strength of a token alone.
    if (!report || report.orgId !== orgId || !report.objectKey) {
      return c.json({ error: "Not found", code: "not_found" }, 404);
    }

    const object = await c.env.ROASTERY_R2.get(report.objectKey);
    if (!object) return c.json({ error: "Not found", code: "not_found" }, 404);

    const extension = report.objectKey.split(".").pop() ?? "bin";
    const filename = `${report.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${extension}`;

    return new Response(object.body as unknown as ReadableStream, {
      headers: {
        "Content-Type": report.contentType ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        // Never cached: the URL is short-lived by design, and a cached copy
        // would outlive the permission that produced it.
        "Cache-Control": "private, no-store",
      },
    });
  } finally {
    await closeWorkerDb(db, safeExecutionCtx(c));
  }
});
