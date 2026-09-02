import { BadRequest } from "../api/errors";

/**
 * Importer for Artisan roast logs.
 *
 * Artisan is what most specialty roasters already use, so importing its
 * exports is how a customer's roast history arrives without retyping years of
 * batches.
 *
 * THREE THINGS A NAIVE IMPORTER GETS WRONG, and they are most of the work:
 *
 * 1. `timeindex[0]` is an INDEX INTO `timex`, not a timestamp. Every sample
 *    time must be rebased against the charge sample. Skip this and every
 *    imported curve is offset by however long the recorder ran before the
 *    beans went in — usually 30-90 seconds of an empty drum.
 *
 * 2. A `timeindex` entry of 0 at position >= 1 means UNSET, not "at time
 *    zero". Position 0 (charge) may legitimately be 0. Treat the others
 *    literally and every roast gains a phantom first crack at charge, which
 *    then poisons every development-time statistic.
 *
 * 3. `mode: "F"` needs converting, and the derived rate of rise scales by 5/9
 *    — it is a temperature DIFFERENCE per minute, not a temperature, so the
 *    32-degree offset must not be applied to it.
 *
 * `.alog` files are deliberately unsupported: they are a Python `repr` dict,
 * not JSON, and half-parsing one would silently mangle data. Users are told to
 * export JSON instead.
 */

export type ImportedSample = {
  /** Seconds since charge. */
  t: number;
  bt: number | null;
  et: number | null;
};

export type ImportedEvent = {
  t: number;
  kind:
    | "charge"
    | "dry_end"
    | "first_crack_start"
    | "first_crack_end"
    | "second_crack_start"
    | "second_crack_end"
    | "drop"
    | "cool_end";
};

export type ProfileImport = {
  source: "artisan-json" | "artisan-csv";
  roastedAt: string | null;
  beanName: string | null;
  weightInKg: number | null;
  weightOutKg: number | null;
  samples: ImportedSample[];
  events: ImportedEvent[];
};

/**
 * Artisan's `timeindex` positions, in order.
 *
 * Index 0 is charge; the rest are the phase markers. The order is fixed by
 * Artisan's format and must not be reordered.
 */
const TIMEINDEX_KINDS: ImportedEvent["kind"][] = [
  "charge",
  "dry_end",
  "first_crack_start",
  "first_crack_end",
  "second_crack_start",
  "second_crack_end",
  "drop",
  "cool_end",
];

const F_TO_C = (f: number) => (f - 32) / 1.8;
/** A rate of rise is a DIFFERENCE per minute, so only the scale applies. */
const F_DELTA_TO_C = (f: number) => f / 1.8;

export function convertTemp(value: number, mode: "C" | "F"): number {
  return mode === "F" ? round2(F_TO_C(value)) : round2(value);
}

export function convertRateOfRise(value: number, mode: "C" | "F"): number {
  return mode === "F" ? round3(F_DELTA_TO_C(value)) : round3(value);
}

type ArtisanJson = {
  mode?: string;
  timex?: number[];
  temp1?: number[];
  temp2?: number[];
  timeindex?: number[];
  roastdate?: string;
  roastisodate?: string;
  beans?: string;
  weight?: [number, number, string];
};

export function parseArtisanJson(raw: string): ProfileImport {
  let doc: ArtisanJson;
  try {
    doc = JSON.parse(raw) as ArtisanJson;
  } catch {
    throw new BadRequest(
      "Could not parse this file as Artisan JSON. If this is a .alog file, re-export it as JSON.",
    );
  }

  const timex = doc.timex ?? [];
  if (!timex.length) throw new BadRequest("This Artisan export contains no time series");

  const mode = (doc.mode ?? "C").toUpperCase() === "F" ? "F" : "C";
  // Artisan's convention: temp1 is ENVIRONMENT, temp2 is BEAN. Getting these
  // the wrong way round swaps every curve in the import, and the result still
  // looks like a roast — just one where the bean probe leads the drum.
  const et = doc.temp1 ?? [];
  const bt = doc.temp2 ?? [];

  const timeindex = doc.timeindex ?? [];
  // (1) The charge INDEX, not a time. Everything is rebased against it.
  const chargeIndex = timeindex[0] ?? 0;
  const chargeTime = timex[chargeIndex] ?? timex[0] ?? 0;

  const samples: ImportedSample[] = [];
  for (let i = 0; i < timex.length; i++) {
    const t = round2((timex[i] ?? 0) - chargeTime);
    // Readings before charge are the recorder warming up on an empty drum.
    if (t < 0) continue;
    samples.push({
      t,
      bt: pickTemp(bt[i], mode),
      et: pickTemp(et[i], mode),
    });
  }

  const events: ImportedEvent[] = [];
  for (
    let position = 0;
    position < timeindex.length && position < TIMEINDEX_KINDS.length;
    position++
  ) {
    const index = timeindex[position];
    if (index === undefined) continue;
    // (2) Zero means UNSET everywhere except charge.
    if (index === 0 && position !== 0) continue;
    const at = timex[index];
    if (at === undefined) continue;
    const kind = TIMEINDEX_KINDS[position];
    if (!kind) continue;
    events.push({ t: round2(at - chargeTime), kind });
  }

  return {
    source: "artisan-json",
    roastedAt: doc.roastisodate ?? doc.roastdate ?? null,
    beanName: doc.beans ?? null,
    weightInKg: toKg(doc.weight?.[0], doc.weight?.[2]),
    weightOutKg: toKg(doc.weight?.[1], doc.weight?.[2]),
    samples,
    events,
  };
}

