/**
 * The shape every detail screen shares.
 *
 * A definition list of facts, then the panels below it. The facts pane is a
 * real `<dl>` rather than a grid of divs: a screen reader announces "Lot code,
 * COL-2026-01" as a pair, which is what the information actually is.
 */
import { cn, Metric, PageHeader, Skeleton } from "@roastery/ui";
import type * as React from "react";

export function DetailLayout({
  title,
  subtitle,
  status,
  actions,
  facts,
  isLoading,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  status?: React.ReactNode;
  actions?: React.ReactNode;
  facts: {
    label: string;
    value: React.ReactNode;
    /**
     * A value that came from or goes back to the system: a weight, a code, a
     * date, a count. Mono was applied to EVERY value here, which put a variety
     * list and a process method in a face reserved for machine values — and
     * "Mono Means Machine" stops meaning anything once it means everything.
     */
    mono?: boolean;
    /**
     * A figure this screen exists to report.
     *
     * Every fact rendered at the same 14px meant the weight a roaster reads
     * standing at a machine carried exactly as much weight as the harvest
     * year, in position seven of eight. The Figure step exists in the design
     * system for this and was being spent on money, on a screen read seated.
     *
     * Two to four per screen. Marking everything primary is the same failure
     * as marking nothing.
     */
    primary?: boolean;
    /** Rendered after a primary figure, muted: "kg", "bags". */
    unit?: string;
  }[];
  isLoading?: boolean;
  children?: React.ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Split rather than styled in place: a figure at 1.5rem inside a four-column
  // grid of 14px labels makes a ragged row, and the point is that these are a
  // different KIND of fact, not a louder one.
  const primary = facts.filter((fact) => fact.primary);
  const rest = facts.filter((fact) => !fact.primary);

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {title}
            {status}
          </span>
        }
        description={subtitle}
        actions={actions}
      />

      {primary.length > 0 ? (
        <div
          className={cn(
            "grid gap-3",
            primary.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3",
          )}
        >
          {primary.map((fact) => (
            <Metric key={fact.label} label={fact.label} value={fact.value} unit={fact.unit} />
          ))}
        </div>
      ) : null}

      <dl className="grid gap-x-6 gap-y-3 rounded-2xl bg-card ring-1 ring-foreground/10 p-4 sm:grid-cols-2 lg:grid-cols-4">
        {rest.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="text-muted-foreground text-xs">{fact.label}</dt>
            <dd
              className={cn("truncate text-sm", fact.mono && "font-mono tabular-nums")}
              // Truncated by design in a fixed grid, so the full value has to
              // be recoverable: "Caturra, Castillo, Colomb…" is otherwise gone.
              title={typeof fact.value === "string" ? fact.value : undefined}
            >
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>

      {children}
    </div>
  );
}
