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
  Textarea,
} from "@roastery/ui";
import { add, compare, type Decimal, formatNumber, isZero, parseDecimal } from "@roastery/units";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PackagePlus } from "lucide-react";
import * as React from "react";
import { LotActionDialog } from "@/components/inventory/lot-action-dialog";
import { type AmountMeaning, deltaFor } from "@/lib/lot-adjustment";

/**
 * Material stock, which is counted rather than weighed.
 *
 * The same reason-first shape as a green lot adjustment, and the same sign
 * rule, but its own words: a material is a count of bags and labels, so "1,200"
 * here is twelve hundred things and not twelve hundred kilograms. The API's
 * enum differs too — materials can be RECEIVED, which coffee cannot, because
 * coffee arrives as a lot rather than into one.
 */
const REASONS: Record<
  string,
  { label: string; means: AmountMeaning; hint: string; requiresComment: boolean }
> = {
  receive: {
    label: "Receive",
    means: "added",
    hint: "A delivery arriving. The quantity is what came in.",
    requiresComment: false,
  },
  recount: {
    label: "Recount",
    means: "counted",
    hint: "The number you actually counted. The change is worked out from it.",
    requiresComment: false,
  },
  shrinkage: {
    label: "Shrinkage",
    means: "removed",
    hint: "Damaged or unusable stock found at a count.",
    requiresComment: false,
  },
  write_off: {
    label: "Write off",
    means: "removed",
    hint: "Stock that is gone and is not coming back.",
    requiresComment: true,
  },
  return: {
    label: "Return to supplier",
    means: "removed",
    hint: "Going back where it came from.",
    requiresComment: true,
  },
  adjust: {
    label: "Other correction",
    means: "signed",
    hint: "A signed correction where none of the reasons above fit. Negative removes.",
    requiresComment: false,
  },
};

const ORDER = ["receive", "recount", "shrinkage", "write_off", "return", "adjust"] as const;

export function MaterialActions({
  material,
  canWrite,
}: {
  material: { id: string; name: string; onHandQty: string };
  canWrite: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  if (!canWrite) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PackagePlus className="size-3.5" aria-hidden="true" />
        Adjust stock
      </Button>
      {open ? <AdjustMaterialDialog material={material} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function AdjustMaterialDialog({
  material,
  onClose,
}: {
  material: { id: string; name: string; onHandQty: string };
  onClose: () => void;
}) {
  const [reason, setReason] = React.useState<string>("receive");
  const [amount, setAmount] = React.useState("");
  const [comment, setComment] = React.useState("");
  const queryClient = useQueryClient();

  const action = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      rpcMutate("inventory.material.adjustMaterialQuantity", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inventory.material"] });
      onClose();
    },
  });

  const meta = REASONS[reason];
  const result = evaluate(meta?.means ?? "signed", amount, material.onHandQty);
  const needsComment = meta?.requiresComment && comment.trim() === "";

  const blockedBecause = !result.ok
    ? amount.trim() === ""
      ? "Enter a quantity to continue."
      : result.problem
    : needsComment
      ? "This reason needs a note saying why."
      : null;

  const removing = result.ok && result.delta.startsWith("-");

  return (
    <LotActionDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={`Adjust ${material.name}`}
      description="The reason decides what the ledger records, and what this form asks you for."
      submitLabel={
        result.ok
          ? `${removing ? "Remove" : "Add"} ${formatNumber(strip(result.delta), { digits: 0 })}`
          : (meta?.label ?? "Adjust")
      }
      destructive={reason === "write_off"}
      blockedBecause={blockedBecause}
      isPending={action.isPending}
      error={action.error}
      onSubmit={() =>
        result.ok &&
        action.mutate({
          id: material.id,
          deltaQty: result.delta,
          reason,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        })
      }
    >
      <Field>
        <FieldLabel htmlFor="material-reason">Reason</FieldLabel>
        <Select value={reason} onValueChange={setReason}>
          <SelectTrigger id="material-reason">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ORDER.map((key) => (
              <SelectItem key={key} value={key}>
                {REASONS[key]?.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription className="text-xs">{meta?.hint}</FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor="material-amount">
          {meta?.means === "counted"
            ? "Counted quantity"
            : meta?.means === "removed"
              ? "Quantity removed"
              : meta?.means === "added"
                ? "Quantity received"
                : "Change"}
        </FieldLabel>
        <Input
          id="material-amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          className="font-mono"
          placeholder={meta?.means === "counted" ? material.onHandQty : "0"}
          autoFocus
        />
        <FieldDescription className="text-xs">
          {result.ok ? (
            <>
              On hand {formatNumber(material.onHandQty, { digits: 0 })} →{" "}
              <span className="font-mono">{formatNumber(result.resulting, { digits: 0 })}</span>{" "}
              <span className={removing ? "text-destructive" : "text-success"}>
                ({removing ? "" : "+"}
                {formatNumber(result.delta, { digits: 0 })})
              </span>
            </>
          ) : (
            <>Currently on hand: {formatNumber(material.onHandQty, { digits: 0 })}</>
          )}
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor="material-comment">
          Note{" "}
          {meta?.requiresComment ? null : <span className="text-muted-foreground">(optional)</span>}
        </FieldLabel>
        <Textarea
          id="material-comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={2}
          maxLength={1000}
        />
      </Field>
    </LotActionDialog>
  );
}

type Evaluated = { ok: true; delta: Decimal; resulting: Decimal } | { ok: false; problem: string };

/** The green-lot sign rule, with a count's words instead of a weight's. */
function evaluate(meaning: AmountMeaning, amount: string, onHand: Decimal): Evaluated {
  const parsed = parseDecimal(amount);
  if (parsed === null) return { ok: false, problem: "Enter a quantity." };
  if (meaning !== "signed" && meaning !== "counted" && compare(parsed, "0") <= 0) {
    return { ok: false, problem: "Enter a quantity above zero." };
  }
  if (meaning === "counted" && compare(parsed, "0") < 0) {
    return { ok: false, problem: "A counted quantity cannot be negative." };
  }
  const delta = deltaFor(meaning, parsed, onHand);
  if (isZero(delta)) {
    return {
      ok: false,
      problem:
        meaning === "counted"
          ? "That is what is already recorded, so there is nothing to adjust."
          : "Enter a quantity above zero.",
    };
  }
  const resulting = add(onHand, delta);
  if (compare(resulting, "0") < 0) {
    return { ok: false, problem: `There are only ${onHand} of these, so that cannot be removed.` };
  }
  return { ok: true, delta, resulting };
}

const strip = (value: string) => (value.startsWith("-") ? value.slice(1) : value);