/**
 * Artisan's CSV export.
 *
 * Tab-separated with a two-line header. Times are `mm:ss`, and the file
 * carries no charge index — the export is already rebased, so `00:00` is
 * charge.
 */
export function parseArtisanCsv(raw: string): ProfileImport {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new BadRequest("This CSV contains no readings");

  const headerIndex = lines.findIndex((l) => /time/i.test(l) && /(bt|bean)/i.test(l));
  if (headerIndex < 0) {
    throw new BadRequest("Could not find an Artisan header row (expected Time and BT columns)");
  }

  const delimiter = lines[headerIndex]?.includes("\t") ? "\t" : ",";
  const header = (lines[headerIndex] ?? "").split(delimiter).map((h) => h.trim().toLowerCase());
  // Columns carry a unit suffix in some exports ("BT (F)"), so match on the
  // leading token rather than the whole cell.
  const timeCol = header.findIndex((h) => h.startsWith("time"));
  const btCol = header.findIndex((h) => /^bt\b/.test(h) || h.includes("bean"));
  const etCol = header.findIndex((h) => /^et\b/.test(h) || h.includes("environ"));

  // The unit lives in the header text, e.g. "BT (F)".
  const mode = /\(\s*f\s*\)|°f/i.test(lines[headerIndex] ?? "") ? "F" : "C";

  const samples: ImportedSample[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const cells = line.split(delimiter);
    const t = parseClock(cells[timeCol]);
    if (t === null) continue;
    samples.push({
      t,
      bt: pickTemp(Number.parseFloat(cells[btCol] ?? ""), mode),
      et: etCol >= 0 ? pickTemp(Number.parseFloat(cells[etCol] ?? ""), mode) : null,
    });
  }

  if (!samples.length) throw new BadRequest("This CSV contains no parsable readings");

  return {
    source: "artisan-csv",
    roastedAt: null,
    beanName: null,
    weightInKg: null,
    weightOutKg: null,
    samples,
    // The CSV export carries no phase markers; charge is implied by t = 0.
    events: [{ t: 0, kind: "charge" }],
  };
}

/** Dispatches on content rather than filename, which users rename freely. */
export function parseArtisan(raw: string): ProfileImport {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("{")) return parseArtisanJson(raw);
  if (trimmed.startsWith("[")) {
    throw new BadRequest("This looks like an Artisan .alog file. Re-export it as JSON.");
  }
  return parseArtisanCsv(raw);
}

function pickTemp(value: number | undefined, mode: "C" | "F"): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  // Artisan writes -1 for a missing reading, which is a plausible Celsius
  // value and must not be imported as one.
  if (value === -1) return null;
  return convertTemp(value, mode);
}

/** `mm:ss` or `h:mm:ss`. */
function parseClock(cell: string | undefined): number | null {
  if (!cell) return null;
  const parts = cell.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map((p) => Number.parseFloat(p));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return parts.length === 3
    ? round2((nums[0] ?? 0) * 3600 + (nums[1] ?? 0) * 60 + (nums[2] ?? 0))
    : round2((nums[0] ?? 0) * 60 + (nums[1] ?? 0));
}

function toKg(value: number | undefined, unit: string | undefined): number | null {
  if (value === undefined || !Number.isFinite(value) || value === 0) return null;
  switch ((unit ?? "kg").toLowerCase()) {
    case "g":
      return round3(value / 1000);
    case "lb":
    case "lbs":
      return round3(value * 0.45359237);
    case "oz":
      return round3(value * 0.028349523);
    default:
      return round3(value);
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
