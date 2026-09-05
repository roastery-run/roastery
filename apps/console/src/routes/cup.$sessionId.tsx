import { type FormTemplate, firstResponseProblem } from "@roastery/schemas";
import { Badge, Button, cn, Input, rpc, rpcMutate, Textarea } from "@roastery/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { CustomFields } from "@/components/custom-fields";
import { FocusShell } from "@/components/focus-shell";
import { requireAuth } from "@/lib/require-auth";

/**
 * The cupping scoresheet.
 *
 * A FocusShell, and outside the `_app` layout, for the same reason as the live
 * roast: this is filled in standing at a table with a spoon in one hand.
 *
 * One coffee at a time, not a grid. A cupper scores a sample completely before
 * moving on, and a table of ten samples by ten attributes on a tablet is a
 * hundred targets nobody can hit — and it invites scoring across the row,
 * which is not how cupping works.
 */
export const Route = createFileRoute("/cup/$sessionId")({
  beforeLoad: ({ context, location }) => requireAuth(context, location.pathname),
  component: Scoresheet,
});

type TableSample = {
  id: string;
  position: number;
  blindCode: string;
  identity: { label: string } | null;
  avgTotalScore: string | null;
  scoreCount: number;
};

type CuppingTable = {
  sessionId: string;
  mode: string;
  status: string;
  templateId: string | null;
  samples: TableSample[];
};

/**
 * The ten SCA attributes.
 *
 * Uniformity, clean cup and sweetness are scored out of 10 in whole points —
 * they count cups, not quality — while the other seven are the 6–10 quality
 * scale in quarter points. Presenting all ten identically is the most common
 * way a scoresheet gets filled in wrong.
 */
const QUALITY_ATTRIBUTES = [
  { key: "fragrance", label: "Fragrance / Aroma" },
  { key: "flavor", label: "Flavor" },
  { key: "aftertaste", label: "Aftertaste" },
  { key: "acidity", label: "Acidity" },
  { key: "body", label: "Body" },
  { key: "balance", label: "Balance" },
  { key: "overall", label: "Overall" },
] as const;

const CUP_ATTRIBUTES = [
  { key: "uniformity", label: "Uniformity" },
  { key: "cleanCup", label: "Clean cup" },
  { key: "sweetness", label: "Sweetness" },
] as const;

type Scores = Record<string, number>;

const DEFAULT_SCORES: Scores = {
  fragrance: 7.5,
  flavor: 7.5,
  aftertaste: 7.5,
  acidity: 7.5,
  body: 7.5,
  balance: 7.5,
  overall: 7.5,
  uniformity: 10,
  cleanCup: 10,
  sweetness: 10,
};

