import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldLabel,
  rpc,
  rpcMutate,
  Textarea,
} from "@roastery/ui";
import { formatDate, formatNumber, humanize } from "@roastery/units";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import * as React from "react";
import { LotActionDialog } from "@/components/inventory/lot-action-dialog";

type Grading = {
  id: string;
  standard: string;
  grade: string | null;
  passed: boolean;
  moisturePct: string | null;
  defectsPrimary: number;
  defectsSecondary: number;
  fullDefectEquivalents: string | null;
  notes: string | null;
  createdAt: string;
};

/**
 * Why this lot is quarantined, and the only way out of it.
 *
 * Quarantine is not an inventory state somebody sets; a FAILING physical
 * grading sets it, and `reserveGreenLot` and the roast charge both refuse a
 * quarantined lot afterwards. So this panel never offers a way to quarantine —
 * that would let somebody route around a failed inspection from a stock screen.
 *
 * It does offer the release, because the release is a written decision rather
 * than a status toggle: `quality.grading.releaseQuarantine` requires a reason
 * and records it. Showing it here rather than only in Quality is a deliberate
 * exception: this is where a person discovers the quarantine, and the decision
 * they have to make is about this lot in front of them.
 */
export function QuarantinePanel({ lotId, canRelease }: { lotId: string; canRelease: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const queryClient = useQueryClient();

  const gradings = useQuery({
    queryKey: ["quality.grading.listGradings", lotId],
    queryFn: () =>
      rpc<{ items: Grading[] }>("quality.grading.listGradings", {
        filter: { greenLotId: lotId, passed: false },
        page: { limit: 5 },
      }),
  });

  const release = useMutation({
    mutationFn: () =>
      rpcMutate("quality.grading.releaseQuarantine", {
        greenLotId: lotId,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inventory.green.getGreenLot"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory.green.listGreenLots"] });
      void queryClient.invalidateQueries({ queryKey: ["quality.grading.listGradings"] });
      setOpen(false);
    },
  });

  const failure = gradings.data?.items[0];

  return (
    <>
      <Card className="border border-destructive/30 bg-destructive/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldAlert className="size-4 text-destructive" aria-hidden="true" />
            Quarantined by a failed grading
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="max-w-prose text-muted-foreground">
            This lot cannot be reserved against an order or charged into a roast until the
            quarantine is released, and releasing it takes a reason that stays on the record.
          </p>

          {failure ? (
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground text-xs">Graded</dt>
                <dd className="font-mono tabular-nums">{formatDate(failure.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Standard</dt>
                <dd>{humanize(failure.standard)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Defects</dt>
                {/* Primary and secondary are different severities and are
                    counted separately by every standard; summing them here
                    would misreport the grade. */}
                <dd className="font-mono tabular-nums">
                  {failure.defectsPrimary} primary · {failure.defectsSecondary} secondary
                  {failure.fullDefectEquivalents
                    ? ` · ${formatNumber(failure.fullDefectEquivalents, { digits: 1 })} full`
                    : ""}
                </dd>
              </div>
              {failure.notes ? (
                <div className="sm:col-span-3">
                  <dt className="text-muted-foreground text-xs">Grader's note</dt>
                  <dd className="max-w-prose whitespace-pre-wrap">{failure.notes}</dd>
                </div>
              ) : null}
            </dl>
          ) : gradings.isLoading ? null : (
            <p className="text-muted-foreground">
              {/* A quarantine with no failing grading behind it means the
                  grading was deleted or the status was set by an older path.
                  Saying so is better than an empty panel. */}
              No failing grading is on record for this lot, so the reason for the quarantine is not
              recoverable from here.
            </p>
          )}

          {canRelease ? (
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              Release from quarantine
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {open ? (
        <LotActionDialog
          open
          onOpenChange={setOpen}
          title="Release this lot from quarantine"
          description="It becomes available to reserve and to roast again. The reason you give is kept with the grading."
          submitLabel="Release the lot"
          blockedBecause={reason.trim() === "" ? "A release needs a reason." : null}
          isPending={release.isPending}
          error={release.error}
          onSubmit={() => release.mutate()}
        >
          <Field>
            <FieldLabel htmlFor="release-reason">Reason</FieldLabel>
            <Textarea
              id="release-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="What changed, or why the failure does not block this coffee"
              autoFocus
            />
            <FieldDescription className="text-xs">
              This is the sentence somebody reads when they ask why a lot that failed grading was
              roasted anyway.
            </FieldDescription>
          </Field>
        </LotActionDialog>
      ) : null}
    </>
  );
}
