# Product

## Register

product

The default describes `apps/console`, the authenticated product and the largest
surface by far. `apps/web` is a genuine brand surface (the seven solution pages,
pricing, and the `/trace/$code` QR target) and design work aimed at it should be
run in the **brand** register instead. `apps/docs` follows the product register.

## Users

Four people, one system, and the console has to be legible to all of them
without training. Small roasteries collapse all four into one person.

- **The roaster, at the machine.** Standing, one hand free, sometimes gloved,
  under overhead lighting, watching a curve that updates every second. Reads at
  a glance and at distance. This is why `FocusShell` sets 44px targets, why
  numerals are tabular everywhere, and why live data animates opacity and never
  position: a number that slides is a number you cannot read while you are
  holding a trier.
- **The production or operations manager, at a desk.** Seated, keyboard-driven,
  planning roast days against an order book, reconciling inventory, reading
  reports. Wants density, many rows, many columns, and no scrolling to find the
  three figures that matter.
- **The owner-operator wearing every hat.** Buying, roasting, cupping and
  invoicing in one afternoon. Enters each area cold and needs it to explain
  itself.
- **The green buyer and QC cupper.** Contracts and samples at a desk; scoring
  at a cupping table, often on a tablet, comparing across sessions where the
  scores were entered by different people.

The job: know what coffee you have, what it cost, what it tastes like, and what
you owe someone by Thursday, and be able to prove each answer.

## Product Purpose

ROASTERY is a coffee operations platform: green contracts to inventory to
roasting to QC to production planning to orders to fulfilment to cafés.

What makes it defensible is the coffee-specific data model, green lot to roast
batch to cupping to roasted lot to blend to order to customer, which a generic
ERP cannot express. The interface exists to make that model usable, not to hide
it. Design that erodes the model in favour of something generic is going the
wrong way, and that applies to screens as much as to schemas.

Success is a roastery that stops keeping a second set of books in a
spreadsheet, and an operator who trusts a number on screen enough to act on it
without going to weigh the bags.

## Brand Personality

**Precise, calm, unshowy.**

Instrument-like. The console states facts and gets out of the way. The ember
accent is scarce and always means something: the primary action, the current
selection, live state. An accent that appears everywhere accents nothing.

Voice in the interface is plain and specific. Labels name the thing
(`Green weight`, not `Qty`); buttons name the consequence (`Allocate to order`,
not `Confirm`); errors say what happened and what to do next. The product knows
coffee and shows it by using the right noun, not by talking about expertise.

Warmth comes from the ground being paper rather than white, from the language,
and from the domain being taken seriously. It never comes from decoration.

## Anti-references

- **The generic SaaS dashboard.** Cool blue-grey neutrals, a row of hero-metric
  cards, gradient accents, an icon-and-heading card grid standing in for the
  table the user actually wanted. Kiln's warm ground at hue 75 is a deliberate
  reaction to this; do not undo it.
- **Legacy ERP.** SAP and NetSuite: a hundred grey fields with no hierarchy and
  no indication which three matter, cryptic codes, help text that restates the
  label. This is the thing ROASTERY is sold against, so resembling it is worse
  than merely being ugly.
- **Consumer coffee aesthetic.** Kraft paper textures, hand-lettered script,
  latte-art photography, third-wave café branding. This is back-of-house
  software. The retail bag is a different design problem, and the only place
  that audience appears is `/trace/$code`.
- **AI-startup chrome.** Glassmorphism, gradient text, purple-to-blue
  everything, animated grid backgrounds, an assistant panel bolted onto every
  screen.

## Design Principles

1. **Show the arithmetic, not just the answer.** A ledger is what separates
   this from a spreadsheet, so the interface has to expose it: every balance
   can be opened into the entries that produced it. A figure the user cannot
   trace is a figure they will go and re-weigh.

2. **Earned familiarity.** Standard affordances for standard tasks. The same
   button shape, the same form vocabulary, the same icon style on every screen.
   Strangeness without purpose is this register's failure mode; the tool should
   disappear into the task.

3. **Say the coffee-specific thing.** Where the domain has an opinion, the
   screen carries it: bags are not a mass unit, FEFO not FIFO, decaf roasts
   last, cupping aggregates on MAD not standard deviation. These are the
   product's argument, and they belong in the interface rather than only in the
   docs.

4. **Partial success is reported as partial.** A half-allocated order, a
   short-received shipment or a schedule that covers less than was ordered must
   look different from success. Anything that returns looking fine while being
   incomplete is a bug in the design, not just the code.

5. **Designed to be read standing up.** Glanceable at distance, operable with
   one hand, survivable in greyscale on a printout. Status is never carried by
   colour alone; if a screen only works seated at full attention, it is wrong
   for at least one of the four users.

## Accessibility & Inclusion

**WCAG 2.2 AA, enforced by tests rather than asserted in comments.**

- `packages/ui/src/lib/tokens.test.ts` parses `styles.css` and checks every
  foreground/background pair, plus lightness separation between chart series.
  A comment claiming "AA verified" rots the moment someone nudges a token.
- Visible focus is not optional: the roast screen and the cupping scoresheet
  are both keyboard-driven on shop-floor panels.
- Reduced motion has a real alternative everywhere, and `live-pulse` stops
  entirely.
- Minimum 44px touch targets inside `FocusShell`, for one-handed and gloved
  use.
- Status is never colour-only. `StatusBadge` carries a shape glyph and the
  pricing table pairs every tick with a visually-hidden sentence, because these
  screens get printed and forwarded.
- Menus are disclosures, not menubars. No `role="menu"` without roving focus
  and typeahead actually implemented.
