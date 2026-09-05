import encodeQR from "@paulmillr/qr";
import type { LabelBinding, LabelBlock, LabelTemplate } from "@roastery/schemas";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ApiError,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  Field,
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
  Separator,
  Switch,
} from "@roastery/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ArrowDown, ArrowUp, Plus, Printer, Tag, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import {
  BINDING_LABELS,
  estimateLines,
  type LabelData,
  missingRequired,
  qrScannability,
  resolveBinding,
  SIZE_MM,
} from "@/lib/label-layout";
import { ORIGINS } from "@/lib/origins";
import { useWorkspace } from "@/lib/workspace";

/**
 * The label designer.
 *
 * Deliberately NOT a drag canvas. A free-form canvas produces labels that are
 * a millimetre out of alignment from each other, and the actual requirement is
 * that eleven SKUs share one house style — so a design is an ordered stack of
 * blocks in a fixed rhythm, and the only spatial choice is order.
 *
 * The preview binds to a REAL certificate rather than sample text. A label
 * that fits "Kochere" and breaks on "Finca El Paraíso Gesha Natural Anaerobic
 * 96h" is the entire failure mode of label design, and you cannot see it
 * against lorem ipsum.
 */
export const Route = createFileRoute("/_app/reports/labels")({ component: LabelDesigner });

type Certificate = { id: string; qrToken: string; snapshot: LabelData; issuedAt: string };

const BINDINGS = Object.keys(BINDING_LABELS) as LabelBinding[];

const STARTER: LabelBlock[] = [
  { id: "b1", kind: "field", binding: "coffee.name", size: "xl", weight: "bold", align: "left" },
  {
    id: "b2",
    kind: "field",
    binding: "origin.region",
    caption: "Origin",
    size: "md",
    weight: "regular",
    align: "left",
  },
  { id: "b3", kind: "rule", size: "md", weight: "regular", align: "left" },
  {
    id: "b4",
    kind: "field",
    binding: "quality.notes",
    size: "sm",
    weight: "regular",
    align: "left",
  },
  { id: "b5", kind: "text", text: "Net 250 g", size: "sm", weight: "medium", align: "left" },
];

type Draft = {
  id?: string;
  name: string;
  widthMm: number;
  heightMm: number;
  marginMm: number;
  qrSizeMm: number;
  qrPosition: "none" | "top-right" | "bottom-right" | "bottom-left";
  blocks: LabelBlock[];
  isDefault: boolean;
};

const NEW_DRAFT: Draft = {
  name: "250 g retail",
  widthMm: 60,
  heightMm: 90,
  marginMm: 5,
  qrSizeMm: 20,
  qrPosition: "bottom-right",
  blocks: STARTER,
  isDefault: false,
};

