import {
  Button,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  rpcMutate,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@roastery/ui";
import { humanize, parseDecimal } from "@roastery/units";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import * as React from "react";
import { LotActionDialog } from "@/components/inventory/lot-action-dialog";

/**
 * A new packaging material.
 *
 * A dialog rather than a page, unlike importing a lot: four fields matter and
 * the rest are reorder settings that only mean anything once somebody has
 * watched the material run out once.
 */
const KINDS = [
  "bag",
  "label",
  "valve",
  "box",
  "tin",
  "capsule",
  "tape",
  "insert",
  "merch",
  "other",
];

export function CreateMaterial({ canWrite }: { canWrite: boolean }) {
  const [open, setOpen] = React.useState(false);
  if (!canWrite) return null;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" aria-hidden="true" />
        New material
      </Button>
      {open ? <CreateMaterialDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function CreateMaterialDialog({ onClose }: { onClose: () => void }) {
  const [sku, setSku] = React.useState("");
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState("bag");
  const [reorderPoint, setReorderPoint] = React.useState("");
  const [leadTimeDays, setLeadTimeDays] = React.useState("");
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const create = useMutation({
    mutationFn: () =>
      rpcMutate<{ id: string }>("inventory.material.createMaterial", {
        sku: sku.trim(),
        name: name.trim(),
        kind,
        ...(reorderPoint.trim() ? { reorderPoint: parseDecimal(reorderPoint) ?? undefined } : {}),
        ...(leadTimeDays.trim() ? { leadTimeDays: Number(leadTimeDays) } : {}),
      }),
    onSuccess: (material) => {
      void queryClient.invalidateQueries({ queryKey: ["inventory.material"] });
      onClose();
      // Onto the material, where stock can be received against it. A new
      // material with no stock is not finished being set up.
      void navigate({
        to: "/inventory/materials/$materialId",
        params: { materialId: material.id },
      });
    },
  });

  const blockedBecause = !name.trim()
    ? "The material needs a name."
    : !sku.trim()
      ? "The material needs a SKU."
      : null;

  return (
    <LotActionDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title="New material"
      description="Packaging and anything else a finished unit consumes but that is not coffee."
      submitLabel="Create material"
      blockedBecause={blockedBecause}
      isPending={create.isPending}
      error={create.error}
      onSubmit={() => create.mutate()}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="material-name">Name</FieldLabel>
          <Input
            id="material-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="250 g kraft bag with valve"
            maxLength={200}
            autoFocus
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="material-sku">SKU</FieldLabel>
          <Input
            id="material-sku"
            value={sku}
            onChange={(event) => setSku(event.target.value)}
            className="font-mono"
            placeholder="BAG-250-KV"
          />
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="material-kind">Kind</FieldLabel>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger id="material-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KINDS.map((value) => (
              <SelectItem key={value} value={value}>
                {humanize(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="material-reorder">
            Reorder point <span className="text-muted-foreground">(optional)</span>
          </FieldLabel>
          <Input
            id="material-reorder"
            value={reorderPoint}
            onChange={(event) => setReorderPoint(event.target.value)}
            inputMode="decimal"
            className="font-mono"
            placeholder="0"
          />
          <FieldDescription className="text-xs">Alerts when stock falls to this.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="material-lead">
            Lead time <span className="text-muted-foreground">(optional)</span>
          </FieldLabel>
          <Input
            id="material-lead"
            value={leadTimeDays}
            onChange={(event) => setLeadTimeDays(event.target.value)}
            inputMode="numeric"
            className="font-mono"
            placeholder="0"
          />
          <FieldDescription className="text-xs">
            Days from ordering to arriving. It is what makes a shortfall alert actionable.
          </FieldDescription>
        </Field>
      </div>
    </LotActionDialog>
  );
}
