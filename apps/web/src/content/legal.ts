/**
 * Privacy and terms, as data.
 *
 * The same shape as `solutions.ts` and for the same reason: one typed module
 * and one renderer, so the footer, the sitemap and the pages cannot disagree
 * about which documents exist. A site that sells to businesses cannot ship
 * without these, and two hand-written pages are how the effective date on one
 * of them silently stops matching the other.
 *
 * THIS COPY IS A STARTING POINT AND NEEDS LEGAL REVIEW. It describes what the
 * system actually does, which is the part engineering can be accurate about:
 * the sub-processors are the ones the Workers and the database really run on,
 * the retention windows are the ones the code implements, and the rights
 * listed are the ones there are operations for. What it is not is advice about
 * which of them apply to a given customer in a given jurisdiction.
 *
 * `updatedAt` is shown on the page and is the thing customers diff. Change it
 * whenever the substance changes, and not when a typo is fixed.
 */

export type LegalSection = {
  heading: string;
  paragraphs: string[];
  /** Rendered as a list under the paragraphs. */
  bullets?: string[];
};

export type LegalPage = {
  slug: "privacy" | "terms";
  label: string;
  title: string;
  summary: string;
  /** ISO date. Shown to the reader as the effective date. */
  updatedAt: string;
  sections: LegalSection[];
};

