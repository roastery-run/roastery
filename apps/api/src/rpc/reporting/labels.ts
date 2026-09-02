/**
 * Retail label designs.
 *
 * Separate from ./reports.ts because the two answer different questions. A
 * report is an async artifact: you ask for one, it renders on a queue, you
 * download it once. A label is a design that gets printed a thousand times
 * against a thousand different certificates — it is a template, and its
 * lifecycle is versioning, not rendering.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { labelTemplates } from "@roastery/db/schema";
import {
  deleteLabelTemplateInput,
  getLabelTemplateInput,
  labelTemplateSchema,
  listLabelTemplatesInput,
  listLabelTemplatesOutput,
  saveLabelTemplateInput,
} from "@roastery/schemas";
import { eq, isNull } from "drizzle-orm";
import { NotFound } from "../../lib/api/errors";
import { type RpcAppEnv, registerRpc } from "../../lib/api/rpc";

export const reportingLabels = new OpenAPIHono<RpcAppEnv>();

function toDto(t: typeof labelTemplates.$inferSelect) {
  return {
    id: t.id,
    name: t.name,
    version: t.version,
    // Decimal strings on the wire everywhere else, but a millimetre is a
    // display dimension, not money — it is never summed and never audited,
    // and a caller laying out a preview needs a number.
    widthMm: Number(t.widthMm),
    heightMm: Number(t.heightMm),
    marginMm: Number(t.marginMm),
    qrSizeMm: Number(t.qrSizeMm),
    qrPosition: t.qrPosition as "none" | "top-right" | "bottom-right" | "bottom-left",
    blocks: t.layout?.blocks ?? [],
    isDefault: t.isDefault,
    createdAt: t.createdAt.toISOString(),
  };
}

registerRpc(
  reportingLabels,
  {
    namespace: "reporting.label",
    operation: "listLabelTemplates",
    summary: "List label designs",
    description: "The current version of each design. Superseded versions are not listed.",
    input: listLabelTemplatesInput,
    output: listLabelTemplatesOutput,
    permission: "reporting.read",
    module: "core",
    cacheable: { maxAgeSeconds: 30 },
  },
  async (input, ctx) => {
    const { items, page } = await ctx.db.find(labelTemplates, {
      where: isNull(labelTemplates.archivedAt),
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return { items: items.map(toDto), page };
  },
);

registerRpc(
  reportingLabels,
  {
    namespace: "reporting.label",
    operation: "getLabelTemplate",
    summary: "Get a label design",
    input: getLabelTemplateInput,
    output: labelTemplateSchema,
    permission: "reporting.read",
    module: "core",
    cacheable: { maxAgeSeconds: 30 },
  },
  async (input, ctx) => {
    const row = await ctx.db.findOne(labelTemplates, eq(labelTemplates.id, input.id));
    if (!row) throw new NotFound("No label design with that id");
    return toDto(row);
  },
);

registerRpc(
  reportingLabels,
  {
    namespace: "reporting.label",
    operation: "saveLabelTemplate",
    summary: "Publish a label design",
    description:
      "Publishes a NEW VERSION rather than mutating the existing one. A bag printed in " +
      "March must stay reproducible after somebody redesigns the label in June, or a " +
      "recall cannot say which bags carried which claim.",
    input: saveLabelTemplateInput,
    output: labelTemplateSchema,
    permission: "reporting.write",
    module: "core",
  },
  async (input, ctx) => {
    const row = await ctx.db.transaction(async (tx) => {
      let version = 1;
      let makeDefault = input.isDefault ?? false;

      if (input.id) {
        const previous = await tx.findOne(labelTemplates, eq(labelTemplates.id, input.id));
        if (!previous) throw new NotFound("No label design with that id");
        // Version within a NAME, not an id: renaming a design starts a new
        // lineage, which is what a user renaming it means. Newest-created for
        // a name is also highest-versioned, since versions are only appended.
        const { items } = await tx.find(labelTemplates, {
          where: eq(labelTemplates.name, input.name),
          limit: 1,
        });
        version = (items[0]?.version ?? 0) + 1;
        // The superseded version stays queryable but stops being offered.
        await tx.update(
          labelTemplates,
          { archivedAt: new Date() },
          eq(labelTemplates.id, input.id),
        );
        makeDefault = input.isDefault ?? previous.isDefault;
      }

      if (makeDefault) {
        // Cleared BEFORE the insert: the partial unique index permits exactly
        // one default per org, so inserting first would deadlock against it.
        await tx.update(labelTemplates, { isDefault: false }, eq(labelTemplates.isDefault, true));
      }

      const [created] = await tx.insert(labelTemplates, {
        name: input.name,
        version,
        widthMm: String(input.widthMm),
        heightMm: String(input.heightMm),
        marginMm: String(input.marginMm),
        qrSizeMm: String(input.qrSizeMm),
        qrPosition: input.qrPosition,
        layout: { blocks: input.blocks },
        isDefault: makeDefault,
      });
      if (!created) throw new Error("Insert returned no row");

      await tx.emit({
        type: "reporting.label_template.published",
        resourceType: "label_template",
        resourceId: created.id,
        payload: {
          id: created.id,
          name: created.name,
          version: created.version,
          isDefault: created.isDefault,
        },
      });
      return created;
    });
    return toDto(row);
  },
);

registerRpc(
  reportingLabels,
  {
    namespace: "reporting.label",
    operation: "deleteLabelTemplate",
    summary: "Retire a label design",
    description:
      "Archives rather than deletes, and returns the archived design. Bags already " +
      "printed against it stay explicable.",
    input: deleteLabelTemplateInput,
    output: labelTemplateSchema,
    permission: "reporting.write",
    module: "core",
  },
  async (input, ctx) => {
    const row = await ctx.db.transaction(async (tx) => {
      const existing = await tx.findOne(labelTemplates, eq(labelTemplates.id, input.id));
      if (!existing) throw new NotFound("No label design with that id");
      const [updated] = await tx.update(
        labelTemplates,
        { archivedAt: new Date(), isDefault: false },
        eq(labelTemplates.id, input.id),
      );
      await tx.emit({
        type: "reporting.label_template.published",
        resourceType: "label_template",
        resourceId: input.id,
        payload: { id: input.id, name: existing.name, version: existing.version, archived: true },
      });
      return updated ?? existing;
    });
    return toDto(row);
  },
);
