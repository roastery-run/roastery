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
  cn,
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
import { add, formatWeight, grossUpForLoss, parseDecimal, subtract } from "@roastery/units";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/workspace";

/**
 * The blend builder.
 *
 * The whole screen exists because of one constraint: component ratios must
 * total exactly 100%. The API rejects anything else — correctly — and a form
 * that lets you discover that on submit, after filling in six rows, is a form
 * people learn to dread.
 *
 * So the total is live, the remainder is offered as a one-click fill, and
 * `Save` stays disabled until it balances. The rule is the same either way;
 * only the moment you find out about it changes.
 */
/**
 * `blends_.new` rather than `blends.new`: the trailing underscore makes this a
 * SIBLING of the blends list rather than a child of it. Without it the list
 * would have to render an Outlet, and navigating here would show the table
 * with the builder underneath.
 */
export const Route = createFileRoute("/_app/inventory/blends_/new")({
  component: BlendBuilder,
});

type GreenLot = { id: string; name: string; lotCode: string; currentWeightKg: string };

type Component = { key: string; greenLotId: string; ratio: string };

const ROAST_LEVELS = ["light", "medium", "dark"] as const;

function BlendBuilder() {
  const { can } = useWorkspace();
  const navigate = useNavigate();

  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [roastLevel, setRoastLevel] = React.useState<string>("medium");
  const [isDecaf, setIsDecaf] = React.useState(false);
  const [lossPct, setLossPct] = React.useState("15.00");
  const [components, setComponents] = React.useState<Component[]>([
    { key: crypto.randomUUID(), greenLotId: "", ratio: "" },
  ]);

  const lots = useQuery({
    queryKey: ["inventory.green.listGreenLots", "blend-builder"],
    queryFn: () =>
      rpc<{ items: GreenLot[] }>("inventory.green.listGreenLots", {
        filter: { status: "available" },
        page: { limit: 200 },
      }),
  });

  const lotById = new Map((lots.data?.items ?? []).map((lot) => [lot.id, lot]));

  // Summed with exact decimals, not floats. Three components of 33.33 must
  // total 99.99 and be REJECTED, not silently pass because 0.1 + 0.2 rounded
  // its way to 100.
  const total = components.reduce<string>(
    (sum, component) => add(sum, parseDecimal(component.ratio) ?? "0"),
    "0",
  );
  const remainder = subtract("100", total);
  const balanced = Number.parseFloat(remainder) === 0;

  const filled = components.filter((c) => c.greenLotId && c.ratio.trim());
  const duplicated = new Set(filled.map((c) => c.greenLotId)).size !== filled.length;
  const complete = filled.length === components.length && components.length > 0;

  const update = (key: string, patch: Partial<Component>) =>
    setComponents((previous) => previous.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const create = useMutation({
    mutationFn: () =>
      rpcMutate<{ id: string }>("inventory.blend.createBlend", {
        name: name.trim(),
        code: code.trim(),
        blendType: "pre_roast",
        targetWeightLossPct: lossPct,
        roastLevel,
        isDecaf,
        components: components.map((c) => ({
          greenLotId: c.greenLotId,
          // Four decimals, matching the column: a ratio typed as "33.3333" has
          // to survive the round trip or the total stops adding to 100.
          targetRatioPct: parseDecimal(c.ratio) ?? "0",
        })),
      }),
    onSuccess: () => {
      toast.success(`${name} created`);
      void navigate({ to: "/inventory/blends" });
    },
    onError: (error) => {
      // Field errors map back onto the form; anything else is a message.
      if (error instanceof ApiError && Object.keys(error.fields).length) {
        toast.error("Check the highlighted fields", {
          description: Object.values(error.fields)[0],
        });
        return;
      }
      toast.error(error instanceof Error ? error.message : "Could not create that blend");
    },
  });

  /** What 100 kg of finished coffee would need of each component, in green. */
  const greenFor100 = grossUpForLoss("100", lossPct) ?? "100";

  /** The FIRST thing standing between the user and a saved blend. */
  const blockedBecause =
    !name.trim() || !code.trim()
      ? "A blend needs a name and a code."
      : !complete
        ? "Every row needs a lot and a ratio."
        : duplicated
          ? "The same lot appears in more than one row."
          : !balanced
            ? "Ratios must total exactly 100%."
            : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="New blend"
        description="Component ratios must total exactly 100%. The total is live, so you find out here rather than on submit."
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Identity</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="name">Name</FieldLabel>
                <Input
                  id="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="House Blend"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="code">Code</FieldLabel>
                <Input
                  id="code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  placeholder="BL-HOUSE"
                  className="font-mono"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="roast">Roast level</FieldLabel>
                <Select value={roastLevel} onValueChange={setRoastLevel}>
                  <SelectTrigger id="roast" aria-describedby="roast-description">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROAST_LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription id="roast-description" className="text-xs">
                  {/* Not cosmetic: this decides where the blend lands in a
                      roast day — light before dark. */}
                  Decides the roast order: light runs before dark.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="loss">Target weight loss</FieldLabel>
                <Input
                  id="loss"
                  aria-describedby="loss-description"
                  value={lossPct}
                  onChange={(event) => setLossPct(event.target.value)}
                  className="font-mono"
                />
                <FieldDescription id="loss-description" className="text-xs">
                  100 kg roasted needs {formatWeight(greenFor100)} of green.
                </FieldDescription>
              </Field>
              <div className="flex items-center gap-2 sm:col-span-2">
                <Switch id="decaf" checked={isDecaf} onCheckedChange={setIsDecaf} />
                <Label htmlFor="decaf">Decaffeinated</Label>
                <span className="text-muted-foreground text-xs">
                  Decaf runs last, regardless of how light it is.
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm">Components</CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setComponents((previous) => [
                    ...previous,
                    { key: crypto.randomUUID(), greenLotId: "", ratio: "" },
                  ])
                }
                disabled={components.length >= 20}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                Add
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {components.map((component) => {
                const lot = lotById.get(component.greenLotId);
                const ratio = parseDecimal(component.ratio);
                return (
                  <div key={component.key} className="flex flex-wrap items-end gap-2">
                    <div className="min-w-56 flex-1 space-y-1.5">
                      <Label className="sr-only">Green lot</Label>
                      <Select
                        value={component.greenLotId}
                        onValueChange={(value) => update(component.key, { greenLotId: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a green lot" />
                        </SelectTrigger>
                        <SelectContent>
                          {(lots.data?.items ?? []).map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name} — {formatWeight(item.currentWeightKg)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="w-28 space-y-1.5">
                      <Label className="sr-only">Ratio</Label>
                      <Input
                        value={component.ratio}
                        onChange={(event) => update(component.key, { ratio: event.target.value })}
                        placeholder="0.00"
                        inputMode="decimal"
                        className={cn(
                          "text-right font-mono",
                          ratio === null && component.ratio && "border-destructive",
                        )}
                        aria-label="Ratio percent"
                      />
                    </div>

                    <div className="w-32 pb-2 text-right font-mono text-muted-foreground text-xs tabular-nums">
                      {/* What this component contributes to a 100 kg batch,
                          in GREEN — which is what a roaster weighs out. */}
                      {ratio && lot
                        ? formatWeight(
                            (
                              (Number.parseFloat(greenFor100) * Number.parseFloat(ratio)) /
                              100
                            ).toFixed(4),
                          )
                        : "—"}
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setComponents((previous) => previous.filter((c) => c.key !== component.key))
                      }
                      disabled={components.length === 1}
                      aria-label="Remove component"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-2xl bg-card ring-1 ring-foreground/10 p-4">
            <div className="text-muted-foreground text-xs">Total ratio</div>
            <div
              className={cn(
                "mt-1 font-mono font-semibold text-3xl tabular-nums",
                balanced ? "text-success" : "text-warning",
              )}
            >
              {Number.parseFloat(total).toFixed(2)}%
            </div>
            {!balanced ? (
              <div className="mt-2 space-y-2">
                <p className="text-muted-foreground text-xs">
                  {Number.parseFloat(remainder) > 0
                    ? `${Number.parseFloat(remainder).toFixed(2)}% unallocated`
                    : `${Math.abs(Number.parseFloat(remainder)).toFixed(2)}% over`}
                </p>
                {Number.parseFloat(remainder) > 0 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      // Fills the LAST row, which is the one being worked on.
                      const last = components.at(-1);
                      if (!last) return;
                      const current = parseDecimal(last.ratio) ?? "0";
                      update(last.key, { ratio: add(current, remainder) });
                    }}
                  >
                    Put the remainder in the last row
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-muted-foreground text-xs">Balanced.</p>
            )}
          </div>

          {duplicated ? (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" aria-hidden="true" />
              <AlertTitle>A lot appears twice</AlertTitle>
              <AlertDescription>
                Combine those rows — two entries for one lot make the recipe ambiguous.
              </AlertDescription>
            </Alert>
          ) : null}

          <Button
            size="lg"
            className="w-full"
            onClick={() => create.mutate()}
            disabled={create.isPending || blockedBecause !== null || !can("inventory.blend.write")}
          >
            Create blend
          </Button>

          {!balanced || !complete ? (
            <p className="text-center text-muted-foreground text-xs">
              {/* Says WHY it is disabled. A disabled button with no explanation
                  is the most frustrating control in any form. */}
              {!complete ? "Every row needs a lot and a ratio." : "Ratios must total exactly 100%."}
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
