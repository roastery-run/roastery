/**
 * Shared plumbing for a list route.
 *
 * Every list screen takes the same `{filter, page}` input and returns the same
 * `{items, page}`, so the hook that drives them can be written once. That
 * uniformity is a property of the API, not a coincidence — and it is why a new
 * list screen is a column definition rather than a component.
 */
import { rpc, type TableSearch } from "@roastery/ui";
import { useQuery } from "@tanstack/react-query";

export type ListResult<T> = { items: T[]; page: { nextCursor: string | null; hasMore: boolean } };

export function useListQuery<T>(
  operation: string,
  search: TableSearch,
  filter?: Record<string, unknown>,
) {
  const input = {
    filter: cleanFilter({ ...filter, ...(search.q ? { q: search.q } : {}) }),
    page: {
      limit: search.limit,
      ...(search.cursor ? { cursor: search.cursor } : {}),
    },
  };

  return useQuery({
    queryKey: [operation, input],
    queryFn: ({ signal }) => rpc<ListResult<T>>(operation, input, { signal }),
    // Keeps the previous page on screen while the next one loads, so paging
    // does not flash an empty table.
    placeholderData: (previous) => previous,
  });
}

/** Drops empty values so the request carries a filter only when there is one. */
function cleanFilter(filter: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(filter).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}
