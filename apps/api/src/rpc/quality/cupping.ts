/**
 * Cupping: sessions, blind protocols, per-cupper scores and panel results.
 *
 * Separate from grading (./grading.ts) because they answer different
 * questions with different instruments — a cupping is a sensory panel, a
 * grading is a physical defect count — and only one of them can quarantine a
 * lot.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import {
  cuppingScores,
  cuppingSessionSamples,
  cuppingSessions,
  formTemplates,
  greenLots,
  samples,
} from "@roastery/db/schema";
import {
  createCuppingSessionInput,
  cuppingScoreSchema,
  cuppingSessionSchema,
  cuppingTableSchema,
  finalizeCuppingSessionInput,
  finalizeCuppingSessionOutput,
  getCuppingTableInput,
  listCuppingSessionsInput,
  listCuppingSessionsOutput,
  submitCuppingScoreInput,
} from "@roastery/schemas";
import { and, asc, eq, isNull, type SQL, sql } from "drizzle-orm";
import { BadRequest, Conflict, NotFound } from "../../lib/api/errors";
import { type RpcAppEnv, type RpcContext, registerRpc } from "../../lib/api/rpc";
import { isUniqueViolation } from "../../lib/db/db";
import {
  aggregatePanel,
  assignBlindCodes,
  scaTotal,
  validateScaScores,
} from "../../lib/domain/cupping";

export const qualityCupping = new OpenAPIHono<RpcAppEnv>();

registerRpc(
  qualityCupping,
  {
    namespace: "quality.cupping",
    operation: "listCuppingSessions",
    summary: "List cupping sessions",
    input: listCuppingSessionsInput,
    output: listCuppingSessionsOutput,
    permission: "quality.cupping.read",
    module: "quality",
    cacheable: { maxAgeSeconds: 20 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    if (input.filter?.status) clauses.push(eq(cuppingSessions.status, input.filter.status));
    const { items, page } = await ctx.db.find(cuppingSessions, {
      where: clauses.length ? and(...clauses) : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });

    const counts = await ctx.db.query(async (t, scope) =>
      t
        .select({
          sessionId: cuppingSessionSamples.sessionId,
          n: sql<number>`count(*)::int`,
        })
        .from(cuppingSessionSamples)
        .where(scope(cuppingSessionSamples))
        .groupBy(cuppingSessionSamples.sessionId),
    );
    const bySession = new Map(counts.map((c) => [c.sessionId, c.n]));

    return {
      items: items.map((s) => ({
        id: s.id,
        sessionNumber: s.sessionNumber,
        name: s.name,
        mode: s.mode,
        status: s.status,
        scheduledAt: s.scheduledAt?.toISOString() ?? null,
        finalizedAt: s.finalizedAt?.toISOString() ?? null,
        sampleCount: bySession.get(s.id) ?? 0,
        templateId: s.templateId ?? null,
        templateVersion: s.templateVersion ?? null,
        createdAt: s.createdAt.toISOString(),
      })),
      page,
    };
  },
);

registerRpc(
  qualityCupping,
  {
    namespace: "quality.cupping",
    operation: "createCuppingSession",
    summary: "Set up a cupping table",
    description:
      "Assigns each coffee a blind code. Codes are shuffled rather than sequential — a " +
      "cupper who notices the first cup is always the house coffee is no longer blind — " +
      "and seeded by session id so a disputed session can be re-examined.",
    input: createCuppingSessionInput,
    output: cuppingSessionSchema,
    permission: "quality.cupping.write",
    module: "quality",
  },
  async (input, ctx) => {
    const id = await ctx.db.transaction(async (tx) => {
      let session: typeof cuppingSessions.$inferSelect | undefined;
      // Pinned at creation, with the version frozen alongside the id: the
      // template can be edited mid-season, and a session has to keep asking
      // the questions its cuppers actually answered.
      const template = input.templateId
        ? await tx.findOne(formTemplates, eq(formTemplates.id, input.templateId))
        : (
            await tx.find(formTemplates, {
              where: and(
                eq(formTemplates.kind, "cupping_sheet"),
                eq(formTemplates.isDefault, true),
                isNull(formTemplates.archivedAt),
              ),
              limit: 1,
            })
          ).items[0];
      if (input.templateId && !template) throw new NotFound("No form template with that id");

      try {
        [session] = await tx.insert(cuppingSessions, {
          sessionNumber: input.sessionNumber,
          name: input.name,
          mode: input.mode,
          status: "scheduled",
          templateId: template?.id ?? null,
          templateVersion: template?.version ?? null,
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new Conflict(`Session "${input.sessionNumber}" already exists`);
        }
        throw err;
      }
      if (!session) throw new Error("Insert returned no row");

      const codes = assignBlindCodes(input.samples.length, session.id);
      await tx.insert(
        cuppingSessionSamples,
        input.samples.map((s, i) => ({
          sessionId: session.id,
          position: i,
          blindCode: codes[i] ?? `S${i}`,
          sampleId: s.sampleId ?? null,
          greenLotId: s.greenLotId ?? null,
          roastedLotId: s.roastedLotId ?? null,
          roastBatchId: s.roastBatchId ?? null,
        })),
      );
      return session.id;
    });

    const session = await ctx.db.findOne(cuppingSessions, eq(cuppingSessions.id, id));
    if (!session) throw new NotFound("Session not found");
    return {
      id: session.id,
      sessionNumber: session.sessionNumber,
      name: session.name,
      mode: session.mode,
      status: session.status,
      scheduledAt: session.scheduledAt?.toISOString() ?? null,
      finalizedAt: session.finalizedAt?.toISOString() ?? null,
      sampleCount: input.samples.length,
      templateId: session.templateId ?? null,
      templateVersion: session.templateVersion ?? null,
      createdAt: session.createdAt.toISOString(),
    };
  },
);

async function tableRows(ctx: RpcContext, sessionId: string) {
  return ctx.db.query(async (t, scope) =>
    t
      .select()
      .from(cuppingSessionSamples)
      .where(and(scope(cuppingSessionSamples), eq(cuppingSessionSamples.sessionId, sessionId)))
      .orderBy(asc(cuppingSessionSamples.position)),
  );
}

registerRpc(
  qualityCupping,
  {
    namespace: "quality.cupping",
    operation: "getCuppingTable",
    summary: "The table as a cupper sees it",
    description:
      "In a blind session the identity of each coffee is OMITTED from the response, not " +
      "merely hidden by the interface: a cupper who can read it out of the network " +
      "traffic is not blind, whatever the screen shows. Identities appear once the " +
      "session is finalized.",
    input: getCuppingTableInput,
    output: cuppingTableSchema,
    permission: "quality.cupping.read",
    module: "quality",
  },
  async (input, ctx) => {
    const session = await ctx.db.findOne(cuppingSessions, eq(cuppingSessions.id, input.sessionId));
    if (!session) throw new NotFound("Session not found");

    const rows = await tableRows(ctx, session.id);
    const reveal = session.mode === "open" || session.status === "finalized";

    const labels = new Map<string, string>();
    if (reveal) {
      for (const r of rows) {
        if (r.greenLotId) {
          const lot = await ctx.db.findOne(greenLots, eq(greenLots.id, r.greenLotId));
          if (lot) labels.set(r.id, `${lot.name} (${lot.lotCode})`);
        } else if (r.sampleId) {
          const sample = await ctx.db.findOne(samples, eq(samples.id, r.sampleId));
          if (sample) labels.set(r.id, `${sample.name} (${sample.sampleNumber})`);
        }
      }
    }

    return {
      sessionId: session.id,
      mode: session.mode,
      status: session.status,
      templateId: session.templateId ?? null,
      samples: rows.map((r) => ({
        id: r.id,
        position: r.position,
        blindCode: r.blindCode,
        identity: reveal
          ? {
              sampleId: r.sampleId ?? null,
              greenLotId: r.greenLotId ?? null,
              label: labels.get(r.id) ?? "(unlabelled)",
            }
          : null,
        avgTotalScore: r.avgTotalScore ?? null,
        scoreCount: r.scoreCount,
        scoreStdDev: r.scoreStdDev ?? null,
      })),
    };
  },
);

registerRpc(
  qualityCupping,
  {
    namespace: "quality.cupping",
    operation: "submitCuppingScore",
    summary: "Score one coffee",
    description:
      "Scores must sit between 6.00 and 10.00 in quarter points. That is not formatting " +
      "fussiness: a score is a claim a supplier may dispute, and a 7.3 on a " +
      "quarter-point scale means the sheet was not filled as the standard requires.",
    input: submitCuppingScoreInput,
    output: cuppingScoreSchema,
    permission: "quality.cupping.write",
    module: "quality",
  },
  async (input, ctx) => {
    const validation = validateScaScores(input.scores);
    if (!validation.ok) throw new BadRequest(validation.errors.join("; "));

    const sample = await ctx.db.findOne(
      cuppingSessionSamples,
      eq(cuppingSessionSamples.id, input.sessionSampleId),
    );
    if (!sample) throw new NotFound("That coffee is not on this table");

    const session = await ctx.db.findOne(cuppingSessions, eq(cuppingSessions.id, sample.sessionId));
    // Reopening a finalized session would change a published result without
    // trace; a correction should be a new session, which is auditable.
    if (session?.status === "finalized") {
      throw new Conflict("This session is finalized and can no longer be scored");
    }

    const total = scaTotal(input.scores, input.defectsPenalty);
    const cupperUserId = ctx.actor.userId;

    let row: typeof cuppingScores.$inferSelect | undefined;
    try {
      [row] = await ctx.db.insert(cuppingScores, {
        sessionSampleId: input.sessionSampleId,
        cupperUserId,
        cupperName: input.cupperName ?? null,
        totalScore: total.toFixed(2),
        ...Object.fromEntries(
          Object.entries(input.scores).map(([k, v]) => [k, v === undefined ? null : v.toFixed(2)]),
        ),
        defectsPenalty: input.defectsPenalty.toFixed(2),
        descriptors: input.descriptors ?? [],
        notes: input.notes ?? null,
        // Stored verbatim against the session's pinned template version. Not
        // re-validated here: the template that governs them may since have
        // been superseded, and rejecting a valid answer because the CURRENT
        // version dropped the field would lose the cupper's work.
        responses: input.responses ?? null,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Conflict("This cupper has already scored this coffee");
      }
      throw err;
    }
    if (!row) throw new Error("Insert returned no row");

    if (session?.status === "scheduled") {
      await ctx.db.update(
        cuppingSessions,
        { status: "in_progress", updatedAt: new Date() },
        eq(cuppingSessions.id, session.id),
      );
    }

    return {
      id: row.id,
      sessionSampleId: row.sessionSampleId,
      cupperName: row.cupperName ?? null,
      totalScore: row.totalScore ?? null,
      defectsPenalty: row.defectsPenalty,
      descriptors: row.descriptors ?? [],
      submittedAt: row.submittedAt.toISOString(),
    };
  },
);

registerRpc(
  qualityCupping,
  {
    namespace: "quality.cupping",
    operation: "finalizeCuppingSession",
    summary: "Close a session and publish its results",
    description:
      "Aggregates each coffee's scores and stores the SPREAD alongside the mean. An 85 " +
      "with every cupper within half a point is a confident result; the same 85 from " +
      "scores of 80 and 90 is not, and quoting the mean alone would hide that.",
    input: finalizeCuppingSessionInput,
    output: finalizeCuppingSessionOutput,
    permission: "quality.cupping.write",
    module: "quality",
  },
  async (input, ctx) => {
    const session = await ctx.db.findOne(cuppingSessions, eq(cuppingSessions.id, input.sessionId));
    if (!session) throw new NotFound("Session not found");
    if (session.status === "finalized") throw new Conflict("This session is already finalized");

    const rows = await tableRows(ctx, session.id);
    const results: (typeof finalizeCuppingSessionOutput)["_output"]["results"] = [];

    for (const row of rows) {
      const scores = await ctx.db.query(async (t, scope) =>
        t
          .select({
            totalScore: cuppingScores.totalScore,
            cupperUserId: cuppingScores.cupperUserId,
            cupperName: cuppingScores.cupperName,
          })
          .from(cuppingScores)
          .where(and(scope(cuppingScores), eq(cuppingScores.sessionSampleId, row.id))),
      );

      const panel = aggregatePanel(
        scores.map((s) => ({
          cupper: s.cupperName ?? s.cupperUserId ?? "unknown",
          total: Number.parseFloat(s.totalScore ?? "0"),
        })),
      );

      await ctx.db.update(
        cuppingSessionSamples,
        {
          avgTotalScore: panel ? panel.average.toFixed(2) : null,
          scoreCount: panel?.count ?? 0,
          scoreStdDev: panel ? panel.stdDev.toFixed(3) : null,
        },
        eq(cuppingSessionSamples.id, row.id),
      );

      let label = row.blindCode;
      if (row.greenLotId) {
        const lot = await ctx.db.findOne(greenLots, eq(greenLots.id, row.greenLotId));
        if (lot) label = `${lot.name} (${lot.lotCode})`;
      }

      results.push({
        sessionSampleId: row.id,
        blindCode: row.blindCode,
        label,
        average: panel?.average ?? null,
        stdDev: panel?.stdDev ?? null,
        count: panel?.count ?? 0,
        outliers: panel?.outliers ?? [],
      });
    }

    await ctx.db.transaction(async (tx) => {
      await tx.update(
        cuppingSessions,
        { status: "finalized", finalizedAt: new Date(), updatedAt: new Date() },
        eq(cuppingSessions.id, session.id),
      );
      await tx.emit({
        type: "quality.cupping_session.finalized",
        resourceType: "cupping_session",
        resourceId: session.id,
        payload: {
          id: session.id,
          name: session.name,
          // Scores WITH their spread. An 85 from a panel that agreed and an 85
          // from scores of 80 and 90 are different facts, and a receiver that
          // only ever sees the mean cannot tell them apart.
          results: results.map((r) => ({
            sessionSampleId: r.sessionSampleId,
            average: r.average,
            stdDev: r.stdDev,
          })),
        },
      });
    });

    return { sessionId: session.id, status: "finalized" as const, results };
  },
);
