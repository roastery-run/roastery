/**
 * Custom form templates.
 *
 * Separate from ./cupping.ts because a template is configuration, not a
 * measurement: it is written once by a QC lead and read on every scoresheet,
 * and it outlives the sessions that used it.
 *
 * Versions are immutable. Editing publishes a new one and archives the old,
 * because a response records the version it was filled against — a template
 * mutated in place would silently rewrite the meaning of every score already
 * recorded against it.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { formTemplates } from "@roastery/db/schema";
import {
  archiveFormTemplateInput,
  formTemplateSchema,
  getFormTemplateInput,
  listFormTemplatesInput,
  listFormTemplatesOutput,
  saveFormTemplateInput,
} from "@roastery/schemas";
import { and, eq, isNull, type SQL } from "drizzle-orm";
import { NotFound } from "../../lib/api/errors";
import { type RpcAppEnv, registerRpc } from "../../lib/api/rpc";

export const qualityForm = new OpenAPIHono<RpcAppEnv>();

function toDto(t: typeof formTemplates.$inferSelect) {
  return {
    id: t.id,
    kind: t.kind,
    name: t.name,
    version: t.version,
    fields: t.schema?.fields ?? [],
    isDefault: t.isDefault,
    publishedAt: t.publishedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}

registerRpc(
  qualityForm,
  {
    namespace: "quality.form",
    operation: "listFormTemplates",
    summary: "List form templates",
    description: "Current versions only. Superseded ones stay readable by id.",
    input: listFormTemplatesInput,
    output: listFormTemplatesOutput,
    permission: "quality.form.read",
    module: "quality",
    cacheable: { maxAgeSeconds: 60 },
  },
  async (input, ctx) => {
    const clauses = [isNull(formTemplates.archivedAt)];
    if (input.filter?.kind) clauses.push(eq(formTemplates.kind, input.filter.kind));
    const { items, page } = await ctx.db.find(formTemplates, {
      where: and(...clauses),
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return { items: items.map(toDto), page };
  },
);

registerRpc(
  qualityForm,
  {
    namespace: "quality.form",
    operation: "getFormTemplate",
    summary: "Get a form template",
    description:
      "Including an archived one. A score recorded against version 2 has to render " +
      "against version 2, whatever version 5 says.",
    input: getFormTemplateInput,
    output: formTemplateSchema,
    permission: "quality.form.read",
    module: "quality",
    cacheable: { maxAgeSeconds: 60 },
  },
  async (input, ctx) => {
    const row = await ctx.db.findOne(formTemplates, eq(formTemplates.id, input.id));
    if (!row) throw new NotFound("No form template with that id");
    return toDto(row);
  },
);

registerRpc(
  qualityForm,
  {
    namespace: "quality.form",
    operation: "saveFormTemplate",
    summary: "Publish a form template",
    description:
      "Publishes a new version and archives the one it supersedes. Field KEYS are the " +
      "keys in every stored response, so renaming a key orphans the answers already " +
      "given to it — change the label instead.",
    input: saveFormTemplateInput,
    output: formTemplateSchema,
    permission: "quality.form.write",
    module: "quality",
  },
  async (input, ctx) => {
    const row = await ctx.db.transaction(async (tx) => {
      let version = 1;
      let makeDefault = input.isDefault ?? false;

      if (input.id) {
        const previous = await tx.findOne(formTemplates, eq(formTemplates.id, input.id));
        if (!previous) throw new NotFound("No form template with that id");
        const { items } = await tx.find(formTemplates, {
          where: and(eq(formTemplates.kind, input.kind), eq(formTemplates.name, input.name)),
          limit: 1,
        });
        version = (items[0]?.version ?? 0) + 1;
        await tx.update(formTemplates, { archivedAt: new Date() }, eq(formTemplates.id, input.id));
        makeDefault = input.isDefault ?? previous.isDefault;
      }

      if (makeDefault) {
        // Cleared before the insert: the partial unique index allows exactly
        // one default per kind.
        await tx.update(
          formTemplates,
          { isDefault: false },
          // Non-null: `and` of two defined clauses is always a predicate, but
          // its type allows undefined for the empty case.
          and(eq(formTemplates.kind, input.kind), eq(formTemplates.isDefault, true)) as SQL,
        );
      }

      const [created] = await tx.insert(formTemplates, {
        kind: input.kind,
        name: input.name,
        version,
        schema: { fields: input.fields },
        isDefault: makeDefault,
        publishedAt: new Date(),
      });
      if (!created) throw new Error("Insert returned no row");

      await tx.emit({
        type: "quality.form_template.published",
        resourceType: "form_template",
        resourceId: created.id,
        payload: {
          id: created.id,
          kind: created.kind,
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
  qualityForm,
  {
    namespace: "quality.form",
    operation: "archiveFormTemplate",
    summary: "Retire a form template",
    description:
      "Archives rather than deletes, and returns it. Scores recorded against it stay " +
      "readable, which is the whole reason versions exist.",
    input: archiveFormTemplateInput,
    output: formTemplateSchema,
    permission: "quality.form.write",
    module: "quality",
  },
  async (input, ctx) => {
    const row = await ctx.db.transaction(async (tx) => {
      const existing = await tx.findOne(formTemplates, eq(formTemplates.id, input.id));
      if (!existing) throw new NotFound("No form template with that id");
      const [updated] = await tx.update(
        formTemplates,
        { archivedAt: new Date(), isDefault: false },
        eq(formTemplates.id, input.id),
      );
      await tx.emit({
        type: "quality.form_template.published",
        resourceType: "form_template",
        resourceId: input.id,
        payload: { id: input.id, kind: existing.kind, name: existing.name, archived: true },
      });
      return updated ?? existing;
    });
    return toDto(row);
  },
);
