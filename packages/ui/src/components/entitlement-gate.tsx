/**
 * Entitlement gating, in the UI only.
 *
 * Two decisions here, both deliberate and both the opposite of what feels
 * natural:
 *
 * 1. A locked module stays VISIBLE and locked, never hidden. A customer who
 *    cannot see Sample Management will never buy it, and a nav that changes
 *    shape between plans is one nobody can be walked through over the phone.
 *
 * 2. It FAILS OPEN. If entitlements cannot be loaded, the feature is shown. A
 *    broken entitlements endpoint must not lock a paying customer out of a
 *    module they bought, and the API enforces every write regardless — this is
 *    UX, and a hidden nav item was never a security boundary.
 */
import { Lock } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";

export type Entitlements = {
  planSlug: string;
  modules: Record<string, boolean>;
  limits: Record<string, number | null>;
} | null;

const EntitlementContext = React.createContext<Entitlements>(null);

export function EntitlementProvider({
  value,
  children,
}: {
  value: Entitlements;
  children: React.ReactNode;
}) {
  return <EntitlementContext.Provider value={value}>{children}</EntitlementContext.Provider>;
}

export function useEntitlements(): Entitlements {
  return React.useContext(EntitlementContext);
}

export function useHasModule(module: string): boolean {
  const entitlements = useEntitlements();
  // Unknown means unloaded or failed. Fail open — see the note above.
  if (!entitlements) return true;
  return entitlements.modules[module] ?? false;
}

export function LockedModule({
  module,
  title,
  description,
  onUpgrade,
  className,
}: {
  module: string;
  title: string;
  description: string;
  onUpgrade?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-3 rounded-md border border-dashed border-border bg-muted/40 p-8",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <Lock className="size-4 text-muted-foreground" aria-hidden="true" />
        {title}
      </div>
      <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
      {onUpgrade ? (
        <Button size="sm" onClick={onUpgrade}>
          See plans
        </Button>
      ) : null}
      <span className="sr-only">The {module} module is not included in your plan.</span>
    </div>
  );
}
