/**
 * The shape every detail screen shares.
 *
 * A definition list of facts, then the panels below it. The facts pane is a
 * real `<dl>` rather than a grid of divs: a screen reader announces "Lot code,
 * COL-2026-01" as a pair, which is what the information actually is.
 */
import { PageHeader, Skeleton } from "@roastery/ui";
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
  facts: { label: string; value: React.ReactNode }[];
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

      <dl className="grid gap-x-6 gap-y-3 rounded-2xl bg-card ring-1 ring-foreground/10 p-4 sm:grid-cols-2 lg:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="text-muted-foreground text-xs">{fact.label}</dt>
            <dd className="truncate font-mono text-sm tabular-nums">{fact.value}</dd>
          </div>
        ))}
      </dl>

      {children}
    </div>
  );
}
