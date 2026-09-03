/**
 * The design system's public surface.
 *
 * Consumed as SOURCE by every app — there is no build step and no dist. Each
 * app's own Vite config compiles it, which is what keeps React context
 * singletons (router, query, auth) resolving to one instance.
 */

// Roastery components
export * from "./components/data-table";
export * from "./components/empty-state";
export * from "./components/entitlement-gate";
export * from "./components/page-header";
export * from "./components/status-badge";
// Hooks
export * from "./hooks/use-chart-tokens";
export { useIsMobile } from "./hooks/use-mobile";
// Clients and utilities
export * from "./lib/api";
export * from "./lib/auth-client";
export * from "./lib/color";
export * from "./lib/query";
export * from "./lib/query-cache";
export * from "./lib/table-search";
export * from "./lib/theme";
export { cn } from "./lib/utils";
// shadcn/ui primitives
export * from "./ui/alert";
export * from "./ui/avatar";
export * from "./ui/badge";
export * from "./ui/breadcrumb";
export * from "./ui/button";
export * from "./ui/card";
export * from "./ui/checkbox";
export * from "./ui/command";
export * from "./ui/dialog";
export * from "./ui/dropdown-menu";
export * from "./ui/input";
export * from "./ui/label";
export * from "./ui/popover";
export * from "./ui/select";
export * from "./ui/separator";
export * from "./ui/sheet";
export * from "./ui/sidebar";
export * from "./ui/skeleton";
export * from "./ui/sonner";
export * from "./ui/switch";
export * from "./ui/table";
export * from "./ui/tabs";
export * from "./ui/textarea";
export * from "./ui/tooltip";
