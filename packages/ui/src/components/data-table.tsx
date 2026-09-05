/**
 * The list surface behind roughly thirty routes.
 *
 * TanStack Table headless, fully MANUAL: pagination, sorting and filtering all
 * happen on the server. Client-side sorting of a 50-row page in a 12,000-row
 * tenant sorts the page, not the data — which looks like it works and is wrong,
 * and is the single most common table bug in an admin product.
 *
 * Virtualization only past a threshold, deliberately. Under it, the rows are
 * real DOM: find-in-page works, and so does printing, which matters on a
 * warehouse terminal where somebody prints a pick list.
 */
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type RowData,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

/**
 * Per-column presentation, carried as DATA.
 *
 * This is what makes a 32-field table 32 lines of configuration instead of 32
 * components — and what lets the CSV export, the column picker and the saved
 * view all read the same description of a column.
 */
export type RoasteryColumnMeta = {
  label: string;
  /** Numbers right-align so a column of weights can be compared by eye. */
  align?: "start" | "end";
  /** Rendered after the value, muted: "kg", "°C", "%". */
  unit?: string;
  sortKey?: string;
  /** Hidden by default but offered in the column picker. */
  optional?: boolean;
  width?: string;
};

declare module "@tanstack/react-table" {
  // The generic parameters are unused here but required to match the interface
  // being augmented; TanStack keys column meta by them.
  interface ColumnMeta<TData extends RowData, TValue> extends RoasteryColumnMeta {}
}

const VIRTUALIZE_ABOVE = 100;

export type DataTableProps<T> = {
  data: T[];
  columns: ColumnDef<T>[];
  isLoading?: boolean;
  /** Shown when there is genuinely nothing, never while loading. */
  empty?: React.ReactNode;
  onRowClick?: (row: T) => void;
  sort?: { key: string; dir: "asc" | "desc" };
  onSortChange?: (key: string) => void;
  rowKey: (row: T) => string;
  className?: string;
};

export function DataTable<T>({
  data,
  columns,
  isLoading,
  empty,
  onRowClick,
  sort,
  onSortChange,
  rowKey,
  className,
}: DataTableProps<T>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  });

  const rows = table.getRowModel().rows;
  const shouldVirtualize = rows.length > VIRTUALIZE_ABOVE;
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 37,
    overscan: 12,
    enabled: shouldVirtualize,
  });

  if (isLoading) {
    return (
      <div className={cn("space-y-2", className)} aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading</span>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl bg-card ring-1 ring-foreground/10 px-6 py-16 text-center text-sm text-muted-foreground">
        {empty ?? "Nothing here yet."}
      </div>
    );
  }

  const body = shouldVirtualize ? virtualizer.getVirtualItems() : null;

  return (
    <div
      ref={scrollRef}
      className={cn(
        "relative overflow-auto rounded-2xl bg-card ring-1 ring-foreground/10",
        shouldVirtualize && "max-h-[70vh]",
        className,
      )}
    >
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => {
                const meta = header.column.columnDef.meta;
                const sortKey = meta?.sortKey;
                const isSorted = sortKey && sort?.key === sortKey;
                return (
                  <TableHead
                    key={header.id}
                    style={meta?.width ? { width: meta.width } : undefined}
                    // Shorter than maia's h-12 heads: this table is the list
                    // surface behind thirty routes and is read for density.
                    className={cn("h-10", meta?.align === "end" && "text-right")}
                    aria-sort={
                      isSorted ? (sort?.dir === "asc" ? "ascending" : "descending") : undefined
                    }
                  >
                    {sortKey && onSortChange ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "-mx-2 h-7 gap-1 px-2 font-medium",
                          meta?.align === "end" && "ml-auto",
                        )}
                        onClick={() => onSortChange(sortKey)}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {isSorted ? (
                          sort?.dir === "asc" ? (
                            <ArrowUp className="size-3" />
                          ) : (
                            <ArrowDown className="size-3" />
                          )
                        ) : (
                          <ChevronsUpDown className="size-3 opacity-40" />
                        )}
                      </Button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>

        <TableBody
          style={
            shouldVirtualize
              ? { height: virtualizer.getTotalSize(), position: "relative" }
              : undefined
          }
        >
          {(body ?? rows.map((_, index) => ({ index, key: index, start: 0 }))).map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            return (
              <TableRow
                key={rowKey(row.original)}
                data-index={item.index}
                ref={shouldVirtualize ? virtualizer.measureElement : undefined}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={cn(
                  onRowClick && "cursor-pointer",
                  shouldVirtualize && "absolute left-0 flex w-full",
                )}
                style={shouldVirtualize ? { transform: `translateY(${item.start}px)` } : undefined}
              >
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta;
                  return (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        "py-1.5 text-sm",
                        meta?.align === "end" && "text-right",
                        shouldVirtualize && "flex-1",
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      {meta?.unit ? (
                        <span className="ml-1 text-xs text-muted-foreground">{meta.unit}</span>
                      ) : null}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
