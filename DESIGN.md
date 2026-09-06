---
name: ROASTERY (Kiln)
description: The instrument panel for a coffee roastery. Warm paper ground, one ember light, exact numbers.
colors:
  ember: "oklch(0.545 0.163 45)"
  ember-dark: "oklch(0.68 0.15 45)"
  warm-paper: "oklch(0.986 0.003 75)"
  surface: "oklch(1 0 0)"
  rail: "oklch(0.972 0.004 75)"
  ink: "oklch(0.212 0.006 75)"
  muted-ink: "oklch(0.487 0.008 75)"
  hairline: "oklch(0.906 0.005 75)"
  verdigris: "oklch(0.47 0.115 150)"
  amber-dark: "oklch(0.545 0.115 75)"
  slate-blue: "oklch(0.5 0.11 245)"
  scorch: "oklch(0.512 0.18 27)"
  night-paper: "oklch(0.175 0.006 75)"
  night-ink: "oklch(0.945 0.004 75)"
typography:
  display:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "clamp(2rem, 4.5vw, 3.25rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "normal"
  body:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
    fontVariation: "tabular-nums"
  label:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.33
    letterSpacing: "normal"
  figure:
    fontFamily: "Geist Mono Variable, ui-monospace, monospace"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    fontVariation: "tabular-nums"
  micro:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 500
    lineHeight: 1
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
  xl: "0.875rem"
  2xl: "1.125rem"
  3xl: "1.375rem"
  4xl: "1.625rem"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
  2xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.ember}"
    textColor: "{colors.warm-paper}"
    typography: "{typography.label}"
    rounded: "{rounded.4xl}"
    padding: "0 0.75rem"
    height: "2.25rem"
  button-primary-hover:
    backgroundColor: "oklch(0.545 0.163 45 / 0.8)"
    textColor: "{colors.warm-paper}"
  button-outline:
    backgroundColor: "oklch(0.906 0.005 75 / 0.3)"
    textColor: "{colors.ink}"
    rounded: "{rounded.4xl}"
    padding: "0 0.75rem"
    height: "2.25rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.4xl}"
    padding: "0 0.75rem"
    height: "2.25rem"
  button-destructive:
    backgroundColor: "oklch(0.512 0.18 27 / 0.1)"
    textColor: "{colors.scorch}"
    rounded: "{rounded.4xl}"
    padding: "0 0.75rem"
    height: "2.25rem"
  input-default:
    backgroundColor: "oklch(0.906 0.005 75 / 0.3)"
    textColor: "{colors.ink}"
    rounded: "{rounded.4xl}"
    padding: "0.25rem 0.75rem"
    height: "2.25rem"
  status-badge-success:
    backgroundColor: "oklch(0.47 0.115 150 / 0.12)"
    textColor: "{colors.verdigris}"
    typography: "{typography.label}"
    rounded: "{rounded.4xl}"
    padding: "0.125rem 0.5rem"
    height: "1.25rem"
  status-badge-danger:
    backgroundColor: "oklch(0.512 0.18 27 / 0.1)"
    textColor: "{colors.scorch}"
    typography: "{typography.label}"
    rounded: "{rounded.4xl}"
    padding: "0.125rem 0.5rem"
    height: "1.25rem"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.2xl}"
    padding: "1.5rem"
  card-sm:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.2xl}"
    padding: "1rem"
  metric-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.figure}"
    rounded: "{rounded.2xl}"
    padding: "1rem"
  sidebar-rail:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.ink}"
---

# Design System: ROASTERY (Kiln)

## 1. Overview

**Creative North Star: "The Instrument Panel"**

Kiln is read the way a gauge is read: from two metres away, in a hurry, by
someone holding a trier. Every decision in it answers to that. Numerals are
tabular everywhere rather than only in tables somebody remembered to mark up,
because operators compare columns of temperatures and weights by eye all day
and proportional digits make that impossible. Live data animates opacity and
never position, because a number that slides is a number you cannot read.
Surfaces are flat and separated by hairlines rather than shadows, because a
dashboard of lifted cards is a dashboard where nothing is more important than
anything else.

