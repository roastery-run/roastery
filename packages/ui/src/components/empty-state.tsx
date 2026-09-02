import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";

/**
 * What a screen shows when there is genuinely nothing.
 *
 * Distinct from loading and from error, because they need different words and
 * different actions — a spinner that resolves into "no results" reads as a
 * failure, and an error that looks like an empty list is one nobody reports.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border px-6 py-16 text-center",
        className,
      )}
    >
      {Icon ? <Icon className="size-6 text-muted-foreground" aria-hidden="true" /> : null}
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description ? (
          <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? (
        <Button size="sm" variant="outline" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-6",
        className,
      )}
    >
      <p className="text-sm font-medium">{title}</p>
      {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
