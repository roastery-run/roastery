/**
 * The rules a printed label has to satisfy, kept pure so they can be tested
 * without a browser.
 *
 * Everything here answers one question: will this design survive contact with
 * a real bag? A label is the one artifact in the system with no undo — by the
 * time it is wrong you own five thousand of them.
 */

import type { LabelBinding, LabelBlock } from "@roastery/schemas";

/** The certificate snapshot a label renders against. */
export type LabelData = {
  coffee: {
    name: string;
    lotCode: string;
    roastLevel: string | null;
    roastedAt: string | null;
  };
  origins: {
    producer: string | null;
    country: string | null;
    region: string | null;
    altitude: string | null;
    process: string | null;
    varieties: string[];
  }[];
  roast: { batchNumber: string } | null;
  quality: { cuppingScore: string | null; notes: string[] } | null;
};

export const BINDING_LABELS: Record<LabelBinding, string> = {
  "coffee.name": "Coffee name",
  "coffee.lotCode": "Lot code",
  "coffee.roastLevel": "Roast level",
  "coffee.roastedAt": "Roast date",
  "origin.producer": "Producer",
  "origin.country": "Country",
  "origin.region": "Region",
  "origin.altitude": "Altitude",
  "origin.process": "Process",
  "origin.varieties": "Varieties",
  "roast.batchNumber": "Batch number",
  "quality.cuppingScore": "Cupping score",
  "quality.notes": "Tasting notes",
};

/**
 * Only the FIRST origin is rendered. A blend of four origins cannot list four
 * producers on a 60 mm label, and silently truncating to whichever the
 * database returned first would be a different lie on every print run — so a
 * blend is expected to use static text, and the designer says so.
 */
export function resolveBinding(data: LabelData, binding: LabelBinding): string | null {
  const origin = data.origins[0];
  switch (binding) {
    case "coffee.name":
      return data.coffee.name || null;
    case "coffee.lotCode":
      return data.coffee.lotCode || null;
    case "coffee.roastLevel":
      return data.coffee.roastLevel;
    case "coffee.roastedAt":
      return data.coffee.roastedAt ? data.coffee.roastedAt.slice(0, 10) : null;
    case "origin.producer":
      return origin?.producer ?? null;
    case "origin.country":
      return origin?.country ?? null;
    case "origin.region":
      return origin?.region ?? null;
    case "origin.altitude":
      return origin?.altitude ?? null;
    case "origin.process":
      return origin?.process ?? null;
    case "origin.varieties":
      return origin?.varieties.length ? origin.varieties.join(", ") : null;
    case "roast.batchNumber":
      return data.roast?.batchNumber ?? null;
    case "quality.cuppingScore":
      return data.quality?.cuppingScore ?? null;
    case "quality.notes":
      return data.quality?.notes.length ? data.quality.notes.join(" · ") : null;
  }
}

/** Cap height in millimetres. 3.2 mm is roughly 9 pt — a readable bag body. */
export const SIZE_MM: Record<LabelBlock["size"], number> = {
  xs: 2.2,
  sm: 2.6,
  md: 3.2,
  lg: 4.4,
  xl: 6,
};

/**
 * Lines a string needs at a given width. Deliberately an estimate: exact
 * metrics need the font, and the point is to flag "this producer name wraps to
 * four lines" while the design is still editable, not to typeset it.
 */
export function estimateLines(text: string, widthMm: number, fontMm: number): number {
  if (!text) return 0;
  // A proportional sans averages a little over half its cap height per glyph.
  const perLine = Math.max(1, Math.floor(widthMm / (fontMm * 0.55)));
  return text.split(/\s+/).reduce(
    (state, word) => {
      const next = state.column === 0 ? word.length : state.column + 1 + word.length;
      if (next <= perLine) return { lines: state.lines, column: next };
      return { lines: state.lines + 1, column: Math.min(word.length, perLine) };
    },
    { lines: 1, column: 0 },
  ).lines;
}

/**
 * A QR module must be printed large enough for a phone to resolve it. 0.4 mm
 * is the practical floor for a handheld scan at arm's length and 0.5 mm is
 * comfortable; below the floor the code is decoration. The quiet zone is four
 * modules on every side and is part of the code, not the margin around it.
 */
export const QR_MODULE_FLOOR_MM = 0.4;
export const QR_MODULE_COMFORTABLE_MM = 0.5;

export type QrVerdict = { moduleMm: number; verdict: "unscannable" | "tight" | "ok" };

export function qrScannability(moduleCount: number, sizeMm: number): QrVerdict {
  // Four modules of quiet zone each side, so the printed square carries
  // moduleCount + 8 modules across.
  const moduleMm = sizeMm / (moduleCount + 8);
  return {
    moduleMm,
    verdict:
      moduleMm < QR_MODULE_FLOOR_MM
        ? "unscannable"
        : moduleMm < QR_MODULE_COMFORTABLE_MM
          ? "tight"
          : "ok",
  };
}

/**
 * What a retail bag has to carry regardless of jurisdiction. Not legal advice
 * and not a substitute for it — but a label missing net weight is not a design
 * problem, it is unsaleable stock, and the cheapest place to catch that is
 * before the print run.
 */
export const REQUIRED_CONTENT: {
  key: string;
  label: string;
  why: string;
  bindings?: LabelBinding[];
}[] = [
  {
    key: "identity",
    label: "Coffee name",
    why: "What is in the bag.",
    bindings: ["coffee.name"],
  },
  {
    key: "origin",
    label: "Country of origin",
    why: "Required on food packaging in most markets.",
    bindings: ["origin.country"],
  },
  {
    key: "roastDate",
    label: "Roast date",
    why: "Coffee is dated stock; a bag without one cannot be rotated.",
    bindings: ["coffee.roastedAt"],
  },
  {
    key: "netWeight",
    label: "Net weight",
    why: "Per SKU, so it is fixed text rather than a binding.",
  },
];

/** A static block carrying a quantity and a mass unit satisfies net weight. */
const WEIGHT_PATTERN = /\d\s*(g|kg|oz|lb)\b/i;

export function missingRequired(blocks: LabelBlock[]): typeof REQUIRED_CONTENT {
  const bound = new Set(
    blocks.filter((b) => b.kind === "field" && b.binding).map((b) => b.binding),
  );
  const staticText = blocks
    .filter((b) => b.kind === "text")
    .map((b) => b.text ?? "")
    .join(" ");

  return REQUIRED_CONTENT.filter((requirement) => {
    if (requirement.bindings) return !requirement.bindings.some((b) => bound.has(b));
    return !WEIGHT_PATTERN.test(staticText);
  });
}