The ground is warm paper at hue 75, not white and not the cool blue-grey of a
stock neutral palette. Two reasons: a full-white ground under a dense table
glares under the overhead lighting of a production floor, and cold grey reads
as generic software when this is software people use standing next to a
roaster. The warmth is a whisper (chroma 0.003 to 0.008), carried by hue rather
than saturation. It is not a cream, a parchment or a texture.

There is exactly one accent. Ember `oklch(0.545 0.163 45)` marks the primary
action, the current selection and live state, and appears nowhere else. Status
gets its own four-colour vocabulary because an operations product cannot
express "shipped", "due soon" and "quarantined" with one destructive colour,
but those are semantic, not decorative. Kiln explicitly rejects the generic
SaaS dashboard (hero-metric cards, gradient accents, an icon-and-heading grid
where a table belongs), legacy ERP (a hundred grey fields with no hierarchy),
the consumer coffee aesthetic (kraft paper, script lettering, latte art) and
AI-startup chrome (glassmorphism, gradient text, animated grids).

**Key Characteristics:**

- Warm neutral ground, hue 70 to 80, chroma at or below 0.008
- One ember accent, reserved for primary action, selection and live state
- Flat by default: hairline rules and tonal layering, zero box-shadows
- Pill-shaped controls (`rounded-4xl`, 1.625rem) on flat, hairline surfaces
- Tabular numerals globally, monospace for figures being compared
- Contrast proven by `packages/ui/src/lib/tokens.test.ts`, never by a comment
- Status carries a shape glyph as well as a colour, always

## 2. Colors

A near-neutral warm ground with a single saturated heat source, plus a
four-tone semantic set that exists because operations states are not binary.

### Primary

- **Ember** (`oklch(0.545 0.163 45)`, dark `oklch(0.68 0.15 45)`): the primary
  button, the focus ring, the current sidebar item, the first chart series, and
  live state on the roast screen. Nothing decorative is ever ember.

### Secondary

- **Ember Wash** (`oklch(0.955 0.012 60)`, dark `oklch(0.268 0.02 45)`): the
  `--accent` surface for hover and highlight rows. It reads as heat at very low
  chroma, so a hovered row does not compete with an actual ember control.

### Tertiary

The semantic status set. Each is a meaning, not a mood. Every one of these is
paired with a shape glyph in `StatusBadge`, never used alone.

- **Verdigris** (`oklch(0.47 0.115 150)`): available, completed, fulfilled,
  passed, in spec.
- **Amber Dark** (`oklch(0.545 0.115 75)`): partially fulfilled, due soon,
  pending, out of dose. Deliberately darker than a comfortable yellow, because
  yellow-on-white is the most common AA failure in operations dashboards and a
  warning nobody can read is not a warning.
- **Slate Blue** (`oklch(0.5 0.11 245)`): reserved, in transit, confirmed. The
  "claimed but not gone" family.
- **Scorch** (`oklch(0.512 0.18 27)`): quarantined, aborted, failed, dead. Used
  at 10 to 12 percent opacity as a fill with the full-strength colour as text,
  never as a solid red block.

### Neutral

- **Warm Paper** (`oklch(0.986 0.003 75)`): the body ground. Not white.
- **Surface** (`oklch(1 0 0)`): cards and popovers, which sit one step brighter
  than the page so layering reads without a shadow.
- **Rail** (`oklch(0.972 0.004 75)`): the sidebar, one step darker than the
  page. The second neutral layer that separates chrome from content.
- **Ink** (`oklch(0.212 0.006 75)`): body text. Clears 7:1 against the ground,
  which is AAA, because this is text read for hours at a stretch.
- **Muted Ink** (`oklch(0.487 0.008 75)`): labels, descriptions, secondary
  figures. Still clears 4.5:1 against the ground; the test enforces it.
- **Hairline** (`oklch(0.906 0.005 75)`): every border and divider. Also the
  input fill at 30 percent opacity.
- **Night Paper / Night Ink** (`oklch(0.175 0.006 75)` /
  `oklch(0.945 0.004 75)`): the dark theme keeps the same hue. Dark mode here
  is a shop-floor and evening requirement, not a style, so it is a genuine
  second palette with its own tested pairs, not an inversion.

### Named Rules