export const LEGAL: LegalPage[] = [
  {
    slug: "privacy",
    label: "Privacy",
    title: "Privacy policy",
    summary:
      "What ROASTERY stores, why, where it runs, how long it is kept, and how to get it back or have it deleted.",
    updatedAt: "2026-09-05",
    sections: [
      {
        heading: "What this covers",
        paragraphs: [
          "ROASTERY is a coffee operations platform used by roasting businesses. This policy covers the data those businesses put into it, and the small amount we hold about the people who sign in.",
          "A roasting business is the controller of its own operational records — its lots, its customers, its orders. We process that data on its behalf, under the agreement it has with us.",
        ],
      },
      {
        heading: "What we store",
        paragraphs: ["Three kinds of data, held for different reasons."],
        bullets: [
          "Account data: the name and email address of each person who can sign in, and which organization and role they have. Sign-in is passwordless, so we never hold a password.",
          "Operational data: everything the product is for — green coffee contracts, inventory movements, roast profiles and telemetry, cupping scores, orders, and café equipment readings.",
          "Operational logs: request metadata, error traces and delivery attempts, used to run the service and diagnose faults.",
        ],
      },
      {
        heading: "Where it runs",
        paragraphs: [
          "The application runs on Cloudflare Workers. The database is PostgreSQL hosted by Neon, in the United States. Full-fidelity roast curves and generated reports are stored in Cloudflare R2. Transactional email — sign-in links, alert digests — is sent through Cloudflare Email Sending.",
          "These are our sub-processors. We will give notice before adding another that handles customer data.",
        ],
      },
      {
        heading: "How long it is kept",
        paragraphs: [
          "Operational records are kept for as long as the organization's account is open, because they are the business's own history: a traceability certificate has to remain answerable years after the coffee shipped.",
          "Some data expires sooner, by design.",
        ],
        bullets: [
          "Sign-in links expire five minutes after they are sent.",
          "Sessions expire after seven days, and signing out ends one immediately.",
          "Webhook payloads and event records are kept for 90 days, and alert history for 180 days.",
          "Roast telemetry is kept for a year in the database; the full-fidelity curve is retained with the batch.",
          "Audit records of who changed what are kept for the life of the account.",
        ],
      },
      {
        heading: "Your rights",
        paragraphs: [
          "An organization owner can export everything the organization holds, as machine-readable files, from the console. Deleting an organization removes its data after a short grace period, during which the deletion can be reversed by contacting us.",
          "An individual can be removed from an organization by its owner, and can ask us to delete their personal account. Where an account is the last owner of an organization, that organization has to be transferred or deleted first — otherwise its data would be left with nobody able to reach it.",
          "To exercise any of these, use the console or write to privacy@roastery.run.",
        ],
      },
      {
        heading: "Cookies",
        paragraphs: [
          "Two, both functional. A session cookie that keeps you signed in, and a preference cookie that remembers whether you chose the light or dark theme. There is no advertising or cross-site tracking on this site or in the product, which is why there is no cookie banner asking you to accept any.",
        ],
      },
      {
        heading: "Security",
        paragraphs: [
          "Access is scoped to one organization at the application layer, and every operation is checked against an explicit permission. Webhook signing secrets are encrypted with a key held outside the database. Sign-in is passwordless. Changes to membership and credentials are recorded in an audit log the organization can read.",
          "If you believe you have found a vulnerability, write to security@roastery.run.",
        ],
      },
      {
        heading: "Changes",
        paragraphs: [
          "The effective date at the top of this page changes whenever the substance does. For a change that materially affects how customer data is handled, we will tell account owners before it takes effect.",
        ],
      },
    ],
  },
  {
    slug: "terms",
    label: "Terms",
    title: "Terms of service",
    summary:
      "The agreement covering use of ROASTERY: what each side is responsible for, what the service promises, and how it ends.",
    updatedAt: "2026-09-05",
    sections: [
      {
        heading: "The agreement",
        paragraphs: [
          "These terms cover use of ROASTERY by an organization and the people it authorises. Signing in accepts them on behalf of that organization.",
          "ROASTERY is currently in a private beta, offered to invited organizations. Features may change, and we will not remove one an organization depends on without notice.",
        ],
      },
      {
        heading: "Your account",
        paragraphs: [
          "An organization is responsible for who it invites and what permissions it grants them, and for the API keys and machine credentials it issues. A credential acts for the organization until it is revoked, and revocation takes effect immediately.",
          "Sign-in links and API keys should be treated as passwords. Tell us promptly if one is exposed.",
        ],
      },
      {
        heading: "Your data",
        paragraphs: [
          "The organization owns the operational data it puts into ROASTERY. We do not sell it, and we do not use one customer's data to serve another.",
          "We use it to run the service: to answer requests, to send the alerts and webhooks that were configured, to render reports that were asked for, and to diagnose faults.",
        ],
      },
      {
        heading: "Availability",
        paragraphs: [
          "We aim for continuous availability and do not promise it during the beta. Planned maintenance that requires downtime will be announced beforehand.",
          "The traceability page linked from retail bags is served from cache, so it keeps answering during an outage of the rest of the system.",
        ],
      },
      {
        heading: "Acceptable use",
        paragraphs: ["Do not use ROASTERY to do the following."],
        bullets: [
          "Break the law, or infringe somebody else's rights.",
          "Attempt to reach another organization's data.",
          "Probe or load-test the service without asking us first — we will usually say yes.",
          "Point a webhook at a destination you do not control.",
        ],
      },
      {
        heading: "Fees",
        paragraphs: [
          "Plans and their limits are described on the pricing page. Where a subscription lapses, access to plan features stops, but the organization keeps access to its account so it can settle up or export its data.",
        ],
      },
      {
        heading: "Ending it",
        paragraphs: [
          "An organization can stop using ROASTERY at any time and export its data on the way out. We may suspend an account for non-payment or for acceptable-use breaches, and will say why.",
          "After an account is deleted, its data is removed following the grace period described in the privacy policy.",
        ],
      },
      {
        heading: "Liability",
        paragraphs: [
          "ROASTERY is a system of record, not a substitute for a business's own controls. Food-safety, tax and customs obligations remain the organization's. We provide the service as described and, to the extent the law allows, our liability is limited to the fees paid in the twelve months before a claim.",
        ],
      },
      {
        heading: "Contact",
        paragraphs: ["Questions about these terms go to legal@roastery.run."],
      },
    ],
  },
];

export const legalBySlug = (slug: string): LegalPage | undefined =>
  LEGAL.find((page) => page.slug === slug);
