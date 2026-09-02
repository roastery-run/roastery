/**
 * The URL contract for every list screen.
 *
 * One schema, shared by all ~30 list routes, so a saved view IS a serialized
 * TableSearch rather than a parallel concept with its own storage and bugs.
 *
 * EVERY field `.catch()`es instead of throwing. A stale bookmark, a truncated
 * link in a chat message, or a colleague hand-editing a query string must
 * degrade to the default view — never to an error page. Someone opening a link
 * to a filter that no longer exists should see the list.
 *
 * Fields are OPTIONAL rather than defaulted, because TanStack Router writes the
 * validated object back to the URL: defaulting here would turn every plain list
 * into `?q=&sort=&dir=desc&limit=50&cursor=&status=&from=&to=&filter=`, which
 * is unreadable, unshareable, and makes a genuine filter impossible to spot.
 * Defaults are applied on READ, by `withSearchDefaults`.
 */
import { z } from "zod";

export const tableSearchSchema = z.object({
  q: z.string().max(200).optional().catch(undefined),
  sort: z.string().max(60).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
  limit: z.coerce.number().int().min(10).max(200).optional().catch(undefined),
  cursor: z.string().max(512).optional().catch(undefined),
  status: z.string().max(60).optional().catch(undefined),
  from: z.string().max(40).optional().catch(undefined),
  to: z.string().max(40).optional().catch(undefined),
  /** Free-form per-screen filters, kept short enough to stay linkable. */
  filter: z.string().max(500).optional().catch(undefined),
});

/** What lands in the URL. Every field may be absent. */
export type TableSearchInput = z.infer<typeof tableSearchSchema>;

/** What a screen reads. Every field is present. */
export type TableSearch = {
  q: string;
  sort: string;
  dir: "asc" | "desc";
  limit: number;
  cursor: string;
  status: string;
  from: string;
  to: string;
  filter: string;
};

export function withSearchDefaults(search: TableSearchInput): TableSearch {
  return {
    q: search.q ?? "",
    sort: search.sort ?? "",
    dir: search.dir ?? "desc",
    limit: search.limit ?? 50,
    cursor: search.cursor ?? "",
    status: search.status ?? "",
    from: search.from ?? "",
    to: search.to ?? "",
    filter: search.filter ?? "",
  };
}

/**
 * Back to URL form, dropping anything at its default.
 *
 * This is what keeps a shared link legible: `?status=quarantined` says what it
 * filters, where nine empty parameters say nothing at all.
 */
export function toSearchParams(search: Partial<TableSearch>): TableSearchInput {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(search)) {
    if (value === "" || value === undefined || value === null) continue;
    if (key === "limit" && value === 50) continue;
    if (key === "dir" && value === "desc") continue;
    out[key] = value as string | number;
  }
  return out as TableSearchInput;
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
