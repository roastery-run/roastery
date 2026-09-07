/**
 * Shared plumbing for a list route.
 *
 * Every list screen takes the same `{filter, page}` input and returns the same
 * `{items, page}`, so the hook that drives them can be written once. That
 * uniformity is a property of the API, not a coincidence — and it is why a new
 * list screen is a column definition rather than a component.
 */
import { rpc, type TableSearch } from "@roastery/ui";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";

export type ListResult<T> = { items: T[]; page: { nextCursor: string | null; hasMore: boolean } };

/**
 * What `ListPage` is handed, whole.
 *
 * The result goes in rather than the three fields a screen happens to need,
 * because the fourth field is the error — and a prop a caller can forget is a
 * screen that renders an empty table when the API returned a 500.
 */
export type ListQuery<T> = UseQueryResult<ListResult<T>, unknown>;

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
      // The sort has always been in the URL and in `ListPage`'s controls; it
      // simply was not sent, so every table looked sortable and reordered
      // nothing. The API rejects a key it does not allow, which is why the
      // column has to declare `sortKey` rather than the screen guessing.
      ...(search.sort ? { sort: search.sort, dir: search.dir } : {}),
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
