import { OpenAPIHono } from "@hono/zod-openapi";
import {
  cuppingScores,
  cuppingSessionSamples,
  cuppingSessions,
  greenGradings,
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
  greenGradingSchema,
  listCuppingSessionsInput,
  listCuppingSessionsOutput,
  listGradingsInput,
  listGradingsOutput,
  recordGradingInput,
  releaseQuarantineInput,
  submitCuppingScoreInput,
} from "@roastery/schemas";
import { and, asc, eq, type SQL, sql } from "drizzle-orm";
import {
  aggregatePanel,
  assignBlindCodes,
  fullDefectEquivalents,
  gradePasses,
  scaTotal,
  validateScaScores,
} from "../lib/cupping";
import { isUniqueViolation } from "../lib/db";
import { BadRequest, Conflict, NotFound } from "../lib/errors";
import { type RpcAppEnv, type RpcContext, registerRpc } from "../lib/rpc";

export const quality = new OpenAPIHono<RpcAppEnv>();

registerRpc(
  quality,
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
        createdAt: s.createdAt.toISOString(),
      })),
      page,
    };
  },
);

registerRpc(
  quality,
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
      try {
        [session] = await tx.insert(cuppingSessions, {
          sessionNumber: input.sessionNumber,
          name: input.name,
          mode: input.mode,
          status: "scheduled",
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
  quality,
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
  quality,
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
  quality,
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

    await ctx.db.update(
      cuppingSessions,
      { status: "finalized", finalizedAt: new Date(), updatedAt: new Date() },
      eq(cuppingSessions.id, session.id),
    );

    return { sessionId: session.id, status: "finalized" as const, results };
  },
);

/* --------------------------------------------------------------- grading */

function gradingDto(g: typeof greenGradings.$inferSelect) {
  return {
    id: g.id,
    greenLotId: g.greenLotId ?? null,
    sampleId: g.sampleId ?? null,
    standard: g.standard,
    moisturePct: g.moisturePct ?? null,
    waterActivity: g.waterActivity ?? null,
    screenSizeAvg: g.screenSizeAvg ?? null,
    defectsPrimary: g.defectsPrimary,
    defectsSecondary: g.defectsSecondary,
    fullDefectEquivalents: g.fullDefectEquivalents ?? null,
    grade: g.grade ?? null,
    passed: g.passed,
    notes: g.notes ?? null,
    createdAt: g.createdAt.toISOString(),
  };
}

registerRpc(
  quality,
  {
    namespace: "quality.grading",
    operation: "recordGrading",
    summary: "Record a physical grading",
    description:
      "A FAILING grading quarantines the lot, which blocks it from being reserved. The " +
      "point of grading is to stop coffee reaching production, so a result that is " +
      "recorded but not enforced is decoration.",
    input: recordGradingInput,
    output: greenGradingSchema,
    permission: "quality.grading.write",
    module: "quality",
  },
  async (input, ctx) => {
    if (!input.greenLotId && !input.sampleId) {
      throw new BadRequest("A grading must reference a green lot or a sample");
    }

    const equivalents = fullDefectEquivalents(input.defectsPrimary, input.defectsSecondary);
    const passed = gradePasses(input.defectsPrimary, input.defectsSecondary);

    const [row] = await ctx.db.insert(greenGradings, {
      greenLotId: input.greenLotId ?? null,
      sampleId: input.sampleId ?? null,
      standard: input.standard,
      graderUserId: ctx.actor.userId,
      moisturePct: input.moisturePct?.toFixed(2) ?? null,
      waterActivity: input.waterActivity?.toFixed(3) ?? null,
      screenSizeAvg: input.screenSizeAvg?.toFixed(2) ?? null,
      densityGPerL: input.densityGPerL?.toFixed(2) ?? null,
      defectsPrimary: input.defectsPrimary,
      defectsSecondary: input.defectsSecondary,
      fullDefectEquivalents: equivalents.toFixed(2),
      grade: passed ? "specialty" : "below_specialty",
      passed,
      screenDistribution: input.screenDistribution ?? null,
      defectCounts: input.defectCounts ?? null,
      notes: input.notes ?? null,
    });
    if (!row) throw new Error("Insert returned no row");

    // The enforcement. Without it a grading is a note nobody has to act on.
    if (!passed && input.greenLotId) {
      await ctx.db.update(
        greenLots,
        { status: "quarantined", updatedAt: new Date() },
        eq(greenLots.id, input.greenLotId),
      );
    }

    return gradingDto(row);
  },
);

registerRpc(
  quality,
  {
    namespace: "quality.grading",
    operation: "listGradings",
    summary: "List gradings",
    input: listGradingsInput,
    output: listGradingsOutput,
    permission: "quality.grading.read",
    module: "quality",
    cacheable: { maxAgeSeconds: 20 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    if (input.filter?.greenLotId)
      clauses.push(eq(greenGradings.greenLotId, input.filter.greenLotId));
    if (input.filter?.passed !== undefined)
      clauses.push(eq(greenGradings.passed, input.filter.passed));
    const { items, page } = await ctx.db.find(greenGradings, {
      where: clauses.length ? and(...clauses) : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return { items: items.map(gradingDto), page };
  },
);

registerRpc(
  quality,
  {
    namespace: "quality.grading",
    operation: "releaseQuarantine",
    summary: "Release a quarantined lot",
    description:
      "Requires a reason, recorded on the lot. Releasing coffee that failed grading is a " +
      "decision someone should have to own, and one an auditor will ask about.",
    input: releaseQuarantineInput,
    output: greenGradingSchema,
    permission: "quality.grading.write",
    module: "quality",
  },
  async (input, ctx) => {
    const lot = await ctx.db.findOne(greenLots, eq(greenLots.id, input.greenLotId));
    if (!lot) throw new NotFound("Lot not found");
    if (lot.status !== "quarantined") throw new BadRequest("This lot is not quarantined");

    await ctx.db.update(
      greenLots,
      {
        status: "available",
        notes: `${lot.notes ? `${lot.notes}\n` : ""}Quarantine released: ${input.reason}`,
        updatedAt: new Date(),
      },
      eq(greenLots.id, input.greenLotId),
    );

    const [latest] = await ctx.db.query(async (t, scope) =>
      t
        .select()
        .from(greenGradings)
        .where(and(scope(greenGradings), eq(greenGradings.greenLotId, input.greenLotId)))
        .orderBy(asc(greenGradings.createdAt))
        .limit(1),
    );
    if (!latest) throw new NotFound("No grading found for this lot");
    return gradingDto(latest);
  },
);
