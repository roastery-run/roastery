import { humanize } from "@roastery/units";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/badge";

/**
 * A status, shown so it survives being printed in greyscale.
 *
 * Colour is never the only signal. Each tone carries a distinct leading glyph
 * as well, because QC reports get printed, ~8% of male readers cannot separate
 * the red from the green, and an operator glancing at a shop-floor screen from
 * two metres away is reading shape before hue.
 */
export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info" | "active";

const TONE_VARIANT = {
  neutral: "secondary",
  success: "success",
  warning: "warning",
  danger: "destructive",
  info: "info",
  active: "default",
} as const;

/** The redundant, non-colour signal. */
const TONE_GLYPH: Record<StatusTone, string> = {
  neutral: "○",
  success: "●",
  warning: "▲",
  danger: "■",
  info: "◆",
  active: "◉",
};

/**
 * Domain status → tone.
 *
 * Centralized so "quarantined" is the same red on the lot list, the lot detail
 * and a report. Scattering this across screens is how one screen ends up
 * calling a quarantined lot merely "inactive".
 */
const STATUS_TONE: Record<string, StatusTone> = {
  // Inventory
  available: "success",
  reserved: "info",
  quarantined: "danger",
  depleted: "neutral",
  in_transit: "info",
  // Production
  scheduled: "neutral",
  in_progress: "active",
  cooling: "active",
  completed: "success",
  aborted: "danger",
  discarded: "danger",
  // Orders
  draft: "neutral",
  confirmed: "info",
  partially_fulfilled: "warning",
  fulfilled: "success",
  canceled: "danger",
  paid: "success",
  // Schedules and quality
  released: "success",
  finalized: "success",
  passed: "success",
  failed: "danger",
  // Webhooks and reports
  active: "success",
  disabled: "neutral",
  auto_disabled: "danger",
  pending: "warning",
  rendering: "info",
  ready: "success",
  succeeded: "success",
  dead: "danger",
  // Café
  in_spec: "success",
  channeling: "danger",
  fast: "warning",
  slow: "warning",
  under_dosed: "warning",
  over_dosed: "warning",
  matched: "success",
  shot_missing: "danger",
  sale_missing: "warning",
};

export function toneFor(status: string): StatusTone {
  return STATUS_TONE[status] ?? "neutral";
}

export function StatusBadge({
  status,
  tone,
  label,
  className,
}: {
  status: string;
  /** Override when a status means something different in context. */
  tone?: StatusTone;
  label?: string;
  className?: string;
}) {
  const resolved = tone ?? toneFor(status);
  return (
    <Badge variant={TONE_VARIANT[resolved]} className={cn("gap-1.5", className)}>
      <span aria-hidden="true" className="text-[0.6rem] leading-none">
        {TONE_GLYPH[resolved]}
      </span>
      {label ?? humanize(status)}
    </Badge>
  );
}