function Scoresheet() {
  const { sessionId } = Route.useParams();
  const queryClient = useQueryClient();
  const [index, setIndex] = React.useState(0);
  const [scores, setScores] = React.useState<Scores>(DEFAULT_SCORES);
  const [penalty, setPenalty] = React.useState(0);
  const [notes, setNotes] = React.useState("");
  const [cupperName, setCupperName] = React.useState("");
  const [responses, setResponses] = React.useState<Record<string, unknown>>({});

  const table = useQuery({
    queryKey: ["quality.cupping.getCuppingTable", sessionId],
    queryFn: () => rpc<CuppingTable>("quality.cupping.getCuppingTable", { sessionId }),
  });

  const samples = table.data?.samples ?? [];
  const current = samples[index];

  // The sheet the SESSION was opened against, not whatever is current: the
  // template can be edited mid-season, and every cupper on a panel has to be
  // asked the same questions or their scores are not comparable.
  const template = useQuery({
    queryKey: ["quality.form.getFormTemplate", table.data?.templateId],
    queryFn: () =>
      rpc<FormTemplate>("quality.form.getFormTemplate", { id: table.data?.templateId }),
    enabled: Boolean(table.data?.templateId),
  });
  const customFields = template.data?.fields ?? [];

  const responseError = React.useMemo(
    () => firstResponseProblem(customFields, responses),
    [customFields, responses],
  );

  const submit = useMutation({
    mutationFn: () =>
      rpcMutate("quality.cupping.submitCuppingScore", {
        sessionSampleId: current?.id,
        cupperName: cupperName.trim() || undefined,
        scores,
        defectsPenalty: penalty,
        notes: notes.trim() || undefined,
        responses: customFields.length ? responses : undefined,
      }),
    onSuccess: () => {
      toast.success(`${current?.blindCode} scored ${total.toFixed(2)}`);
      void queryClient.invalidateQueries({
        queryKey: ["quality.cupping.getCuppingTable", sessionId],
      });
      // Reset and advance: the next coffee starts from the neutral sheet, not
      // from the last one's scores, which would anchor the cupper to it.
      setScores(DEFAULT_SCORES);
      setPenalty(0);
      setNotes("");
      setResponses({});
      if (index < samples.length - 1) setIndex(index + 1);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not submit that score"),
  });

  /**
   * The SCA total: the ten attributes summed, less defects.
   *
   * Computed here as well as on the server so a cupper sees it move as they
   * score. The server's figure is authoritative — this is a preview, and the
   * two use the same arithmetic.
   */
  const total = Object.values(scores).reduce((sum, value) => sum + value, 0) - penalty;

  const adjust = (key: string, delta: number, step: number, min: number, max: number) => {
    setScores((previous) => {
      const next = Math.min(max, Math.max(min, (previous[key] ?? min) + delta * step));
      return { ...previous, [key]: Math.round(next * 4) / 4 };
    });
  };

  if (table.isLoading) {
    return (
      <FocusShell title="Cupping">
        <p className="text-muted-foreground text-sm">Loading the table…</p>
      </FocusShell>
    );
  }

  if (!current) {
    return (
      <FocusShell title="Cupping">
        <p className="text-muted-foreground text-sm">This session has no samples on the table.</p>
      </FocusShell>
    );
  }

  const blind = table.data?.mode !== "open";

  return (
    <FocusShell
      title={
        <span className="flex items-center gap-3">
          <span className="font-mono">{current.blindCode}</span>
          {blind ? <Badge variant="secondary">Blind</Badge> : null}
        </span>
      }
      subtitle={
        // In a blind session the identity is withheld — showing it would defeat
        // the protocol, and a cupper who glimpses it cannot un-know it.
        blind
          ? `Sample ${index + 1} of ${samples.length}`
          : `${current.identity?.label ?? "Unidentified"} · ${index + 1} of ${samples.length}`
      }
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setIndex(Math.max(0, index - 1))}
            disabled={index === 0}
            aria-label="Previous sample"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setIndex(Math.min(samples.length - 1, index + 1))}
            disabled={index === samples.length - 1}
            aria-label="Next sample"
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </Button>
        </div>
      }
    >
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-6">
          <section className="space-y-3">
            <h2 className="font-medium text-sm uppercase tracking-wide">Quality — 6 to 10</h2>
            {QUALITY_ATTRIBUTES.map((attribute) => (
              <ScoreRow
                key={attribute.key}
                label={attribute.label}
                value={scores[attribute.key] ?? 6}
                min={6}
                max={10}
                step={0.25}
                onAdjust={(delta) => adjust(attribute.key, delta, 0.25, 6, 10)}
              />
            ))}
          </section>

          <section className="space-y-3">
            <h2 className="font-medium text-sm uppercase tracking-wide">
              Cups — 0 to 10, whole points
            </h2>
            <p className="text-muted-foreground text-xs">
              {/* These count cups rather than judging quality: two tainted cups
                  out of five is 6, not "a bit off". */}
              Two points per clean cup, out of five.
            </p>
            {CUP_ATTRIBUTES.map((attribute) => (
              <ScoreRow
                key={attribute.key}
                label={attribute.label}
                value={scores[attribute.key] ?? 0}
                min={0}
                max={10}
                step={2}
                onAdjust={(delta) => adjust(attribute.key, delta, 2, 0, 10)}
              />
            ))}
          </section>

          {customFields.length ? (
            <section className="space-y-2">
              <h2 className="font-medium text-sm uppercase tracking-wide">
                {template.data?.name ?? "Additional"}
              </h2>
              <CustomFields
                fields={customFields}
                values={responses}
                onChange={(key, value) =>
                  setResponses((previous) => ({ ...previous, [key]: value }))
                }
              />
            </section>
          ) : null}

          <section className="space-y-2">
            <h2 className="font-medium text-sm uppercase tracking-wide">Notes</h2>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Descriptors, defects, anything the score does not carry"
              rows={3}
            />
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-2xl bg-card ring-1 ring-foreground/10 p-4">
            <div className="text-muted-foreground text-xs">Total</div>
            <div className="mt-1 font-mono font-semibold text-4xl tabular-nums">
              {total.toFixed(2)}
            </div>
            <div className="mt-1 text-muted-foreground text-xs">
              {total >= 80 ? "Specialty" : "Below specialty"}
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="penalty" className="font-medium text-sm">
              Defects penalty
            </label>
            <Input
              id="penalty"
              type="number"
              min={0}
              max={40}
              step={2}
              value={penalty}
              onChange={(event) => setPenalty(Number(event.target.value) || 0)}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="cupper" className="font-medium text-sm">
              Your name
            </label>
            <Input
              id="cupper"
              value={cupperName}
              onChange={(event) => setCupperName(event.target.value)}
              placeholder="Optional for a visiting cupper"
            />
            <p className="text-muted-foreground text-xs">
              {/* Each cupper's score is stored separately — that is what makes
                  the panel's spread meaningful rather than an average of one. */}
              Leave blank to score as yourself.
            </p>
          </div>

          <Button
            size="lg"
            className="w-full"
            onClick={() => submit.mutate()}
            disabled={submit.isPending || responseError !== null}
          >
            Submit {current.blindCode}
          </Button>

          {/* Named on the button rather than surfaced only on the failed
              request: a cupper is standing at a table with a spoon, and a
              round trip to learn a required field is blank is a round trip
              too many. */}
          {responseError ? (
            <p className="text-center text-destructive text-xs">{responseError}</p>
          ) : null}

          {current.scoreCount > 0 ? (
            <p className="text-center text-muted-foreground text-xs">
              {current.scoreCount} score{current.scoreCount === 1 ? "" : "s"} already on this cup
            </p>
          ) : null}
        </aside>
      </div>
    </FocusShell>
  );
}

