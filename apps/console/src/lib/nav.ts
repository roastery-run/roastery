/**
 * The navigation tree, as data.
 *
 * One array drives the icon rail, the context panel, the command palette and
 * the breadcrumbs. Duplicating it into four components is how a product ends
 * up with a nav item that exists in the sidebar and nowhere else.
 *
 * `module` is the entitlement key. A locked destination stays VISIBLE and
 * locked rather than hidden — a customer who cannot see Sample Management will
 * never buy it, and a nav that changes shape between plans cannot be walked
 * through over the phone.
 */
import type { ModuleKey } from "@roastery/schemas";
import {
  Beaker,
  Coffee,
  FileText,
  FlaskConical,
  LayoutDashboard,
  type LucideIcon,
  Package,
  Settings,
  ShoppingCart,
  Store,
} from "lucide-react";

export type NavChild = {
  label: string;
  to: string;
  /** Permission slug. Absent means every role that can see the section. */
  permission?: string;
  description?: string;
};

export type NavSection = {
  id: string;
  label: string;
  icon: LucideIcon;
  to: string;
  module: ModuleKey;
  children: NavChild[];
};

export const NAV: NavSection[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    to: "/",
    module: "core",
    children: [],
  },
  {
    id: "contracts",
    label: "Green Contracts",
    icon: FileText,
    to: "/contracts",
    module: "green_contracts",
    children: [
      { label: "Contracts", to: "/contracts", permission: "sourcing.contract.read" },
      { label: "Open positions", to: "/contracts/positions", permission: "sourcing.contract.read" },
      { label: "Shipments", to: "/contracts/shipments", permission: "sourcing.contract.read" },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    icon: Package,
    to: "/inventory",
    module: "inventory",
    children: [
      { label: "Green coffee", to: "/inventory", permission: "inventory.green.read" },
      { label: "Roasted", to: "/inventory/roasted", permission: "inventory.roast.read" },
      { label: "Blends", to: "/inventory/blends", permission: "inventory.blend.read" },
      { label: "Materials", to: "/inventory/materials", permission: "inventory.material.read" },
      { label: "Bills of materials", to: "/inventory/bom", permission: "inventory.material.read" },
      { label: "Landed costs", to: "/inventory/costs", permission: "inventory.green.read" },
    ],
  },
  {
    id: "roasting",
    label: "Roasting & QC",
    icon: FlaskConical,
    to: "/roasting",
    module: "roasting",
    children: [
      { label: "Batches", to: "/roasting", permission: "production.roast.read" },
      { label: "Profiles", to: "/roasting/profiles", permission: "production.profile.read" },
      { label: "Schedule", to: "/roasting/schedule", permission: "production.schedule.read" },
      { label: "Machines", to: "/roasting/machines", permission: "catalog.machine.read" },
    ],
  },
  {
    id: "quality",
    label: "Quality",
    icon: Beaker,
    to: "/quality",
    module: "quality",
    children: [
      { label: "Cupping sessions", to: "/quality", permission: "quality.cupping.read" },
      { label: "Gradings", to: "/quality/gradings", permission: "quality.grading.read" },
    ],
  },
  {
    id: "orders",
    label: "Orders",
    icon: ShoppingCart,
    to: "/orders",
    module: "orders",
    children: [
      { label: "Orders", to: "/orders", permission: "orders.read" },
      { label: "Customers", to: "/orders/customers", permission: "orders.read" },
    ],
  },
  {
    id: "cafe",
    label: "Café",
    icon: Store,
    to: "/cafe",
    module: "cafe",
    children: [
      { label: "Sites", to: "/cafe", permission: "cafe.read" },
      { label: "Live bar", to: "/cafe/live", permission: "cafe.read" },
      { label: "Reconciliation", to: "/cafe/reconciliation", permission: "cafe.read" },
    ],
  },
  {
    id: "samples",
    label: "Samples",
    icon: Coffee,
    to: "/samples",
    module: "samples",
    children: [{ label: "Samples", to: "/samples", permission: "sourcing.sample.read" }],
  },
  {
    id: "reports",
    label: "Reports",
    icon: FileText,
    to: "/reports",
    module: "core",
    children: [
      { label: "Reports", to: "/reports", permission: "reporting.read" },
      { label: "Traceability", to: "/reports/traceability", permission: "traceability.read" },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    to: "/settings",
    module: "core",
    children: [
      { label: "Organization", to: "/settings", permission: "console.members.read" },
      { label: "Members & roles", to: "/settings/members", permission: "console.members.read" },
      { label: "API keys", to: "/settings/api-keys", permission: "console.credentials.read" },
      { label: "Webhooks", to: "/settings/webhooks", permission: "webhooks.read" },
      { label: "Locations", to: "/settings/locations", permission: "catalog.location.read" },
      { label: "Products", to: "/settings/products", permission: "catalog.product.read" },
      { label: "Partners", to: "/settings/partners", permission: "catalog.party.read" },
    ],
  },
];

/** The section a path belongs to, for highlighting the rail. */
export function sectionForPath(pathname: string): NavSection | undefined {
  if (pathname === "/") return NAV[0];
  return NAV.slice(1)
    .filter((section) => pathname.startsWith(section.to))
    .sort((a, b) => b.to.length - a.to.length)[0];
}
