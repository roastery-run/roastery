import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@roastery/ui";
import { humanize } from "@roastery/units";

/**
 * A filter control for a list screen.
 *
 * Every value it can set is already in the URL contract, so a filtered list
 * stays a link somebody can paste. `""` is the unset value rather than
 * `undefined`, because `toSearchParams` drops empty strings and that is what
 * keeps `?status=` out of a plain list.
 */
export function ListFilter({
  id,
  label,
  value,
  options,
  onChange,
  allLabel = "All",
}: {
  id: string;
  /** Announced to a screen reader; the trigger itself shows the value. */
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  allLabel?: string;
}) {
  return (
    <Select
      value={value === "" ? ALL : value}
      onValueChange={(next) => onChange(next === ALL ? "" : next)}
    >
      <SelectTrigger
        id={id}
        aria-label={label}
        size="sm"
        // Ember only when it is actually filtering. A control that looks
        // engaged when it is not makes an unfiltered list look filtered, which
        // is the one thing a stock screen must never do.
        className={value === "" ? undefined : "border-primary/40 text-primary"}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Radix forbids an empty string as an item value, so "unset" needs a token. */
const ALL = "__all__";

/** Builds options from a domain enum, so the labels cannot drift from it. */
export function optionsFrom(values: readonly string[]): { value: string; label: string }[] {
  return values.map((value) => ({ value, label: humanize(value) }));
}
