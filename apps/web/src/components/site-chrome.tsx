import { Button, cn } from "@roastery/ui";
import { Link } from "@tanstack/react-router";
import type * as React from "react";
import { HeaderNav } from "@/components/header-nav";
import { HEADER_NAV } from "@/content/nav";
import { SITE } from "@/content/site";
import { SOLUTIONS } from "@/content/solutions";

function Mark({ className }: { className?: string }) {
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
      </svg>
      <span className="font-semibold tracking-[0.06em]">ROASTERY</span>
    </span>
  );
}

export function SiteHeader() {
  return (
    // `relative` sits on the HEADER, not the centred container: the mega-menu
    // panel is `left-0 w-full`, so anchoring it to a max-width container would
    // stop the panel and its border at the container's edges rather than
    // spanning the viewport. The panel centres its own content separately.
    <header className="sticky top-0 z-40 border-border border-b bg-background/85 backdrop-blur relative">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-6">
        <Link to="/" aria-label="ROASTERY home">
          <Mark />
        </Link>

        <HeaderNav items={HEADER_NAV} />

        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <a href={`${SITE.console}/login`}>Sign in</a>
          </Button>
          <Button size="sm" asChild>
            <a href={`${SITE.console}/login`}>Get started</a>
          </Button>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-border border-t">
      <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3">
          <Mark />
          <p className="max-w-xs text-muted-foreground text-sm">
            Coffee operations, from the contract to the cup.
          </p>
        </div>

        <FooterColumn title="Solutions">
          {SOLUTIONS.slice(0, 4).map((solution) => (
            <FooterLink key={solution.slug} to="/solutions/$slug" params={{ slug: solution.slug }}>
              {solution.label}
            </FooterLink>
          ))}
        </FooterColumn>

        <FooterColumn title="More">
          {SOLUTIONS.slice(4).map((solution) => (
            <FooterLink key={solution.slug} to="/solutions/$slug" params={{ slug: solution.slug }}>
              {solution.label}
            </FooterLink>
          ))}
        </FooterColumn>

        <FooterColumn title="Product">
          <FooterLink to="/pricing">Pricing</FooterLink>
          <li>
            <a href={SITE.docs} className="text-muted-foreground text-sm hover:text-foreground">
              API reference
            </a>
          </li>
        </FooterColumn>
      </div>

      <div className="border-border border-t">
        <div className="mx-auto max-w-6xl px-6 py-5 font-mono text-muted-foreground text-xs">
          {/* The host this build actually serves, so a staging copy says so
              rather than claiming to be the production site. */}
          {new URL(SITE.web).host}
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 font-medium text-sm">{title}</h2>
      <ul className="space-y-2">{children}</ul>
    </div>
  );
}

function FooterLink({
  to,
  params,
  children,
}: {
  to: string;
  params?: Record<string, string>;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        // biome-ignore lint/suspicious/noExplicitAny: a generic link helper cannot name every route.
        to={to as any}
        params={params as never}
        className="text-muted-foreground text-sm hover:text-foreground"
      >
        {children}
      </Link>
    </li>
  );
}