**The One Ember Rule.** The primary accent carries the primary action, the
current selection and live state. Nothing else. An accent that appears
everywhere accents nothing, and on a screen where "live" means a roast is
actually running, a decorative ember is a lie.

**The Glyph Rule.** Colour is never the only signal. Every status carries a
distinct leading glyph (`○ ● ▲ ■ ◆ ◉`), every delta carries an arrow, every
chart series varies dash pattern as well as hue. QC reports get printed in
greyscale, roughly 8 percent of male readers cannot separate the red from the
green, and an operator two metres from a panel is reading shape before hue.

**The Tested Palette Rule.** `tokens.test.ts` parses `styles.css` and asserts
every foreground and background pair, plus at least 0.04 lightness separation
between consecutive chart series, in both themes. Do not add a colour token
without adding its assertion. A comment claiming "AA verified" rots the moment
someone nudges a token.

## 3. Typography

**Display Font:** Inter Variable (fallback `sans-serif`)
**Body Font:** Inter Variable (the same family; this system is single-family by
intent)
**Label/Mono Font:** Geist Mono Variable (fallback `ui-monospace, monospace`)

**Character:** One well-tuned humanist sans doing every job, with a monospace
reserved strictly for figures. A display face would be decoration on a screen
whose content is 1,787.5000 kg. The contrast in this system comes from weight,
size and the sans-to-mono switch, never from a third family.

### Hierarchy

- **Display** (600, `clamp(2rem, 4.5vw, 3.25rem)`, 1.05, tracking -0.025em):
  the marketing hero only. The console has no fluid type; a clamp-sized heading
  that shrinks inside a sidebar looks worse, not better.
- **Headline** (600, 1.25rem, tracking -0.025em): the `PageHeader` h1. Every
  console screen opens with exactly one, and it is always a real `h1`, because
  a page whose title is a styled div is a page a screen-reader user cannot
  navigate to.
- **Title** (500, 1rem): card titles, section headings, dialog titles.
- **Body** (400, 0.875rem, tabular numerals): table cells, descriptions, form
  values. Prose is capped at `max-w-prose`; tables run as wide as they need to.
- **Label** (500, 0.75rem): field labels, metric captions, badge text, table
  headers.
- **Figure** (Geist Mono, 600, 1.5rem, tabular numerals): the number in a
  `Metric` tile, weights, temperatures, prices, lot codes. Anything a person
  will compare down a column or read back over a phone.
- **Micro** (500, 0.625rem, `text-micro`): the smallest step, and it exists for
  two things only. The shape glyph inside a `StatusBadge`, which has to read as
  a marker rather than as a character beside its label, and a micro-badge
  crammed into a dense schedule row. It is a real step rather than three
  scattered arbitrary literals, which is how a ramp quietly stops being one.

### Named Rules

**The Tabular Rule.** `font-variant-numeric: tabular-nums` is set on `body`,
not on the components someone remembered. Digits must align down a column
everywhere, including in a badge, a tooltip and a chart axis.

**The Mono Means Machine Rule.** Geist Mono marks a value that came from or
goes back to the system: a weight, a temperature, a lot code, an API
namespace, a timestamp. It is never used for prose, headings or button labels.
If mono is being used for texture, it is being used wrong.

**The No Shouting Rule.** Uppercase is permitted only for labels of four words
or fewer. No all-caps sentences, and no tracked uppercase eyebrow above every
section.

**The Named Step Rule.** Every font size is a step on this ramp. An arbitrary
`text-[…]` literal is a decision nobody wrote down, and the third copy of it is
the point at which the ramp has stopped describing the product. If a new size
is genuinely needed, it gets a name here first.

## 4. Elevation

This system has **no box-shadows**. Depth is entirely tonal plus hairline: the
rail sits below the page, the page below the card, and a 1px ring at 10 percent
ink separates a card from what it sits on. A dense operations screen with
lifted cards is a screen where the eye has nothing to prioritise, and shadows
on a warm ground go muddy rather than deep.

Overlays (dialog, popover, sheet, dropdown) separate by surface colour and a
backdrop, not by shadow. Focus is the one thing permitted to appear to sit
above the surface, and it does so with a ring, not a glow.

### Shadow Vocabulary

