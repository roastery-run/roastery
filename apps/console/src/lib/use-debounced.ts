import * as React from "react";

/**
 * A value that settles before anything asks the API about it.
 *
 * For inputs whose every keystroke is a query key. Typing "1000" into a
 * quantity field is four values and, without this, four requests — the same
 * reason `ListPage` debounces its search box, applied to the other places a
 * live figure is recomputed as somebody types.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = React.useState(value);

  React.useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
