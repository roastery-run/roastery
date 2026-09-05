import type { FormField, FormTemplate, FormTemplateKind } from "@roastery/schemas";
import { formFieldSchema, templateToZod } from "@roastery/schemas";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ApiError,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Label,
  PageHeader,
  rpc,
  rpcMutate,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@roastery/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ArrowDown, ArrowUp, ClipboardList, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { CustomFields } from "@/components/custom-fields";
import { useWorkspace } from "@/lib/workspace";

/**
 * The form template builder.
 *
 * Adds the long tail to a sheet whose measured attributes are already fixed
 * columns. The ten SCA scores are not editable here and never will be — every
 * report averages them, and a customer who renames "acidity" breaks six months
 * of history. What this owns is the part no report will ever group by.
 *
 * The preview is the same `templateToZod` the runtime form uses, so a field
 * that validates here validates identically when a cupper fills it. Two
 * implementations of one rule is how a preview starts lying.
 */
export const Route = createFileRoute("/_app/quality/forms")({ component: FormBuilder });

const KINDS: { value: FormTemplateKind; label: string; where: string }[] = [
  { value: "cupping_sheet", label: "Cupping sheet", where: "Shown under the SCA scores." },
  { value: "green_grading", label: "Green grading", where: "Shown with defect counts." },
  { value: "roast_qc", label: "Roast QC", where: "Shown when a batch is completed." },
  { value: "brew_feedback", label: "Brew feedback", where: "Shown on café brew logs." },
  { value: "sample_intake", label: "Sample intake", where: "Shown when a sample arrives." },
];

type Draft = {
  id?: string;
  kind: FormTemplateKind;
  name: string;
  fields: FormField[];
  isDefault: boolean;
};

const NEW_DRAFT: Draft = {
  kind: "cupping_sheet",
  name: "House additions",
  fields: [
    { key: "gut_feeling", label: "Gut feeling", type: "number", min: 1, max: 5, step: 1 },
    { key: "would_buy", label: "Would buy again", type: "boolean" },
  ],
  isDefault: false,
};