None. `ring-1 ring-foreground/10` on cards and `border border-border` on
everything else is the entire elevation vocabulary.

### Named Rules

**The Flat Ground Rule.** Surfaces are flat at rest and flat in motion. If a
component needs to feel separated, move it a tonal step (`rail` to `background`
to `card`) or draw a hairline. Never reach for a shadow, and never reach for a
blur.

**The Audit Test.** If a screenshot of a screen looks like it could be from a
2021 SaaS template, the cards have gained shadows and the metrics have gained a
gradient. Both are regressions.

## 5. Components

**Character: quiet until you touch them.** Controls are flat and nearly silent
at rest. The whole state machine lives in the interaction: a hairline that
warms on hover, a 3px focus ring that is impossible to miss, a 1px downward
nudge on press. The shape is soft (everything is a pill) and the information
inside it is not.

### Buttons

- **Shape:** fully pill (`rounded-4xl`, 1.625rem) at every size. On a 36px
  control this only reads as a pill from this radius up; at a squared 0.25rem
  the same components come out as blunt rectangles.
- **Sizes:** xs 24px, sm 32px, default 36px, lg 40px, plus square icon variants
  at each. Inside `FocusShell` (the live roast screen and the cupping
  scoresheet) every interactive element is forced to a 44px minimum, for
  one-handed and gloved use.
- **Primary:** ember fill, paper text, `0 0.75rem` padding. One per screen
  region.
- **Hover / Focus:** primary fades to 80 percent on hover; every variant takes
  `focus-visible:ring-[3px]` in ember at 50 percent with a matching border.
  Active state translates 1px down, except on menu triggers.
- **Outline:** hairline border over a 30 percent hairline fill. The default for
  secondary actions.
- **Ghost:** transparent until hover, when it takes the muted surface. For
  toolbar and row-level actions.
- **Destructive:** never a solid red button. Scorch text on a 10 percent scorch
  fill, so a delete action reads as dangerous without dominating the screen it
  sits on.

### Badges and Status

- **Style:** pill, 20px tall, 12px label text, a 12 percent tint of its own
  semantic colour as fill with the full-strength colour as text.
- **`StatusBadge` is the only way a status reaches the screen.** It maps every
  domain status (`quarantined`, `partially_fulfilled`, `in_spec`, `channeling`,
  ...) to one of six tones in a single table, so "quarantined" is the same red
  on the lot list, the lot detail and a printed report. It prepends the tone's
  glyph. Do not hand-build a coloured pill for a status.

### Cards and Containers

- **Corner Style:** 1.125rem (`rounded-2xl`).
- **`CardTitle` is an `h2`**, not a styled div. A card is a top-level section
  under the page's `h1`, and heading navigation is how a screen-reader user
  skims a dense detail page.
- **Background:** `surface`, one step brighter than the page.
- **Shadow Strategy:** none. `ring-1 ring-foreground/10`.
- **Internal Padding:** 1.5rem default, 1rem at `size="sm"`, driven by a
  `--card-spacing` custom property so header, content and footer stay aligned.
- **Nested cards are prohibited.** A card inside a card means the hierarchy is
  wrong; use a hairline rule or a heading.

### Inputs and Fields

- **Style:** pill (`rounded-4xl`), 36px tall, hairline border over a 30 percent
  hairline fill. 16px text on small screens dropping to 14px at `md`, so iOS
  does not zoom on focus.
- **Focus:** border shifts to ember plus a 3px ember ring at 50 percent.
- **Error:** `aria-invalid` drives the styling, so the visual error state
  cannot drift from the state screen readers are told about.
- **Disabled:** 50 percent opacity, `not-allowed` cursor, pointer events off.

### Navigation

- **The rail.** A shadcn Sidebar in `collapsible="icon"` mode on the `rail`
  neutral: expanded it is a labelled tree of nine sections, collapsed it is an
  icon rail. That covers both audiences from one component, since an office
  user wants the labels and a shop-floor panel at 1024x768 cannot spare a
  quarter of its width for them. The choice persists in a cookie.
- **Sub-navigation** is a `SidebarMenuSub` under the active section. Forty links
  flattened into one list makes the important ones as hard to find as the rare
  ones.
