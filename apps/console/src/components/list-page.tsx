/**
 * The shape roughly thirty list routes share.
 *
 * Search state lives in the URL, so a filtered list is a link somebody can
 * paste into a message. Pagination is keyset — the API returns an opaque
 * cursor and never an offset — which means "next" is cheap on a tenant with
 * twelve thousand lots, and there is deliberately no page-number control,
 * because a keyset cursor cannot express "page 47".
 */
import {
  Button,
  DataTable,
  type DataTableProps,
  Input,
  PageHeader,
  type TableSearch,
  toSearchParams,
} from "@roastery/ui";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import * as React from "react";

export type ListPageProps<T> = {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  search: TableSearch;
  /** Set when the API says there is another page. */
  nextCursor?: string | null;
  /** Cursors already visited, so Back works without re-querying from the top. */
  filters?: React.ReactNode;
  searchPlaceholder?: string;
  table: DataTableProps<T>;
};

export function ListPage<T>({
  title,
  description,
  actions,
  search,
  nextCursor,
  filters,
  searchPlaceholder = "Search",
  table,
}: ListPageProps<T>) {
  const navigate = useNavigate();
  const [query, setQuery] = React.useState(search.q);

  // Keyset pagination has no "previous" — the cursor only points forward — so
  // the visited cursors are kept here. Reconstructing them by re-querying from
  // the first page would make Back the most expensive action on the screen.
  const [history, setHistory] = React.useState<string[]>([]);

  React.useEffect(() => setQuery(search.q), [search.q]);

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
    if (query === search.q) return;
    const timer = setTimeout(() => {
      setHistory([]);
      update({ q: query, cursor: "" });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, search.q, update]);

  return (
    <div className="space-y-4">
      <PageHeader title={title} description={description} actions={actions} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search
            className="-translate-y-1/2 absolute top-1/2 left-2 size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 w-56 pl-7"
            aria-label={searchPlaceholder}
          />
        </div>
        {filters}
      </div>

      <DataTable
        {...table}
        sort={search.sort ? { key: search.sort, dir: search.dir } : undefined}
        onSortChange={(key) =>
          update({
            sort: key,
            dir: search.sort === key && search.dir === "desc" ? "asc" : "desc",
            cursor: "",
          })
        }
      />

      {(history.length > 0 || nextCursor) && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={history.length === 0}
            onClick={() => {
              const previous = history[history.length - 1] ?? "";
              setHistory((h) => h.slice(0, -1));
              update({ cursor: previous });
            }}
          >
            <ChevronLeft className="size-3.5" aria-hidden="true" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!nextCursor}
            onClick={() => {
              setHistory((h) => [...h, search.cursor]);
              update({ cursor: nextCursor ?? "" });
            }}
          >
            Next
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}
