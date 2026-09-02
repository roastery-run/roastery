/**
 * Roast time, formatted the way a roaster reads it.
 *
 * Always mm:ss, never "9.7 minutes". A roaster calls first crack at 8:42 and
 * drops at 11:15; decimal minutes force a mental conversion at exactly the
 * moment attention is somewhere else.
 */
export function formatElapsed(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—:—";
  const negative = seconds < 0;
  const total = Math.round(Math.abs(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${negative ? "-" : ""}${minutes}:${String(rest).padStart(2, "0")}`;
}

export function parseElapsed(value: string): number | null {
  const match = /^(-?)(\d+):([0-5]\d)$/.exec(value.trim());
  if (!match) {
    const asSeconds = Number.parseFloat(value);
    return Number.isFinite(asSeconds) ? asSeconds : null;
  }
  const [, sign, minutes = "0", seconds = "0"] = match;
  const total = Number(minutes) * 60 + Number(seconds);
  return sign === "-" ? -total : total;
}

/** Development time ratio: the fraction of the roast after first crack. */
export function developmentRatio(
  firstCrackSeconds: number | null,
  dropSeconds: number | null,
): number | null {
  if (firstCrackSeconds === null || dropSeconds === null || dropSeconds <= 0) return null;
  if (firstCrackSeconds > dropSeconds) return null;
  return ((dropSeconds - firstCrackSeconds) / dropSeconds) * 100;
}