/**
 * One attribute.
 *
 * Big steppers rather than a slider: a slider cannot be hit accurately with a
 * wet hand, and quarter points are the unit — a control that lands anywhere
 * between them produces scores the standard does not define.
 */
function ScoreRow({
  label,
  value,
  min,
  max,
  step,
  onAdjust,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onAdjust: (delta: number) => void;
}) {
  return (
    // Capped rather than filling the column: a label at one edge and its
    // stepper at the other stops reading as one control, and a cupper glancing
    // down the sheet has to re-associate them every row.
    <div className="flex max-w-md items-center gap-4">
      <span className="min-w-0 flex-1 text-sm">{label}</span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          onClick={() => onAdjust(-1)}
          disabled={value <= min}
          aria-label={`Decrease ${label}`}
        >
          −
        </Button>
        <output
          className={cn(
            "w-16 text-center font-mono text-lg tabular-nums",
            value === max && "text-primary",
          )}
          aria-label={`${label}: ${value}`}
        >
          {step < 1 ? value.toFixed(2) : value.toFixed(0)}
        </output>
        <Button
          variant="outline"
          size="icon"
          onClick={() => onAdjust(1)}
          disabled={value >= max}
          aria-label={`Increase ${label}`}
        >
          +
        </Button>
      </div>
    </div>
  );
}
