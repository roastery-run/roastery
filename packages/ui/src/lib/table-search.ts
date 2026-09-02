/**
 * The URL contract for every list screen.
 *
 * One schema, shared by all ~30 list routes, so a saved view IS a serialized
 * TableSearch rather than a parallel concept with its own storage and its own
 * bugs.
 *
 * EVERY field `.catch()`es instead of throwing. A stale bookmark, a truncated
 * link in a chat message, or a colleague hand-editing a query string must
 * degrade to the default view — never to an error page. Someone opening a link
 * to a filter that no longer exists should see the list, not a 404.
 */
import { z } from "zod";

export const tableSearchSchema = z.object({
  q: z.string().max(200).catch("").default(""),
  sort: z.string().max(60).catch("").default(""),
  dir: z.enum(["asc", "desc"]).catch("desc").default("desc"),
  limit: z.coerce.number().int().min(10).max(200).catch(50).default(50),
  cursor: z.string().max(512).catch("").default(""),
  status: z.string().max(60).catch("").default(""),
  from: z.string().max(40).catch("").default(""),
  to: z.string().max(40).catch("").default(""),
  /** Free-form per-screen filters, kept short enough to stay linkable. */
  filter: z.string().max(500).catch("").default(""),
});

export type TableSearch = z.infer<typeof tableSearchSchema>;

/** Drops defaults so a pristine list has a clean URL rather than eight params. */
export function toSearchParams(search: Partial<TableSearch>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(search)) {
    if (value === "" || value === undefined || value === null) continue;
    if (key === "limit" && value === 50) continue;
    if (key === "dir" && value === "desc") continue;
    out[key] = String(value);
  }
  return out;
}

/** Parses the `filter` blob into key:value pairs. */
export function parseFilter(filter: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of filter.split(",")) {
    const [key, ...rest] = part.split(":");
    if (key && rest.length) out[key.trim()] = rest.join(":").trim();
  }
  return out;
}

export function serializeFilter(values: Record<string, string | undefined>): string {
  return Object.entries(values)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}:${v}`)
    .join(",");
}
