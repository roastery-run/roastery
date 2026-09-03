/**
 * Where a request actually spent its time, as a `Server-Timing` header.
 *
 * Added because a latency problem on staging could not be attributed from the
 * outside: total time was 730ms, the database answered warm queries in 60ms,
 * and the remaining 300ms was invisible. Guessing which layer owns a number is
 * how the wrong thing gets optimised.
 *
 * `Server-Timing` rather than a log line because the browser devtools network
 * panel renders it inline, so the console's own slow screens explain
 * themselves without anyone reading Worker logs.
 */

export type Timings = { marks: [string, number][]; startedAt: number };

export function startTimings(): Timings {
  return { marks: [], startedAt: Date.now() };
}

/** Times `fn`, records it under `name`, and returns its result untouched. */
export async function timed<T>(
  timings: Timings | undefined,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!timings) return fn();
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    timings.marks.push([name, Date.now() - startedAt]);
  }
}

export function serverTimingHeader(timings: Timings): string {
  const total = Date.now() - timings.startedAt;
  return [...timings.marks.map(([name, ms]) => `${name};dur=${ms}`), `total;dur=${total}`].join(
    ", ",
  );
}
