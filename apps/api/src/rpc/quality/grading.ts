/**
 * Physical grading: defect counts, screen size, moisture, and the quarantine
 * that a failing result enforces.
 *
 * Separate from cupping (./cupping.ts): grading is what stops coffee reaching
 * production, so it writes to inventory in a way a sensory score never does.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { greenGradings, greenLots } from "@roastery/db/schema";
import {
  greenGradingSchema,
  listGradingsInput,
  listGradingsOutput,
  recordGradingInput,
  releaseQuarantineInput,
} from "@roastery/schemas";
import { and, asc, eq, type SQL } from "drizzle-orm";
import { BadRequest, NotFound } from "../../lib/api/errors";
import { type RpcAppEnv, registerRpc } from "../../lib/api/rpc";
import { fullDefectEquivalents, gradePasses } from "../../lib/domain/cupping";

export const qualityGrading = new OpenAPIHono<RpcAppEnv>();

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
  qualityGrading,
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

    const row = await ctx.db.transaction(async (tx) => {
      const [created] = await tx.insert(greenGradings, {
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
      if (!created) throw new Error("Insert returned no row");

      await tx.emit({
        type: "quality.grading.recorded",
        resourceType: "green_grading",
        resourceId: created.id,
        payload: {
          id: created.id,
          greenLotId: input.greenLotId ?? null,
          standard: input.standard,
          passed,
          fullDefectEquivalents: equivalents.toFixed(2),
        },
      });

      // The enforcement. Without it a grading is a note nobody has to act on.
      if (!passed && input.greenLotId) {
        await tx.update(
          greenLots,
          { status: "quarantined", updatedAt: new Date() },
          eq(greenLots.id, input.greenLotId),
        );
        // A separate event from the grading itself, because the audience is
        // different: the ERP that has to stop planning against this lot does
        // not care how it was graded, only that it is now unusable.
        await tx.emit({
          type: "inventory.green_lot.quarantined",
          resourceType: "green_lot",
          resourceId: input.greenLotId,
          payload: { id: input.greenLotId, reason: "Failed grading", gradingId: created.id },
        });
      }
      return created;
    });

    return gradingDto(row);
  },
);

registerRpc(
  qualityGrading,
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
  qualityGrading,
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

    await ctx.db.transaction(async (tx) => {
      await tx.update(
        greenLots,
        {
          status: "available",
          notes: `${lot.notes ? `${lot.notes}\n` : ""}Quarantine released: ${input.reason}`,
          updatedAt: new Date(),
        },
        eq(greenLots.id, input.greenLotId),
      );
      await tx.emit({
        type: "inventory.green_lot.released",
        resourceType: "green_lot",
        resourceId: input.greenLotId,
        // The reason travels with the event: this is the decision an auditor
        // asks about, and it should not require a second call to explain.
        payload: { id: input.greenLotId, reason: input.reason },
      });
    });

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
