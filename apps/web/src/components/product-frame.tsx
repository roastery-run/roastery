import { cn } from "@roastery/ui";
import type * as React from "react";

/**
 * A real console component, shown as a product visual.
 *
 * The whole point is that these are the ACTUAL components from the design
 * system fed fixed data, not screenshots. Screenshots go stale the week after
 * they are taken, they are wrong in the other theme, and nobody notices either
 * until a customer does.
 *
 * Inert and hidden from assistive technology, with a text alternative — it is
 * an illustration of the product, and letting a screen reader tab into a fake
 * table is worse than describing it.
 */
export function ProductFrame({
  label,
  caption,
  children,
  className,
}: {
  /** What a screen reader hears instead of the contents. */
  label: string;
  caption?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <figure className={cn("space-y-2", className)}>
      <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10 shadow-sm">
        <div className="flex items-center gap-1.5 border-border border-b bg-muted/40 px-3 py-2">
          <span className="size-2 rounded-full bg-muted-foreground/30" aria-hidden="true" />
          <span className="size-2 rounded-full bg-muted-foreground/30" aria-hidden="true" />
          <span className="size-2 rounded-full bg-muted-foreground/30" aria-hidden="true" />
          {caption ? (
            <span className="ml-2 font-mono text-muted-foreground text-xs">{caption}</span>
          ) : null}
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none select-none p-4"
          // Nothing inside is reachable by keyboard: it is a picture.
          // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: inert by design.
          inert
        >
          {children}
        </div>
      </div>
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  );
}
