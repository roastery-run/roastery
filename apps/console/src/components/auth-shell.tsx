import type * as React from "react";
import { BrandMark } from "@/components/brand-mark";

/**
 * The sign-in surface.
 *
 * A split panel: a quiet brand column beside the form. The brand column states
 * what the product does in the operator's own vocabulary rather than in
 * marketing adjectives — this is the first screen a roaster sees, and the
 * things listed are things they will recognise from their own week.
 *
 * Hidden below `lg`, where the form centres on its own.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-border border-r bg-sidebar p-10 lg:flex">
        {/* A hairline grid, the same one the console's chart axes use. Quiet
            enough to be texture rather than decoration. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.5] [background-image:linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:radial-gradient(120%_100%_at_20%_0%,black,transparent_70%)]"
        />

        <BrandMark className="relative z-10" />

        <div className="relative z-10 flex flex-col gap-6">
          <h2 className="text-balance font-semibold text-[clamp(1.5rem,2.6vw,2.1rem)] leading-[1.1] tracking-tight">
            From the contract to the cup.{" "}
            <span className="text-muted-foreground">One system of record.</span>
          </h2>
          <ul className="flex flex-col gap-3 font-mono text-muted-foreground text-xs">
            {[
              "green contracts, positions and landed cost",
              "live roast curves at 1 Hz, from any bridge",
              "cupping panels with the spread, not just the mean",
              "orders sequenced into a machine-feasible roast day",
            ].map((line, index) => (
              <li key={line} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={
                    index === 0
                      ? "inline-flex size-1.5 shrink-0 bg-primary"
                      : "inline-flex size-1.5 shrink-0 bg-muted-foreground/40"
                  }
                />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 font-mono text-muted-foreground text-xs">roastery.run</p>
      </aside>

      <div className="flex flex-col bg-background">
        <header className="flex items-center px-6 py-5 lg:hidden">
          <BrandMark />
        </header>
        <main className="flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-[22rem]">{children}</div>
        </main>
      </div>
    </div>
  );
}