function LabelDesigner() {
  const { can } = useWorkspace();
  const queryClient = useQueryClient();
  const [draft, setDraft] = React.useState<Draft>(NEW_DRAFT);

  const templates = useQuery({
    queryKey: ["reporting.label", "list"],
    queryFn: () =>
      rpc<{ items: LabelTemplate[] }>("reporting.label.listLabelTemplates", {
        page: { limit: 100 },
      }),
  });

  const certificates = useQuery({
    queryKey: ["traceability", "certificates"],
    queryFn: () =>
      rpc<{ items: Certificate[] }>("traceability.listCertificates", { page: { limit: 50 } }),
  });

  const [certificateId, setCertificateId] = React.useState<string>();
  const certificate =
    certificates.data?.items.find((c) => c.id === certificateId) ?? certificates.data?.items[0];

  const save = useMutation({
    mutationFn: () => rpcMutate<LabelTemplate>("reporting.label.saveLabelTemplate", draft),
    onSuccess: (result) => {
      setDraft((previous) => ({ ...previous, id: result.id }));
      toast.success(`Published version ${result.version}`);
      void queryClient.invalidateQueries({ queryKey: ["reporting.label"] });
    },
    onError: (error) =>
      toast.error(
        error instanceof ApiError ? error.message : "Could not publish that label design",
      ),
  });

  const update = (patch: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...patch }));
  const patchBlock = (id: string, patch: Partial<LabelBlock>) =>
    update({ blocks: draft.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) });

  const move = (index: number, delta: number) => {
    const next = [...draft.blocks];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    update({ blocks: next });
  };

  const missing = missingRequired(draft.blocks);
  const contentWidthMm = draft.widthMm - draft.marginMm * 2;

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageHeader
          title="Label designer"
          description="What goes on a retail bag, and whether it survives a real certificate."
          actions={
            <div className="flex items-center gap-2">
              <Select
                value={draft.id ?? "new"}
                onValueChange={(value) => {
                  if (value === "new") {
                    setDraft(NEW_DRAFT);
                    return;
                  }
                  const found = templates.data?.items.find((t) => t.id === value);
                  if (found) setDraft({ ...found, blocks: found.blocks as LabelBlock[] });
                }}
              >
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New design</SelectItem>
                  {(templates.data?.items ?? []).map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name} · v{template.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="size-3.5" aria-hidden="true" />
                Print
              </Button>
              <Button
                onClick={() => save.mutate()}
                disabled={save.isPending || !draft.name.trim() || !can("reporting.write")}
              >
                Publish
              </Button>
            </div>
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-4 print:hidden">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Stock</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <LabeledField label="Name">
                <Input value={draft.name} onChange={(e) => update({ name: e.target.value })} />
              </LabeledField>
              <LabeledField label="Width (mm)">
                <MmInput value={draft.widthMm} onChange={(v) => update({ widthMm: v })} />
              </LabeledField>
              <LabeledField label="Height (mm)">
                <MmInput value={draft.heightMm} onChange={(v) => update({ heightMm: v })} />
              </LabeledField>
              <LabeledField label="Margin (mm)">
                <MmInput value={draft.marginMm} onChange={(v) => update({ marginMm: v })} />
              </LabeledField>
              <LabeledField label="QR size (mm)">
                <MmInput value={draft.qrSizeMm} onChange={(v) => update({ qrSizeMm: v })} />
              </LabeledField>
              <LabeledField label="QR corner">
                <Select
                  value={draft.qrPosition}
                  onValueChange={(v) => update({ qrPosition: v as Draft["qrPosition"] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No QR</SelectItem>
                    <SelectItem value="top-right">Top right</SelectItem>
                    <SelectItem value="bottom-right">Bottom right</SelectItem>
                    <SelectItem value="bottom-left">Bottom left</SelectItem>
                  </SelectContent>
                </Select>
              </LabeledField>
              <div className="flex items-center gap-2 sm:col-span-3">
                <Switch
                  id="default"
                  checked={draft.isDefault}
                  onCheckedChange={(checked) => update({ isDefault: checked })}
                />
                <Label htmlFor="default" className="font-normal">
                  Use this design by default
                </Label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm">Blocks</CardTitle>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    update({
                      blocks: [
                        ...draft.blocks,
                        {
                          id: crypto.randomUUID(),
                          kind: "field",
                          binding: "coffee.lotCode",
                          size: "sm",
                          weight: "regular",
                          align: "left",
                        },
                      ],
                    })
                  }
                  disabled={draft.blocks.length >= 24}
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  Field
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    update({
                      blocks: [
                        ...draft.blocks,
                        {
                          id: crypto.randomUUID(),
                          kind: "text",
                          text: "",
                          size: "sm",
                          weight: "regular",
                          align: "left",
                        },
                      ],
                    })
                  }
                  disabled={draft.blocks.length >= 24}
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  Text
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {draft.blocks.length === 0 ? (
                <EmptyState
                  title="An empty label"
                  description="Add the coffee name, its origin, a roast date and a net weight — the four things a bag cannot ship without."
                  className="border-0"
                />
              ) : (
                draft.blocks.map((block, index) => {
                  const value =
                    block.kind === "field" && block.binding && certificate
                      ? resolveBinding(certificate.snapshot, block.binding)
                      : block.text;
                  const lines = estimateLines(value ?? "", contentWidthMm, SIZE_MM[block.size]);
                  return (
                    <div
                      key={block.id}
                      className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-2"
                    >
                      {block.kind === "rule" ? (
                        <span className="flex-1 text-muted-foreground text-sm">Hairline rule</span>
                      ) : block.kind === "text" ? (
                        <Input
                          value={block.text ?? ""}
                          onChange={(e) => patchBlock(block.id, { text: e.target.value })}
                          placeholder="Fixed text, e.g. Net 250 g"
                          className="min-w-48 flex-1"
                          aria-label="Fixed text"
                        />
                      ) : (
                        <Select
                          value={block.binding}
                          onValueChange={(v) =>
                            patchBlock(block.id, { binding: v as LabelBinding })
                          }
                        >
                          <SelectTrigger className="min-w-48 flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {BINDINGS.map((binding) => (
                              <SelectItem key={binding} value={binding}>
                                {BINDING_LABELS[binding]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}

                      {block.kind !== "rule" ? (
                        <>
                          <Input
                            value={block.caption ?? ""}
                            onChange={(e) => patchBlock(block.id, { caption: e.target.value })}
                            placeholder="Caption"
                            className="w-28"
                            aria-label="Caption"
                          />
                          <Select
                            value={block.size}
                            onValueChange={(v) =>
                              patchBlock(block.id, { size: v as LabelBlock["size"] })
                            }
                          >
                            <SelectTrigger className="w-20" aria-label="Size">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(["xs", "sm", "md", "lg", "xl"] as const).map((size) => (
                                <SelectItem key={size} value={size}>
                                  {size}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            value={block.align}
                            onValueChange={(v) =>
                              patchBlock(block.id, { align: v as LabelBlock["align"] })
                            }
                          >
                            <SelectTrigger className="w-24" aria-label="Alignment">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="left">Left</SelectItem>
                              <SelectItem value="center">Center</SelectItem>
                              <SelectItem value="right">Right</SelectItem>
                            </SelectContent>
                          </Select>
                        </>
                      ) : null}

                      {/* Named against the certificate on screen, because a
                          wrap you cannot see is one you ship. */}
                      {lines > 2 ? (
                        <Badge variant="warning" className="gap-1">
                          <AlertTriangle className="size-3" aria-hidden="true" />
                          {lines} lines
                        </Badge>
                      ) : null}

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
                          disabled={index === draft.blocks.length - 1}
                          aria-label="Move down"
                        >
                          <ArrowDown className="size-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            update({ blocks: draft.blocks.filter((b) => b.id !== block.id) })
                          }
                          aria-label="Remove block"
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  update({
                    blocks: [
                      ...draft.blocks,
                      {
                        id: crypto.randomUUID(),
                        kind: "rule",
                        size: "md",
                        weight: "regular",
                        align: "left",
                      },
                    ],
                  })
                }
              >
                Add a rule
              </Button>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className="print:hidden">
            {missing.length > 0 ? (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" aria-hidden="true" />
                <AlertTitle>
                  Not ready to print — {missing.length} required item
                  {missing.length === 1 ? "" : "s"} missing
                </AlertTitle>
                <AlertDescription>
                  {missing.map((r) => `${r.label}: ${r.why}`).join(" ")}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>

          {certificates.data?.items.length === 0 ? (
            <EmptyState
              icon={Tag}
              title="No certificates to preview against"
              description="Issue a traceability certificate and the preview will render this design against a real lot."
            />
          ) : (
            <>
              <div className="print:hidden">
                <LabeledField label="Preview against">
                  <Select value={certificate?.id} onValueChange={setCertificateId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(certificates.data?.items ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.snapshot.coffee.name} · {c.snapshot.coffee.lotCode}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </LabeledField>
              </div>

              {certificate ? <LabelPreview draft={draft} certificate={certificate} /> : null}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

/**
 * A Field whose control does not need an explicit id.
 *
 * The label sheet has a dozen small numeric controls; generating the id here
 * and cloning it onto the child keeps each call site to one line without
 * losing the label/control association.
 */
function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<{ id?: string }>, { id })
        : children}
    </Field>
  );
}

function MmInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <Input
      value={String(value)}
      onChange={(event) => {
        const parsed = Number.parseFloat(event.target.value);
        if (!Number.isNaN(parsed)) onChange(parsed);
      }}
      inputMode="decimal"
      className="text-right font-mono"
    />
  );
}

// The public site for THIS environment. A staging test print that encoded
// the production origin would scan through to a certificate this deployment
// has never heard of.
const TRACE_ORIGIN = ORIGINS.web;

function LabelPreview({ draft, certificate }: { draft: Draft; certificate: Certificate }) {
  const url = `${TRACE_ORIGIN}/trace/${certificate.qrToken}`;
  // Encoded from the REAL token, so the module count — and therefore whether
  // the printed square is scannable — reflects the payload that ships.
  const matrix = React.useMemo(
    () => (draft.qrPosition === "none" ? null : encodeQR(url, "raw", { ecc: "medium" })),
    [url, draft.qrPosition],
  );
  const qr = matrix ? qrScannability(matrix.length, draft.qrSizeMm) : null;

  const corner =
    draft.qrPosition === "top-right"
      ? { top: `${draft.marginMm}mm`, right: `${draft.marginMm}mm` }
      : draft.qrPosition === "bottom-right"
        ? { bottom: `${draft.marginMm}mm`, right: `${draft.marginMm}mm` }
        : { bottom: `${draft.marginMm}mm`, left: `${draft.marginMm}mm` };

  return (
    <div className="space-y-3">
      {/* `@page` cannot read a custom property, so the sheet size is written
          as a real rule each time the millimetres change. Printing at "fit to
          page" would silently rescale a label that must be exact. */}
      <style>{`@page { size: ${draft.widthMm}mm ${draft.heightMm}mm; margin: 0 }
@media print {
  body { background: #fff }
  .label-sheet { position: absolute; inset: 0; margin: 0; box-shadow: none; border: 0 }
}`}</style>

      <div className="print:hidden">
        {qr && qr.verdict !== "ok" ? (
          <Alert variant={qr.verdict === "unscannable" ? "destructive" : "default"}>
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertTitle>
              {qr.verdict === "unscannable" ? "This QR will not scan" : "This QR is tight"}
            </AlertTitle>
            <AlertDescription>
              {/* The number is the actionable part: a roaster can widen the
                  square or shorten nothing else, since the token is fixed. */}
              {matrix?.length}&nbsp;modules plus a quiet zone in {draft.qrSizeMm}&nbsp;mm is{" "}
              {qr.moduleMm.toFixed(2)}&nbsp;mm per module. A phone needs about 0.5&nbsp;mm off matte
              bag stock.
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <div
        className="label-sheet relative overflow-hidden border border-border bg-white text-black shadow-sm"
        style={{
          width: `${draft.widthMm}mm`,
          height: `${draft.heightMm}mm`,
          padding: `${draft.marginMm}mm`,
        }}
      >
        <div className="flex h-full flex-col gap-[1.2mm]">
          {draft.blocks.map((block) => {
            if (block.kind === "rule")
              return <Separator key={block.id} className="my-[0.8mm] bg-black/25" />;
            const value =
              block.kind === "field" && block.binding
                ? resolveBinding(certificate.snapshot, block.binding)
                : (block.text ?? "");
            if (!value) return null;
            return (
              <div key={block.id} style={{ textAlign: block.align }}>
                {block.caption ? (
                  <div
                    className="uppercase opacity-55"
                    style={{ fontSize: "1.9mm", letterSpacing: "0.12em" }}
                  >
                    {block.caption}
                  </div>
                ) : null}
                <div
                  style={{
                    fontSize: `${SIZE_MM[block.size]}mm`,
                    lineHeight: 1.25,
                    fontWeight:
                      block.weight === "bold" ? 700 : block.weight === "medium" ? 500 : 400,
                  }}
                >
                  {value}
                </div>
              </div>
            );
          })}
        </div>

        {matrix ? (
          <div
            className="absolute bg-white"
            style={{ ...corner, width: `${draft.qrSizeMm}mm`, height: `${draft.qrSizeMm}mm` }}
          >
            <QrMatrix matrix={matrix} sizeMm={draft.qrSizeMm} url={url} />
          </div>
        ) : null}
      </div>

      <p className="text-muted-foreground text-xs print:hidden">
        {draft.widthMm} × {draft.heightMm} mm. Shown at CSS millimetres, which your printer honours
        exactly and your screen only approximately.
      </p>
    </div>
  );
}

function QrMatrix({ matrix, sizeMm, url }: { matrix: boolean[][]; sizeMm: number; url: string }) {
  const n = matrix.length;
  // One path of rects rather than n² elements: a version-4 code is 1,089
  // nodes, and this preview re-renders on every keystroke in the designer.
  const path = matrix
    .flatMap((row, y) => row.map((on, x) => (on ? `M${x} ${y}h1v1h-1z` : "")))
    .join("");
  const quiet = 4;
  return (
    <svg
      viewBox={`${-quiet} ${-quiet} ${n + quiet * 2} ${n + quiet * 2}`}
      width={`${sizeMm}mm`}
      height={`${sizeMm}mm`}
      role="img"
      aria-label={`QR code linking to ${url}`}
    >
      <rect x={-quiet} y={-quiet} width={n + quiet * 2} height={n + quiet * 2} fill="#fff" />
      <path d={path} fill="#000" shapeRendering="crispEdges" />
    </svg>
  );
}
