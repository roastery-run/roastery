/**
 * The shell for work done standing up.
 *
 * No sidebar, no org switcher, ≥44 px targets, and a wake lock — the live roast
 * screen and the cupping scoresheet are watched for twelve minutes at a time
 * without a touch, and a tablet that sleeps mid-roast loses the operator's view
 * of a crash they cannot pause.
 *
 * Correct at 1024×768, which is what a shop-floor panel PC actually is.
 */
import { Button, cn } from "@roastery/ui";
import { useRouter } from "@tanstack/react-router";
import { X } from "lucide-react";
import * as React from "react";

export function FocusShell({
  title,
  subtitle,
  actions,
  children,
  onExit,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  onExit?: () => void;
}) {
  const router = useRouter();
  useWakeLock();

  return (
    <div className={cn("focus-shell flex h-dvh flex-col bg-background")}>
      <header className="flex shrink-0 items-center gap-3 border-border border-b px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate font-semibold text-lg">{title}</h1>
          {subtitle ? (
            <div className="truncate text-muted-foreground text-sm">{subtitle}</div>
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {actions}
          <Button
            variant="ghost"
            size="icon"
            onClick={onExit ?? (() => router.history.back())}
            aria-label="Leave this screen"
          >
            <X className="size-5" aria-hidden="true" />
          </Button>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto p-4">{children}</main>
    </div>
  );
}

/**
 * Holds the screen awake, and re-acquires it after the tab is backgrounded.
 *
 * The re-acquire matters more than the initial request: the lock is released
 * automatically whenever the document loses visibility, so without this a
 * roaster who checks another app once loses the wake lock for the rest of the
 * roast.
 */
function useWakeLock(): void {
  React.useEffect(() => {
    type WakeLockSentinel = { release: () => Promise<void> };
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
    };
    if (!nav.wakeLock) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const lock = await nav.wakeLock?.request("screen");
        if (cancelled) {
          await lock?.release();
          return;
        }
        sentinel = lock ?? null;
      } catch {
        // Denied, unsupported, or the document is hidden. The screen sleeping
        // is a degradation, not a failure — never surface it.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => {});
    };
  }, []);
}
