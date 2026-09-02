import { cn } from "@roastery/ui";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import * as React from "react";
import type { HeaderNavItem } from "@/content/nav";

const LINK_CLASS =
  "px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground";

/**
 * The header's mega menu.
 *
 * A DISCLOSURE, not a menubar. No `role="menu"` or `role="menuitem"` anywhere:
 * those roles promise arrow-key roving focus and typeahead, and a component
 * that announces itself as a menu without implementing them is worse for a
 * screen-reader user than plain buttons and links. The only promise made here
 * is expand/collapse, and it is kept.
 *
 * One full-width panel pinned under the header, animating height so the
 * header's own bottom border reads as sliding down. Every sub-panel stays
 * mounted and cross-fades; closed ones are `aria-hidden`, `tabIndex={-1}` and
 * `pointer-events-none`, so nothing hidden is reachable.
 */
export function HeaderNav({ items }: { items: HeaderNavItem[] }) {
  const [active, setActive] = React.useState<number | null>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const navRef = React.useRef<HTMLElement>(null);
  const panelRefs = React.useRef<Record<number, HTMLDivElement | null>>({});
  const triggerRefs = React.useRef<Record<number, HTMLButtonElement | null>>({});

  const openMenu = (index: number) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setActive(index);
  };
  const keepOpen = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };
  // A short delay, so crossing the gap between the trigger and the panel does
  // not close it under the pointer.
  const closeSoon = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setActive(null), 150);
  };

  React.useEffect(() => {
    if (active === null) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Return focus to the trigger, so a keyboard user is not dropped into a
      // region that just collapsed underneath them.
      if (navRef.current?.contains(document.activeElement)) {
        triggerRefs.current[active]?.focus();
      }
      setActive(null);
    };
    const onPointerDown = (event: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) setActive(null);
    };
    // A hover-opened panel must not stay pinned over the page while it scrolls
    // underneath.
    const onScroll = () => setActive(null);

    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", onScroll);
    };
  }, [active]);

  /** Close when focus leaves the nav entirely, so tabbing out dismisses it. */
  const onBlur = (event: React.FocusEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) setActive(null);
  };

  const onTriggerClick = (index: number, event: React.MouseEvent) => {
    if (active === index) {
      setActive(null);
      return;
    }
    openMenu(index);
    // `detail === 0` means Enter or Space rather than a real click. Move focus
    // into the panel: in DOM order its first link sits past every remaining
    // trigger, which is a long way to tab for something that just opened.
    if (event.detail === 0) {
      panelRefs.current[index]?.querySelector("a")?.focus();
    }
  };

  const open = active !== null;
  const height = open ? (panelRefs.current[active]?.offsetHeight ?? 0) : 0;

  return (
    // `lg`, not `sm`: the full row — wordmark, three items, and the auth pair —
    // needs roughly 800px before it starts wrapping.
    <nav ref={navRef} onBlur={onBlur} className="hidden items-center lg:flex">
      {items.map((item, index) =>
        item.sections ? (
          // Hover lives on the BUTTON, not a wrapper div. The button is the
          // real control — focusable, `aria-expanded`, and driven by Enter,
          // Space and Escape — so hover is a pure convenience layered on top.
          // Crossing the gap to the panel is covered by the panel's own
          // `keepOpen` plus the 150 ms close delay, which is what the wrapper
          // was there for.
          <button
            key={item.label}
            type="button"
            ref={(el) => {
              triggerRefs.current[index] = el;
            }}
            aria-expanded={active === index}
            aria-controls={`header-panel-${index}`}
            onClick={(event) => onTriggerClick(index, event)}
            onMouseEnter={() => openMenu(index)}
            onMouseLeave={closeSoon}
            className={cn(
              "flex items-center gap-1",
              LINK_CLASS,
              active === index && "text-foreground",
            )}
          >
            {item.label}
            <ChevronDown
              className={cn(
                "size-3 opacity-60 transition-transform duration-200",
                active === index && "rotate-180",
              )}
              aria-hidden="true"
            />
          </button>
        ) : (
          <Link
            key={item.label}
            // biome-ignore lint/suspicious/noExplicitAny: a data-driven nav cannot name every route.
            to={item.href as any}
            onMouseEnter={closeSoon}
            className={LINK_CLASS}
          >
            {item.label}
          </Link>
        ),
      )}

      {/* `-mt-px` overlaps the header's own border, so the panel's bottom
          border reads as that same line sliding down rather than a second one
          appearing. */}
      <div
        aria-hidden={!open}
        onMouseEnter={keepOpen}
        onMouseLeave={closeSoon}
        className={cn(
          "-mt-px absolute top-full left-0 w-full overflow-hidden border-b bg-background transition-[height,border-color] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none",
          open ? "border-border" : "pointer-events-none border-transparent",
        )}
        style={{ height: `${height}px` }}
      >
        <div className="relative">
          {items.map((item, index) =>
            item.sections ? (
              <div
                key={item.label}
                id={`header-panel-${index}`}
                aria-hidden={active !== index}
                ref={(el) => {
                  panelRefs.current[index] = el;
                }}
                className={cn(
                  "absolute inset-x-0 top-0 transition-opacity duration-300 motion-reduce:transition-none",
                  active === index ? "opacity-100" : "pointer-events-none opacity-0",
                )}
              >
                <div className="mx-auto max-w-6xl px-6">
                  <div className="flex gap-x-16 pt-7 pb-10">
                    {item.sections.map((section) => (
                      <div key={section.title}>
                        <span className="block font-medium text-[10px] text-muted-foreground uppercase leading-none tracking-wider">
                          {section.title}
                        </span>
                        <ul className="mt-5 flex flex-col gap-y-5">
                          {section.items.map((link) => (
                            <li key={link.href}>
                              <PanelLink
                                link={link}
                                // Unreachable by keyboard while the panel is
                                // closed, which is the half of `aria-hidden`
                                // that people forget.
                                tabIndex={active === index ? 0 : -1}
                                onNavigate={() => setActive(null)}
                              />
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null,
          )}
        </div>
      </div>
    </nav>
  );
}

function PanelLink({
  link,
  tabIndex,
  onNavigate,
}: {
  link: { label: string; href: string; description: string; external?: boolean };
  tabIndex: number;
  onNavigate: () => void;
}) {
  const content = (
    <>
      <span className="font-medium text-sm leading-none transition-colors group-hover:text-primary">
        {link.label}
        {link.external ? (
          <span aria-hidden="true" className="ml-1 text-muted-foreground">
            ↗
          </span>
        ) : null}
      </span>
      <span className="text-muted-foreground text-xs leading-snug">{link.description}</span>
    </>
  );

  const className = "group grid min-w-60 max-w-72 gap-y-1.5";

  if (link.external) {
    return (
      <a
        href={link.href}
        tabIndex={tabIndex}
        onClick={onNavigate}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {content}
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    );
  }

  return (
    <Link
      // biome-ignore lint/suspicious/noExplicitAny: a data-driven nav cannot name every route.
      to={link.href as any}
      tabIndex={tabIndex}
      onClick={onNavigate}
      className={className}
    >
      {content}
    </Link>
  );
}
