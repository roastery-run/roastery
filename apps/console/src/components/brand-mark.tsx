import { cn } from "@roastery/ui";

/**
 * The wordmark.
 *
 * A drum silhouette, not a coffee cup — this is production software.
 *
 * Set in caps and slightly tracked out. ROASTERY is a NAME; written
 * "Roastery" it reads as the ordinary word for the building, which is what
 * the product is sold to. Uppercase letterforms have no ascenders or
 * descenders to separate them, so they need the extra letter-spacing to avoid
 * looking cramped.
 */
export function BrandMark({
  className,
  showText = true,
}: {
  className?: string;
  showText?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 32 32" className="size-6 shrink-0" aria-hidden="true">
        <title>ROASTERY</title>
        <rect width="32" height="32" rx="4" className="fill-primary" />
        <path
          d="M9 10h11a5 5 0 0 1 0 10h-1v1a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3V10z"
          fill="none"
          className="stroke-primary-foreground"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M20 13h1a2 2 0 0 1 0 4h-1"
          fill="none"
          className="stroke-primary-foreground"
          strokeWidth="2"
        />
      </svg>
      {showText ? (
        <span className="font-semibold text-base tracking-[0.06em]">ROASTERY</span>
      ) : null}
    </span>
  );
}
