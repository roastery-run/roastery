/**
 * The header navigation, as data.
 *
 * Solution entries are derived from the solutions registry rather than
 * restated, so a page cannot exist without appearing in the menu or appear in
 * the menu without existing.
 */
import { SOLUTIONS } from "./solutions";

export type MenuLink = { label: string; href: string; description: string; external?: boolean };
export type MenuSection = { title: string; items: MenuLink[] };
export type HeaderNavItem = { label: string; href?: string; sections?: MenuSection[] };

const DOCS_URL = import.meta.env?.VITE_DOCS_URL ?? "http://localhost:4321";
const API_URL = import.meta.env?.VITE_API_URL ?? "http://localhost:8787";

const solutionLink = (slug: string): MenuLink => {
  const page = SOLUTIONS.find((s) => s.slug === slug);
  if (!page) throw new Error(`Unknown solution: ${slug}`);
  return { label: page.label, href: `/solutions/${page.slug}`, description: page.summary };
};

export const HEADER_NAV: HeaderNavItem[] = [
  {
    label: "Solutions",
    sections: [
      {
        // Grouped by where the coffee is in its life, which is how a roaster
        // thinks about their week — not by which team built the feature.
        title: "Before it is roasted",
        items: [
          solutionLink("green-contracts-and-costs"),
          solutionLink("coffee-inventory-management"),
          solutionLink("sample-management"),
        ],
      },
      {
        title: "Production",
        items: [solutionLink("roasting-and-qc"), solutionLink("resource-planning")],
      },
      {
        title: "After it leaves",
        items: [solutionLink("order-fulfillment"), solutionLink("cafe-intelligence")],
      },
    ],
  },
  {
    label: "Developers",
    sections: [
      {
        title: "Build on it",
        items: [
          {
            label: "API reference",
            href: DOCS_URL,
            description: "Every operation, generated from the API's own schema",
            external: true,
          },
          {
            label: "Webhooks",
            href: `${DOCS_URL}/guides/webhooks/`,
            description: "Signature verification, retries, and ordering guarantees",
            external: true,
          },
          {
            label: "Machine telemetry",
            href: `${DOCS_URL}/guides/telemetry/`,
            description: "Streaming roast curves and shots from shop-floor hardware",
            external: true,
          },
        ],
      },
      {
        title: "Try it",
        items: [
          {
            label: "Interactive explorer",
            href: `${API_URL}/docs`,
            description: "Call any operation against a live API from the browser",
            external: true,
          },
          {
            label: "OpenAPI document",
            href: `${API_URL}/openapi.public.json`,
            description: "Generate a client in your own language",
            external: true,
          },
        ],
      },
    ],
  },
  { label: "Pricing", href: "/pricing" },
];
