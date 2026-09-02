import type * as React from "react";
import { cn } from "../lib/utils";

/**
 * The heading block every screen opens with.
 *
 * One component so the h1 is always an h1 — a page whose title is a styled div
 * is a page a screen-reader user cannot navigate to.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-3 pb-4", className)}>
      <div className="min-w-0 space-y-1">
        <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * A labelled figure, for the row of numbers at the top of a dashboard.
 *
 * `mono` because these are compared column to column; `delta` is never
 * colour-only — it carries an arrow.
 */
export function Metric({
  label,
  value,
  unit,
  delta,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  delta?: { direction: "up" | "down" | "flat"; label: string };
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-md border border-border bg-card p-4", className)}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-mono text-2xl font-semibold tabular-nums">{value}</span>
        {unit ? <span className="text-sm text-muted-foreground">{unit}</span> : null}
      </div>
      {delta ? (
        <div
          className={cn(
            "mt-1 text-xs",
            delta.direction === "up" && "text-success",
            delta.direction === "down" && "text-destructive",
            delta.direction === "flat" && "text-muted-foreground",
          )}
        >
          <span aria-hidden="true">
            {delta.direction === "up" ? "↑" : delta.direction === "down" ? "↓" : "→"}
          </span>{" "}
          {delta.label}
        </div>
      ) : null}
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
