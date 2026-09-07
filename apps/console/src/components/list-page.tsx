/**
 * The shape roughly thirty list routes share.
 *
 * Search state lives in the URL, so a filtered list is a link somebody can
 * paste into a message. Pagination is keyset — the API returns an opaque
 * cursor and never an offset — which means "next" is cheap on a tenant with
 * twelve thousand lots, and there is deliberately no page-number control,
 * because a keyset cursor cannot express "page 47".
 *
 * The whole query goes in rather than the fields a screen happens to want.
 * Handing this component `data` and `isLoading` left `error` as something
 * thirty call sites had to remember, and none of them did: a 500 rendered the
 * empty state, so "the API is down" and "you have no coffee" looked identical.
 * A prop a caller can forget is a defect waiting for a bad afternoon.
 */
import {
  Button,
  ButtonGroup,
  DataTable,
  type DataTableProps,
  ErrorState,
  Input,
  PageHeader,
  type TableSearch,
  toSearchParams,
} from "@roastery/ui";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, ChevronsLeft, Search, X } from "lucide-react";
import * as React from "react";
import { describeApiFailure, retryLabelFor } from "@/lib/api-failure";
import type { ListQuery } from "@/lib/list-route";

export type ListPageProps<T> = {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  search: TableSearch;
  query: ListQuery<T>;
  /**
   * Rendered beside the search box, and handed the same `update` the sort and
   * paging controls use. A render prop rather than a node so a filter cannot
   * grow its own navigation and write the URL a different way.
   */
  filters?: (update: (next: Partial<TableSearch>) => void) => React.ReactNode;
  searchPlaceholder?: string;
  /**
   * Sorting, paging and the data all come from `query`, so a caller describes
   * the columns and nothing else. Omitting them from the type is what stops a
   * screen quietly passing its own `data` and going stale.
   */
  table: Omit<DataTableProps<T>, "data" | "isLoading" | "sort" | "onSortChange">;
};

/** The searchable fields, in the order `toSearchParams` writes them. */
const FILTER_KEYS = ["q", "status", "from", "to", "filter"] as const;