function FormBuilder() {
  const { can } = useWorkspace();
  const queryClient = useQueryClient();
  const [draft, setDraft] = React.useState<Draft>(NEW_DRAFT);
  /**
   * Raw text for the option editors, because the parsed array cannot round
   * trip through the input while you are typing: joining on ", " and splitting
   * on "," strips the comma the moment it is typed, and the space after it, so
   * "light, dark" collapses to one option called "lightdark". The buffer holds
   * exactly what was typed; the field keeps the parsed values.
   */
  const [optionText, setOptionText] = React.useState<Record<number, string>>({});

  const templates = useQuery({
    queryKey: ["quality.form", "list"],
    queryFn: () =>
      rpc<{ items: FormTemplate[] }>("quality.form.listFormTemplates", { page: { limit: 100 } }),
  });

  const save = useMutation({
    mutationFn: () => rpcMutate<FormTemplate>("quality.form.saveFormTemplate", draft),
    onSuccess: (result) => {
      setDraft((previous) => ({ ...previous, id: result.id }));
      toast.success(`Published version ${result.version}`);
      void queryClient.invalidateQueries({ queryKey: ["quality.form"] });
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : "Could not publish that template"),
  });

  const update = (patch: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...patch }));
  const patchField = (index: number, patch: Partial<FormField>) =>
    update({
      fields: draft.fields.map((f, i) => (i === index ? ({ ...f, ...patch } as FormField) : f)),
    });

  const move = (index: number, delta: number) => {
    // The buffer is keyed by position, so moving a field would hand its text
    // to a different one.
    setOptionText({});
    const next = [...draft.fields];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    update({ fields: next });
  };

  // Every field is validated by the same schema the API applies, so the
  // reason a publish would fail is visible before pressing the button.
  const problems = draft.fields.flatMap((field, index) => {
    const parsed = formFieldSchema.safeParse(field);
    if (parsed.success) return [];
    return [
      `${field.label || `Field ${index + 1}`}: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    ];
  });
  const duplicateKeys = draft.fields
    .map((f) => f.key)
    .filter((key, i, all) => all.indexOf(key) !== i);

  const blockedBecause = !draft.name.trim()
    ? "The template needs a name."
    : problems.length
      ? problems[0]
      : duplicateKeys.length
        ? `Two fields share the key "${duplicateKeys[0]}", so one would overwrite the other.`
        : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Form templates"
        description="The questions that belong to your roastery, alongside the scores that belong to everyone."
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={draft.id ?? "new"}
              onValueChange={(value) => {
                if (value === "new") {
                  setDraft(NEW_DRAFT);
                  setOptionText({});
                  return;
                }
                const found = templates.data?.items.find((t) => t.id === value);
                if (found) {
                  setDraft({ ...found, fields: found.fields });
                  setOptionText({});
                }
              }}
            >
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New template</SelectItem>
                {(templates.data?.items ?? []).map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name} · v{template.version}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || blockedBecause !== null || !can("quality.form.write")}
            >
              Publish
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Template</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="template-name">Name</FieldLabel>
                <Input
                  id="template-name"
                  value={draft.name}
                  onChange={(e) => update({ name: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="template-kind">Used on</FieldLabel>
                <Select
                  value={draft.kind}
                  onValueChange={(v) => update({ kind: v as FormTemplateKind })}
                >
                  <SelectTrigger id="template-kind" aria-describedby="template-kind-description">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KINDS.map((kind) => (
                      <SelectItem key={kind.value} value={kind.value}>
                        {kind.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription id="template-kind-description" className="text-xs">
                  {KINDS.find((k) => k.value === draft.kind)?.where}
                </FieldDescription>
              </Field>
              <div className="flex items-center gap-2 sm:col-span-2">
                <Switch
                  id="template-default"
                  checked={draft.isDefault}
                  onCheckedChange={(checked) => update({ isDefault: checked })}
                />
                <Label htmlFor="template-default" className="font-normal">
                  Use this template by default for{" "}
                  {KINDS.find((k) => k.value === draft.kind)?.label}
                </Label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm">Fields</CardTitle>
              <Button
                size="sm"
                variant="outline"
                disabled={draft.fields.length >= 50}
                onClick={() =>
                  update({
                    fields: [
                      ...draft.fields,
                      {
                        key: `field_${draft.fields.length + 1}`,
                        label: "",
                        type: "text",
                      } as FormField,
                    ],
                  })
                }
              >
                <Plus className="size-3.5" aria-hidden="true" />
                Add
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {draft.fields.length === 0 ? (
                <EmptyState
                  icon={ClipboardList}
                  title="No custom fields"
                  description="The measured attributes are always there. This is for the questions only your roastery asks."
                  className="border-0"
                />
              ) : (
                draft.fields.map((field, index) => (
                  <div key={index} className="space-y-2 rounded-xl border border-border p-3">
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-40 flex-1 space-y-1.5">
                        <Label className="text-xs">Label</Label>
                        <Input
                          value={field.label}
                          onChange={(e) => patchField(index, { label: e.target.value })}
                          placeholder="What the cupper is asked"
                        />
                      </div>
                      <div className="w-40 space-y-1.5">
                        <Label className="text-xs">Key</Label>
                        <Input
                          value={field.key}
                          onChange={(e) => patchField(index, { key: e.target.value })}
                          className="font-mono"
                        />
                      </div>
                      <div className="w-32 space-y-1.5">
                        <Label className="text-xs">Type</Label>
                        <Select
                          value={field.type}
                          onValueChange={(v) => patchField(index, { type: v as FormField["type"] })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="number">Number</SelectItem>
                            <SelectItem value="text">Text</SelectItem>
                            <SelectItem value="select">Choice</SelectItem>
                            <SelectItem value="boolean">Yes / no</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-2 pb-2">
                        <Checkbox
                          id={`required-${index}`}
                          checked={field.required ?? false}
                          onCheckedChange={(checked) =>
                            patchField(index, { required: checked === true })
                          }
                        />
                        <Label htmlFor={`required-${index}`} className="font-normal text-xs">
                          Required
                        </Label>
                      </div>
                      <div className="ml-auto flex">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => move(index, -1)}
                          disabled={index === 0}
                          aria-label="Move up"
                        >
                          <ArrowUp className="size-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => move(index, 1)}
                          disabled={index === draft.fields.length - 1}
                          aria-label="Move down"
                        >
                          <ArrowDown className="size-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setOptionText({});
                            update({ fields: draft.fields.filter((_, i) => i !== index) });
                          }}
                          aria-label="Remove field"
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>

                    {field.type === "number" ? (
                      <div className="flex flex-wrap gap-2">
                        <NumberBox
                          label="Min"
                          value={field.min}
                          onChange={(v) => patchField(index, { min: v })}
                        />
                        <NumberBox
                          label="Max"
                          value={field.max}
                          onChange={(v) => patchField(index, { max: v })}
                        />
                        <NumberBox
                          label="Step"
                          value={field.step}
                          onChange={(v) => patchField(index, { step: v })}
                        />
                      </div>
                    ) : null}

                    {field.type === "select" ? (
                      <Field>
                        <FieldLabel className="text-xs">Options, comma separated</FieldLabel>
                        <Input
                          value={optionText[index] ?? (field.options ?? []).join(", ")}
                          onChange={(e) => {
                            setOptionText((previous) => ({
                              ...previous,
                              [index]: e.target.value,
                            }));
                            patchField(index, {
                              options: e.target.value
                                .split(",")
                                .map((option) => option.trim())
                                .filter(Boolean),
                            });
                          }}
                          placeholder="light, medium, dark"
                        />
                      </Field>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          {blockedBecause ? (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" aria-hidden="true" />
              <AlertTitle>Not ready to publish</AlertTitle>
              <AlertDescription>{blockedBecause}</AlertDescription>
            </Alert>
          ) : null}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">How it will look</CardTitle>
            </CardHeader>
            <CardContent>
              <CustomFields
                fields={draft.fields}
                values={{}}
                onChange={() => {
                  /* A preview accepts input and discards it; the point is shape, not data. */
                }}
              />
            </CardContent>
          </Card>

          <p className="text-muted-foreground text-xs">
            Editing publishes a new version and retires the old one. Scores already recorded keep
            the version they were filled against, so a sheet from last year still reads as it was
            filled.
          </p>
        </aside>
      </div>
    </div>
  );
}

function NumberBox({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <div className="w-24 space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        value={value === undefined ? "" : String(value)}
        onChange={(event) => {
          const parsed = Number.parseFloat(event.target.value);
          onChange(Number.isNaN(parsed) ? undefined : parsed);
        }}
        inputMode="decimal"
        className="text-right font-mono"
      />
    </div>
  );
}
