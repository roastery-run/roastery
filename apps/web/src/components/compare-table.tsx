import { cn, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@roastery/ui";
import { Check, Info, Minus } from "lucide-react";
import { ALL_MODULES, COMPARE_ROWS, isSection, MODULE_LABEL, PLANS } from "@/content/pricing";

/**
 * The plan comparison.
 *
 * Section rows are real `<th scope="colgroup">` cells rather than styled
 * dividers, so a screen reader announces the grouping instead of reading
 * thirty ungrouped rows.
 */
export function CompareTable() {
  const columns = PLANS.map((plan) => plan.slug as "starter" | "core" | "scale" | "advanced");

  return (
    <TooltipProvider delayDuration={200}>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-3xl text-sm">
          <caption className="sr-only">What each plan includes</caption>
          <thead className="sticky top-0 bg-card">
            <tr className="border-border border-b">
              <th scope="col" className="px-4 py-3 text-left font-medium">
                Feature
              </th>
              {PLANS.map((plan) => (
                <th
                  key={plan.slug}
                  scope="col"
                  className={cn(
                    "px-4 py-3 text-center font-medium",
                    plan.highlighted && "text-primary",
                  )}
                >
                  {plan.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {COMPARE_ROWS.map((row) =>
              isSection(row) ? (
                <tr key={row.feature} className="bg-muted/40">
                  <th
                    scope="colgroup"
                    colSpan={PLANS.length + 1}
                    className="px-4 py-2 text-left font-medium text-sm"
                  >
                    {row.feature}
                  </th>
                </tr>
              ) : (
                <tr key={row.feature}>
                  <th scope="row" className="px-4 py-2.5 text-left font-normal">
                    <span className="inline-flex items-center gap-1.5">
                      {row.feature}
                      {row.hint ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button type="button" className="text-muted-foreground">
                              <Info className="size-3.5" aria-hidden="true" />
                              <span className="sr-only">About {row.feature}</span>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">{row.hint}</TooltipContent>
                        </Tooltip>
                      ) : null}
                    </span>
                  </th>
                  {columns.map((column) => (
                    <td key={column} className="px-4 py-2.5 text-center">
                      <Cell value={row[column]} feature={row.feature} plan={column} />
                    </td>
                  ))}
                </tr>
              ),
            )}

            <tr className="bg-muted/40">
              <th
                scope="colgroup"
                colSpan={PLANS.length + 1}
                className="px-4 py-2 text-left font-medium text-sm"
              >
                Modules
              </th>
            </tr>
            {ALL_MODULES.map((module) => (
              <tr key={module}>
                <th scope="row" className="px-4 py-2.5 text-left font-normal">
                  {MODULE_LABEL[module]}
                </th>
                {PLANS.map((plan) => (
                  <td key={plan.slug} className="px-4 py-2.5 text-center">
                    <Cell
                      value={plan.modules.includes(module)}
                      feature={MODULE_LABEL[module]}
                      plan={plan.slug}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  );
}

/**
 * Never a colour-only signal, and never an unlabelled icon.
 *
 * This table gets printed and forwarded, and a tick with no text alternative
 * reads to a screen reader as nothing at all.
 */
function Cell({
  value,
  feature,
  plan,
}: {
  value: string | boolean | undefined;
  feature: string;
  plan: string;
}) {
  if (typeof value === "string") {
    return <span className="tabular-nums">{value}</span>;
  }
  if (value === true) {
    return (
      <>
        <Check className="mx-auto size-4 text-success" aria-hidden="true" />
        <span className="sr-only">
          {feature} is included in {plan}
        </span>
      </>
    );
  }
  return (
    <>
      <Minus className="mx-auto size-4 text-muted-foreground/40" aria-hidden="true" />
      <span className="sr-only">
        {feature} is not included in {plan}
      </span>
    </>
  );
}