export function ListPage<T>({
  title,
  description,
  actions,
  search,
  query,
  filters,
  searchPlaceholder = "Search",
  table,
}: ListPageProps<T>) {
  const navigate = useNavigate();
  const [text, setText] = React.useState(search.q);

  const rows = query.data?.items ?? [];
  const nextCursor = query.data?.page.nextCursor;
  const isFiltered = FILTER_KEYS.some((key) => search[key] !== "");

  // A cursor is only meaningful for the query that produced it. Sorting or
  // filtering makes every visited cursor point into an ordering that no longer
  // exists, so the chain is keyed and a changed key discards it — rather than
  // leaving a Previous button that pages into the old sort.
  const chainKey = JSON.stringify([
    search.q,
    search.sort,
    search.dir,
    search.limit,
    search.status,
    search.from,
    search.to,
    search.filter,
  ]);
  const [chain, setChain] = React.useState<{ key: string; cursors: string[] }>({
    key: chainKey,
    cursors: [],
  });
  const cursors = chain.key === chainKey ? chain.cursors : EMPTY_CHAIN;

  React.useEffect(() => setText(search.q), [search.q]);

  const update = React.useCallback(
    (next: Partial<TableSearch>) => {
      void navigate({
        to: ".",
        // Each route declares its own search schema, so this generic component
        // cannot name the union. The values are validated by the route's
        // `validateSearch` on the way back in, which is where it matters.
        search: toSearchParams({ ...search, ...next }) as never,
        replace: true,
      });
    },
    [navigate, search],
  );

  // Debounced, because a keystroke per request turns a search box into a
  // denial-of-service against your own API.
  React.useEffect(() => {
    if (text === search.q) return;
    const timer = setTimeout(() => update({ q: text, cursor: "" }), 300);
    return () => clearTimeout(timer);
  }, [text, search.q, update]);

  const clearFilters = React.useCallback(() => {
    setText("");
    // The sort goes too. This is the recovery the API's 400 points at, and the
    // request it rejects is most often a sort key from a bookmark taken before
    // that column was orderable — leaving the sort in place would hand back the
    // same failure and a button that does nothing.
    update({ q: "", status: "", from: "", to: "", filter: "", sort: "", cursor: "" });
  }, [update]);

  // A cursor with no chain behind it is a reloaded or pasted deep link. Without
  // this the only way back to the first page is editing the address bar, which
  // is not a thing to ask of somebody holding a portafilter.
  const isStranded = cursors.length === 0 && search.cursor !== "";
  const pageNumber = cursors.length + 1;

  // Paging is disabled mid-flight rather than debounced: two fast clicks on
  // Next would push the same cursor twice, and Previous would then walk the
  // chain into a page it never visited.
  const isPaging = query.isFetching;

  const failure = query.isError ? describeApiFailure(query.error, "this list") : null;
  // A failed refetch keeps the last good page on screen. Saying nothing there
  // presents stale rows as current, which is the quiet half of the same bug the
  // error state fixes loudly.
  const isStale = failure !== null && query.data !== undefined;

  return (
    <div className="space-y-4">
      <PageHeader title={title} description={description} actions={actions} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-56 sm:flex-none">
          <Search
            className="-translate-y-1/2 absolute top-1/2 start-2 size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && text !== "") {
                event.preventDefault();
                setText("");
              }
            }}
            placeholder={searchPlaceholder}
            className="h-8 w-full ps-7 pe-7"
            aria-label={searchPlaceholder}
            // The URL schema caps `q` at 200 and `.catch()`es past it, so a
            // longer string does not error — it silently drops the filter and
            // shows everything. Stopping it at the keyboard is the only place
            // the person finds out.
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
          />
          {text !== "" ? (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setText("")}
              aria-label="Clear search"
              className="-translate-y-1/2 absolute top-1/2 end-1 text-muted-foreground"
            >
              <X aria-hidden="true" />
            </Button>
          ) : null}
        </div>
        {filters?.(update)}
        {isFiltered ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {isStale ? (
        <p
          role="status"
          className="rounded-2xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm"
        >
          <span className="font-medium">Showing the last result that loaded.</span>{" "}
          <span className="text-muted-foreground">
            {failure.title}. These rows may no longer be current.
          </span>{" "}
          <Button variant="link" size="sm" className="h-auto px-0" onClick={() => query.refetch()}>
            Try again
          </Button>
        </p>
      ) : null}

      {failure && !query.data ? (
        <ErrorState
          title={failure.title}
          description={failure.description}
          correlationId={failure.correlationId}
          onRetry={
            failure.action === "retry"
              ? () => query.refetch()
              : failure.action === "reload"
                ? () => window.location.reload()
                : failure.action === "clear-filters"
                  ? clearFilters
                  : undefined
          }
          retryLabel={retryLabelFor(failure.action)}
        />
      ) : (
        <div
          className={isStale || isPaging ? "opacity-60 transition-opacity" : "transition-opacity"}
        >
          <DataTable
            {...table}
            data={rows}
            isLoading={query.isLoading}
            // A filtered list that comes back empty is not an empty list, and
            // the route's "no coffee yet, import a lot" copy is a lie in front
            // of somebody who just mistyped a lot code. Naming the term back is
            // what makes the typo visible; the escape is the one Clear filters
            // control above, not a second copy of it here.
            empty={
              isFiltered
                ? search.q
                  ? `Nothing matches \u201C${search.q}\u201D.`
                  : "Nothing matches these filters."
                : table.empty
            }
            sort={search.sort ? { key: search.sort, dir: search.dir } : undefined}
            onSortChange={(key) =>
              update({
                sort: key,
                dir: search.sort === key && search.dir === "desc" ? "asc" : "desc",
                cursor: "",
              })
            }
          />
        </div>
      )}

      {/* Typing into a search box that silently reorders a table underneath is
          silent to a screen reader. The count is the only feedback there is. */}
      <p role="status" aria-live="polite" className="sr-only">
        {query.isLoading || failure
          ? ""
          : `${rows.length} ${rows.length === 1 ? "row" : "rows"}${
              nextCursor ? ", more on the next page" : ""
            }`}
      </p>

      {!failure && (cursors.length > 0 || nextCursor || isStranded) ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            <span className="font-mono">{rows.length}</span> {rows.length === 1 ? "row" : "rows"}{" "}
            {/* A reloaded deep link knows it is deep, not how deep. Printing a
                number it cannot stand behind is worse than printing none. */}
            {isStranded ? (
              "on this page"
            ) : (
              <>
                on page <span className="font-mono">{pageNumber}</span>
              </>
            )}
          </p>
          <ButtonGroup className="ms-auto">
            {isStranded ? (
              <Button
                variant="outline"
                size="sm"
                disabled={isPaging}
                onClick={() => update({ cursor: "" })}
              >
                <ChevronsLeft className="size-3.5 rtl:rotate-180" aria-hidden="true" />
                First page
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={cursors.length === 0 || isPaging}
                onClick={() => {
                  const previous = cursors[cursors.length - 1] ?? "";
                  setChain({ key: chainKey, cursors: cursors.slice(0, -1) });
                  update({ cursor: previous });
                }}
              >
                <ChevronLeft className="size-3.5 rtl:rotate-180" aria-hidden="true" />
                Previous
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={!nextCursor || isPaging}
              onClick={() => {
                if (!nextCursor) return;
                setChain({ key: chainKey, cursors: [...cursors, search.cursor] });
                update({ cursor: nextCursor });
              }}
            >
              Next
              <ChevronRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
            </Button>
          </ButtonGroup>
        </div>
      ) : null}
    </div>
  );
}

/** Stable identity, so a discarded chain does not remount the buttons. */
const EMPTY_CHAIN: string[] = [];