- **Menus are disclosures, not menubars.** No `role="menu"`: that role promises
  arrow-key roving focus and typeahead, and claiming it without implementing it
  is worse for a screen-reader user than plain buttons.

### Signature Components

- **`FocusShell`** (`apps/console/src/components/focus-shell.tsx`): the
  chromeless, high-contrast, 44px-target layout for the live roast screen and
  the cupping scoresheet. Used standing, one-handed, sometimes gloved. Nothing
  in it may require a hover to discover.
- **`Metric`**: a labelled figure in mono at 1.5rem, with an optional delta
  that always carries a direction arrow alongside its colour. Metrics are for
  the top of a dashboard, in a row of three or four. A single giant number with
  a small caption is the hero-metric cliché and is prohibited.
- **`EmptyState` / `ErrorState`**: deliberately separate components with
  different words and different actions. A spinner that resolves into "no
  results" reads as a failure, and an error that looks like an empty list is
  one nobody reports.
- **`live-pulse`**: the only ambient animation in the system. Opacity 1 to 0.55
  over 2s, and off entirely under reduced motion. It means a roast is actually
  running.

## 6. Do's and Don'ts

### Do:

- **Do** keep the warm neutral ground at hue 70 to 80 with chroma at or below
  0.008. It is the single thing that stops this reading as generic software.
- **Do** reserve ember `oklch(0.545 0.163 45)` for the primary action, the
  current selection and live state.
- **Do** pair every status colour with its shape glyph via `StatusBadge`, and
  every delta with a direction arrow.
- **Do** use `rounded-4xl` (1.625rem) on buttons, badges and inputs, and
  `rounded-2xl` (1.125rem) on cards. These are the two shapes in the system.
- **Do** put figures in Geist Mono with tabular numerals whenever a person will
  compare them down a column, and only then. A variety list is prose.
- **Do** state the unit on every weight. `formatWeight` with no unit rescales
  to tonnes above 1,000 kg, which turns one row of a column into a different
  scale from the row above it.
- **Do** add a `tokens.test.ts` assertion with every new colour token.
- **Do** show loading as a skeleton in the shape of the content, and give empty
  and error their own distinct states.
- **Do** keep every interactive element at 44px minimum inside `FocusShell`.
- **Do** provide a real reduced-motion alternative for anything that moves.
- **Do** name buttons with a verb and an object: "Allocate to order", never
  "Confirm".

### Don't:

- **Don't** build a **generic SaaS dashboard**: no hero-metric template (big
  number, small label, supporting stats, gradient accent), no icon-and-heading
  card grid standing in for a table, no cool blue-grey neutrals.
- **Don't** drift toward **legacy ERP**: a hundred grey fields with no
  hierarchy and no indication which three matter. If a form has more than a
  screenful of inputs, it needs sections and a default.
- **Don't** reach for the **consumer coffee aesthetic**: no kraft-paper
  textures, hand-lettered script, or latte-art photography. This is
  back-of-house software.
- **Don't** add **AI-startup chrome**: no glassmorphism, no gradient text
  (`background-clip: text` is banned outright), no purple-to-blue anything, no
  animated grid backgrounds.
- **Don't** add a `box-shadow`. Ever. Tonal steps and hairlines only.
- **Don't** use `border-left` or `border-right` above 1px as a coloured accent
  stripe on cards, rows or callouts.
- **Don't** nest a card inside a card.
- **Don't** animate position, layout or size on live data. Opacity only.
- **Don't** use fluid `clamp()` type in the console. Fixed rem steps at a 1.125
  to 1.2 ratio.
- **Don't** introduce a third font family, and don't use mono for prose.
- **Don't** express a status with colour alone, and don't hand-roll a coloured
  pill instead of using `StatusBadge`.
- **Don't** put a tracked uppercase eyebrow above every section, or number
  sections `01 / 02 / 03` unless the order carries real information.
- **Don't** reach for a modal first. Exhaust inline and progressive
  alternatives; most modals here are laziness.
- **Don't** write "Roastery" anywhere a person reads it. The wordmark is
  **ROASTERY**, uppercase. Machine-facing spellings (`@roastery/*`,
  `X-Roastery-Org`, `roastery.run`) stay as they are.
