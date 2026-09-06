import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
  rpc,
  Skeleton,
  Spinner,
} from "@roastery/ui";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import * as React from "react";
import { useDebounced } from "@/lib/use-debounced";

/**
 * Choosing one thing out of everything.
 *
 * The screens this replaces fetched a flat page of 200 rows into a plain
 * `Select` and offered no way to search it. On a small tenant that is merely
 * long; on one with twelve thousand lots it is an arbitrary two hundred, and
 * the lot somebody wants is usually not among them. The list looked complete
 * and was not, which is the failure this product is least willing to ship.
 *
 * So the search goes to the SERVER. Every list operation behind these pickers
 * takes a `q`, the request carries fifty rows instead of two hundred, and what
 * comes back is genuinely the best match rather than the best match in the
 * first page. The chosen row is held locally so the trigger can name it even
 * once the search that found it has been typed over.
 */
export type PickerItem = {
  id: string;
  label: string;
  /** A code, SKU or other machine value. Rendered in mono beside the label. */
  code?: string;
  /** A figure — a weight, a count. Right-aligned, muted. */
  trailing?: string;
};

export function SearchPicker<T>({
  id,
  value,
  onSelect,
  operation,
  filter,
  toItem,
  label,
  placeholder = "Choose",
  searchPlaceholder = "Search",
  emptyLabel = "Nothing matches that.",
  initialItem,
  disabled,
  className,
}: {
  id: string;
  value: string | undefined;
  onSelect: (item: PickerItem) => void;
  /** A list operation whose filter accepts `q`. */
  operation: string;
  filter?: Record<string, unknown>;
  toItem: (row: T) => PickerItem;
  /** The accessible name. The trigger shows the value, not the label. */
  label: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  /** What the trigger shows before anything is picked in this session. */
  initialItem?: PickerItem;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState("");
  const [picked, setPicked] = React.useState<PickerItem | undefined>(initialItem);
  const search = useDebounced(term, 250);

  // Seeded from the caller until this picker has been used: the caller usually
  // resolves the current value from a list it already holds, and a trigger that
  // says "Choose a product" while a product is selected is a lie.
  React.useEffect(() => {
    if (initialItem && initialItem.id !== picked?.id && initialItem.id === value) {
      setPicked(initialItem);
    }
  }, [initialItem, picked?.id, value]);

  const query = useQuery({
    queryKey: [operation, "picker", filter, search],
    queryFn: () =>
      rpc<{ items: T[] }>(operation, {
        filter: { ...filter, ...(search ? { q: search } : {}) },
        // Fifty is a scroll, not a haystack. The search is what finds things.
        page: { limit: 50 },
      }),
    // Only once opened: five of these on one screen would otherwise be five
    // requests before anybody has asked a question.
    enabled: open,
    staleTime: 30_000,
  });

  const items = (query.data?.items ?? []).map(toItem);
  const shown = picked?.id === value ? picked : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          disabled={disabled}
          className={cn(
            // The Select vocabulary exactly: this is the same decision, so it
            // must not look like a different kind of control.
            "flex h-9 w-full items-center justify-between gap-1.5 rounded-4xl border border-input bg-input/30 px-3 py-2 text-sm whitespace-nowrap outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-input/50",
            !shown && "text-muted-foreground",
            className,
          )}
        >
          <span className="line-clamp-1 text-left">{shown ? shown.label : placeholder}</span>
          <ChevronDown className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        // Matches the trigger, but never so narrow that the name, code and
        // figure collide — the row in a BOM is a flexible column and can be
        // much narrower than the content it has to choose from.
        className="w-(--radix-popover-trigger-width) min-w-64 p-0"
        align="start"
      >
        {/* The server does the matching, so cmdk must not also filter — it
            would hide rows the API deliberately returned. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={term}
            onValueChange={setTerm}
            aria-label={searchPlaceholder}
          />
          <CommandList>
            {query.isLoading ? (
              <div className="space-y-1 p-2" aria-busy="true">
                <span className="sr-only">Searching</span>
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : items.length === 0 ? (
              <CommandEmpty>{emptyLabel}</CommandEmpty>
            ) : (
              items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onSelect={() => {
                    setPicked(item);
                    onSelect(item);
                    setOpen(false);
                    setTerm("");
                  }}
                  className="gap-2"
                >
                  <Check
                    className={cn("size-3.5 shrink-0", item.id === value ? "" : "opacity-0")}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.code ? (
                    <span className="shrink-0 font-mono text-muted-foreground text-xs">
                      {item.code}
                    </span>
                  ) : null}
                  {item.trailing ? (
                    <span className="shrink-0 font-mono text-xs tabular-nums">{item.trailing}</span>
                  ) : null}
                </CommandItem>
              ))
            )}
            {/* A refetch behind an already-populated list, so the rows do not
                flash to skeletons on every keystroke. */}
            {query.isFetching && !query.isLoading ? (
              <div className="flex items-center gap-2 px-3 py-2 text-muted-foreground text-xs">
                <Spinner className="size-3" />
                Searching
              </div>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
