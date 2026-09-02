/**
 * The seven solution pages, as data.
 *
 * One typed content module and one renderer, not seven bespoke pages. The
 * failure mode of a marketing site is that each page drifts — different
 * section order, different heading levels, a proof point on one page that
 * contradicts another — and it drifts because each page is its own component.
 *
 * The Worker reads this same registry for `<title>`, meta description, JSON-LD
 * and the sitemap, so a page cannot exist without being indexable or be
 * indexed without existing.
 */
import type { ModuleKey } from "@roastery/schemas";

export type SolutionSection = {
  heading: string;
  body: string;
  /** Concrete, checkable claims. Never adjectives. */
  points?: string[];
};

export type SolutionPage = {
  slug: string;
  /** The nav label. Short. */
  label: string;
  /** The <h1>. States what the reader gets, not what we built. */
  title: string;
  /** The meta description and the sub-headline. Under 160 characters. */
  summary: string;
  module: ModuleKey;
  /** The problem, in the reader's own words, before any solution. */
  problem: string;
  sections: SolutionSection[];
  /** What an integrator can call. This is the credibility artifact. */
  apiNamespace: string;
};

export const SOLUTIONS: SolutionPage[] = [
  {
    slug: "coffee-inventory-management",
    label: "Coffee Inventory",
    title: "Know exactly what coffee you have, and where",
    summary:
      "An append-only ledger behind every weight, so a stock figure is auditable rather than merely plausible.",
    module: "inventory",
    problem:
      "Most roasteries run inventory in a spreadsheet that says 4,200 kg and a warehouse that has 3,940. Nobody can say when they diverged, because a spreadsheet records the answer and not the arithmetic.",
    sections: [
      {
        heading: "Every gram has a reason",
        body: "Nothing changes a weight except a ledger entry. Receipts, splits, transfers, roast consumption and recounts are all rows, in order, each carrying the balance it produced.",
        points: [
          "One write path, so no screen can adjust stock without an entry",
          "A per-lot sequence number makes concurrent writes safe by construction",
          "Nightly reconciliation ALERTS on drift rather than silently correcting it — silent correction hides the bug that caused it",
        ],
      },
      {
        heading: "Bags are not a mass unit",
        body: "A Colombian bag is 69 kg and a Brazilian one is 60. The factor lives on the lot, so 275 bags is 18,975 kg or 16,500 kg depending on which lot it is — and never an average of the two.",
        points: [
          "Weights are exact decimals, not floats: SUM() is the audit",
          "Your entered value and unit are stored alongside the canonical kilograms",
          "Locations track their own balances within a lot",
        ],
      },
      {
        heading: "Reserved is not the same as gone",
        body: "Allocating coffee to an order records a claim; the weight leaves inventory at fulfilment. That distinction is what stops the same kilogram being promised twice while keeping the physical count honest.",
      },
    ],
    apiNamespace: "inventory.green",
  },
  {
    slug: "resource-planning",
    label: "Resource Planning",
    title: "Turn an order book into a roast day",
    summary:
      "Demand merged by what would be roasted together, sized to your drums, and sequenced so the day actually runs.",
    module: "resource_planning",
    problem:
      "Twelve customers ordering the house blend is one roast, not twelve — but only if something merges them. Most planning happens on a whiteboard, and the whiteboard does not know which drum is free.",
    sections: [
      {
        heading: "Merged, sized, sequenced",
        body: "Confirmed orders, less what stock already covers, become batches your machines can run — in an order that reflects how a roastery actually works.",
        points: [
          "Light before dark, because a dark roast leaves residue the next batch picks up",
          "Decaf last regardless of how light it is: decaf sheds more chaff and scorches sooner",
          "Each requirement is spread across drums rather than queued behind one",
        ],
      },
      {
        heading: "A plan that admits what it cannot do",
        body: "When the day's capacity will not cover the book, the schedule says so — with the kilograms unplanned, on the plan itself. A schedule that quietly covers less than was ordered is worse than no schedule.",
      },
      {
        heading: "Released by a person",
        body: "Generation produces a draft. Somebody reads the feasibility notes before a day's work is committed to it, and releasing twice is a conflict rather than a second release.",
      },
    ],
    apiNamespace: "production.schedule",
  },
  {
    slug: "roasting-and-qc",
    label: "Roasting & QC",
    title: "Every roast, recorded at one sample a second",
    summary:
      "Live curves from any bridge, cupping panels that report the spread as well as the mean, and gradings that actually quarantine a lot.",
    module: "roasting",
    problem:
      "A roast log that a Wi-Fi dropout can silently truncate is not a record. Neither is a cupping score of 85 that came from an 80 and a 90.",
    sections: [
      {
        heading: "A roast survives the network",
        body: "Bridges stream to a session that buffers durably. When the uplink drops, the bridge replays from its own ring buffer and the curve comes back byte-identical to one that never dropped.",
        points: [
          "Rate of rise as a least-squares slope, not finite differencing — noise becomes ±6 °C/min of garbage otherwise",
          "First crack is an operator mark, because it is a sound somebody hears",
          "A roaster who walks away from a crashed bridge finds the batch in the log, flagged, not vanished",
        ],
      },
      {
        heading: "Scores with their spread",
        body: "An 85 where every cupper was within half a point is a confident result. The same 85 from an 80 and a 90 is not, and reporting only the mean hides which one you have.",
        points: [
          "Blind protocols with per-cupper scores",
          "Outliers found by median absolute deviation — standard deviation is inflated by the very outlier it should catch",
        ],
      },
      {
        heading: "A failed grading stops the coffee",
        body: "Physical grading quarantines the lot and blocks it from being reserved. Releasing it requires a reason, recorded — a decision someone should have to own.",
      },
    ],
    apiNamespace: "production.roast",
  },
  {
    slug: "order-fulfillment",
    label: "Order Fulfillment",
    title: "Ship the right coffee, in the right order",
    summary:
      "First-expiry-first-out allocation, shortfalls reported as shortfalls, and orders that cannot be double-promised.",
    module: "orders",
    problem:
      "Roasted coffee has a usable window measured in weeks. Shipping whatever was roasted earliest is not the same as shipping what goes stale first, and the difference is what your customer tastes.",
    sections: [
      {
        heading: "FEFO, not FIFO",
        body: "Allocation takes the lot that expires soonest. Once two batches are roasted on different days with different best-before dates, those stop being the same thing.",
      },
      {
        heading: "A partial allocation is not a success",
        body: "When stock cannot cover an order, the response says how much is short. An order that looks allocated and is not is how a warehouse ships short.",
      },
      {
        heading: "Re-importing is a no-op",
        body: "Webstore orders carry your system's own id, unique per channel, so the integration that polls every five minutes cannot create the same order twice.",
      },
    ],
    apiNamespace: "orders",
  },
  {
    slug: "green-contracts-and-costs",
    label: "Green Contracts",
    title: "Know what the coffee actually cost",
    summary:
      "Contracts, positions and milestones, with landed cost derived from what you bought rather than typed in twice.",
    module: "green_contracts",
    problem:
      "Between signing a contract and the coffee arriving, a roastery's money sits in a position nobody can see. And the price on the contract is not the cost of the coffee — freight, duty, financing and shrinkage are.",
    sections: [
      {
        heading: "Positions, before the coffee lands",
        body: "What is committed and not yet received, by contract and by month. The green buyer's daily question, answered without a spreadsheet.",
      },
      {
        heading: "Landed cost that cascades",
        body: "Receiving a shipment creates lots whose cost derives from the contract's own components. Change a freight figure and every affected lot, batch and open-order margin follows.",
        points: [
          "Unit prices carry six decimals, because differentials quote to four",
          "Historical FX is recorded at write time, so a report never re-derives it",
          "Cost is divided by the INITIAL weight, not what is left",
        ],
      },
      {
        heading: "Milestones that email once",
        body: "An overdue fixation or vessel is expensive and only recoverable if noticed. The alert dedupes on rule, subject and day — an alerting system fails by being muted, not by missing one alert.",
      },
    ],
    apiNamespace: "sourcing.contract",
  },
  {
    slug: "cafe-intelligence",
    label: "Café Intelligence",
    title: "See the bar going wrong while it is going wrong",
    summary:
      "Every shot, judged per group head, with a channeling alert in seconds rather than on tomorrow's report.",
    module: "cafe",
    problem:
      "One failing group on a three-group machine is the most common real fault in a café — and a machine-level average hides it behind two groups that are fine.",
    sections: [
      {
        heading: "Judged per group head",
        body: "Three bad shots out of the last five on one group is the equipment, not the barista. Two is a barista having a moment, and alerting on it teaches everyone to ignore alerts.",
        points: [
          "Channeling is distinguished from merely fast — one sends you to the grinder, the other to the basket",
          "A dumped shot is recorded, because waste is a number the manager wants",
          "Consistency is reported beside the average: 28s ±1 and 28s from 20 and 36 are different bars",
        ],
      },
      {
        heading: "A replayed buffer changes nothing",
        body: "Bar bridges dedupe on their own shot id. A reconnect after an outage does not double the day's numbers, which is the quiet failure that makes a café dashboard untrustworthy.",
      },
      {
        heading: "Shots against the till",
        body: "Reconciliation compares what the machines pulled against what the point of sale rang up. A sale with no shot is a till error; a shot with no sale is waste or theft. Merging them would erase the question.",
      },
    ],
    apiNamespace: "cafe",
  },
  {
    slug: "sample-management",
    label: "Sample Management",
    title: "Stop losing track of samples",
    summary:
      "Offers, pre-shipments and arrivals in one place, with the answer to how long you sat on a decision.",
    module: "samples",
    problem:
      "Samples arrive in envelopes and leave in memory. The supplier eventually asks how long you took, and nobody knows.",
    sections: [
      {
        heading: "The whole lifecycle",
        body: "Requested, shipped, received, cupped, approved or rejected — each stamped, so the time from arrival to decision is a number rather than an argument.",
      },
      {
        heading: "A sample becomes a lot",
        body: "Approve a spot sample and turn it into a green lot with its provenance intact, linked back to what was cupped so the lot's quality history reaches the sample it came from.",
      },
    ],
    apiNamespace: "sourcing.sample",
  },
];

export const solutionBySlug = (slug: string): SolutionPage | undefined =>
  SOLUTIONS.find((page) => page.slug === slug);
