/**
 * The shell almost every screen renders inside.
 *
 * Built on the shadcn Sidebar, in its `collapsible="icon"` mode: expanded it is
 * a labelled tree of nine sections, collapsed it is an icon rail. That covers
 * both audiences from one component — an office user wants the labels, and a
 * shop-floor panel at 1024×768 cannot spare a quarter of its width for them.
 * The choice is persisted by the component's own cookie, so a roaster's
 * terminal stays collapsed and an office machine stays expanded.
 *
 * Sub-navigation is a `SidebarMenuSub` under the active section rather than a
 * second panel: forty links flattened into one list makes the important ones as
 * hard to find as the rare ones.
 */

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  readTheme,
  Separator,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  setTheme,
  type Theme,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useEntitlements,
} from "@roastery/ui";
import { Link, useLocation } from "@tanstack/react-router";
import { Building2, ChevronsUpDown, Lock, MapPin, Monitor, Moon, Sun } from "lucide-react";
import * as React from "react";
import { BrandMark } from "@/components/brand-mark";
import { NAV, sectionForPath } from "@/lib/nav";
import { useWorkspace } from "@/lib/workspace";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={300}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <TopBar />
          <main className="min-w-0 flex-1 overflow-auto px-6 py-5">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

function AppSidebar() {
  const location = useLocation();
  const active = sectionForPath(location.pathname);
  const { can } = useWorkspace();
  const entitlements = useEntitlements();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link to="/">
                <BrandMark showText={false} />
                {/* Hidden outright when collapsed. Left to `truncate` alone it
                    renders a clipped "R" beside the mark, which reads as a
                    rendering fault rather than a deliberate icon rail. */}
                <span className="font-semibold tracking-[0.06em] group-data-[collapsible=icon]:hidden">
                  ROASTERY
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((section) => {
                const Icon = section.icon;
                const isActive = active?.id === section.id;
                // Locked, not hidden. A customer who cannot see a module will
                // never buy it, and a nav that changes shape between plans
                // cannot be walked through over the phone.
                const locked = entitlements
                  ? entitlements.modules[section.module] === false
                  : false;
                const children = section.children.filter(
                  (child) => !child.permission || can(child.permission),
                );

                return (
                  <SidebarMenuItem key={section.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={locked ? `${section.label} — not in your plan` : section.label}
                    >
                      <Link to={section.to}>
                        <Icon aria-hidden="true" />
                        <span>{section.label}</span>
                        {locked ? (
                          <Lock className="ml-auto size-3 opacity-60" aria-hidden="true" />
                        ) : null}
                      </Link>
                    </SidebarMenuButton>

                    {/* Only the ACTIVE section expands. Showing every
                        subsection at once is the flat forty-link list this
                        structure exists to avoid. */}
                    {isActive && children.length > 0 ? (
                      <SidebarMenuSub>
                        {children.map((child) => (
                          <SidebarMenuSubItem key={child.to}>
                            <SidebarMenuSubButton
                              asChild
                              isActive={
                                child.to === section.to
                                  ? location.pathname === child.to
                                  : location.pathname.startsWith(child.to)
                              }
                            >
                              <Link to={child.to}>{child.label}</Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    ) : null}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <ThemeMenuButton />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      {/* The drag handle that widens or collapses the rail. */}
      <SidebarRail />
    </Sidebar>
  );
}

function TopBar() {
  const { org, session, locations, locationId, setOrg, setLocation } = useWorkspace();

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-border border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-4" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5">
            <Building2 className="size-3.5" aria-hidden="true" />
            <span className="max-w-40 truncate">{org?.orgName ?? "Select organization"}</span>
            <ChevronsUpDown className="size-3 opacity-50" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Organizations</DropdownMenuLabel>
          {(session?.memberships ?? []).map((membership) => (
            <DropdownMenuItem
              key={membership.orgId}
              onSelect={() => setOrg(membership.orgId)}
              className="justify-between"
            >
              <span className="truncate">{membership.orgName}</span>
              <span className="text-muted-foreground text-xs">{membership.roleSlug}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {locations.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5">
              <MapPin className="size-3.5" aria-hidden="true" />
              <span className="max-w-40 truncate">
                {locations.find((l) => l.id === locationId)?.name ?? "All locations"}
              </span>
              <ChevronsUpDown className="size-3 opacity-50" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onSelect={() => setLocation(null)}>All locations</DropdownMenuItem>
            <DropdownMenuSeparator />
            {locations.map((location) => (
              <DropdownMenuItem key={location.id} onSelect={() => setLocation(location.id)}>
                {location.name}
                <span className="ml-auto text-muted-foreground text-xs">{location.code}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        <span className="hidden text-muted-foreground text-xs sm:inline">
          {session?.user?.email}
        </span>
      </div>
    </header>
  );
}

function ThemeMenuButton() {
  const [theme, setThemeState] = React.useState<Theme>("system");
  React.useEffect(() => setThemeState(readTheme()), []);

  const cycle = () => {
    const next: Theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setThemeState(next);
    setTheme(next);
  };

  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <SidebarMenuButton onClick={cycle}>
          <Icon aria-hidden="true" />
          <span>Theme: {theme}</span>
        </SidebarMenuButton>
      </TooltipTrigger>
      <TooltipContent side="right">Switch theme</TooltipContent>
    </Tooltip>
  );
}
