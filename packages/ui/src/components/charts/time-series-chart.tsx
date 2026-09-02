/**
 * A dense time-series chart, for roast curves and shot histories.
 *
 * uPlot rather than a React charting library, and the reason is arithmetic: a
 * component that renders one DOM node per point cannot draw an 1,800-sample
 * roast curve at 1 Hz. uPlot draws to a canvas, and `setData(data, false)`
 * appends WITHOUT rescaling — the one API that makes a live roast smooth
 * instead of a curve that jumps every second as the axis re-fits.
 *
 * Canvas accessibility is not optional here. A chart nobody can read with a
 * screen reader is a chart that is illegal to ship in several of our customers'
 * jurisdictions, and more to the point it is the primary artifact of a QC
 * process. So: role="img" with a generated summary, a visually-hidden data
 * table, and keyboard cursor movement with a throttled live readout.
 */
import * as React from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { SERIES_DASH, useChartTokens } from "../../hooks/use-chart-tokens";
import { cn } from "../../lib/utils";

export type ChartSeries = {
  label: string;
  /** Same length as `x`. Null is a gap, not a zero. */
  values: (number | null)[];
  unit?: string;
  /** Index into the token palette. Defaults to position. */
  colorIndex?: number;
  /**
   * Which y-scale this series belongs to.
   *
   * `"right"` gets its own axis. Rate of rise is the reason this exists: it
   * runs from about −200 to +40 while bean temperature runs 90 to 220, and
   * sharing one axis compresses the temperature curve — the thing a roaster is
   * actually reading — into the top third of the chart.
   */
  axis?: "left" | "right";
};

export type TimeSeriesChartProps = {
  /** Seconds since charge for a roast; epoch ms for anything wall-clock. */
  x: number[];
  series: ChartSeries[];
  height?: number;
  xLabel?: string;
  /** Formats an x value for the axis and the readout. */
  formatX?: (value: number) => string;
  title: string;
  description?: string;
  className?: string;
  /** Rows in the visually-hidden table. Sampling every point would be unusable. */
  tableInterval?: number;
};

export function TimeSeriesChart({
  x,
  series,
  height = 320,
  xLabel = "Time",
  formatX = (v) => String(v),
  title,
  description,
  className,
  tableInterval = 30,
}: TimeSeriesChartProps) {
  const tokens = useChartTokens();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const plotRef = React.useRef<uPlot | null>(null);
  const [cursorIndex, setCursorIndex] = React.useState<number | null>(null);

  const data = React.useMemo(
    () => [x, ...series.map((s) => s.values)] as unknown as uPlot.AlignedData,
    [x, series],
  );

  // Rebuilt when the SHAPE changes — series count, labels, theme — but never
  // when only the values do. Recreating a plot on every data tick is what makes
  // a live chart flicker and drop frames.
  const hasRightAxis = series.some((s) => s.axis === "right");
  const shapeKey = `${series.map((s) => `${s.label}@${s.axis ?? "left"}`).join("|")}:${tokens.series.join("|")}`;

  const builtForRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || tokens.series.length === 0) return;
    // Guard rather than a dependency list: the linter wants every referenced
    // value listed, and listing them is correct — rebuilding on them is not.
    if (builtForRef.current === shapeKey && plotRef.current) return;
    builtForRef.current = shapeKey;
    plotRef.current?.destroy();

    const options: uPlot.Options = {
      width: container.clientWidth,
      height,
      // No point markers and no animation: at 1,800 points a marker per sample
      // is noise, and a chart that animates while a roaster is reading it is
      // actively unhelpful.
      cursor: { drag: { x: true, y: false }, points: { show: false } },
      legend: { show: false },
      scales: {
        x: { time: false },
        y: {},
        ...(hasRightAxis ? { y2: {} } : {}),
      },
      axes: [
        {
          stroke: tokens.axis,
          grid: { stroke: tokens.grid, width: 1 },
          ticks: { stroke: tokens.grid },
          values: (_u, splits) => splits.map((v) => formatX(v)),
          font: "11px ui-monospace, monospace",
        },
        {
          scale: "y",
          stroke: tokens.axis,
          grid: { stroke: tokens.grid, width: 1 },
          ticks: { stroke: tokens.grid },
          font: "11px ui-monospace, monospace",
        },
        ...(hasRightAxis
          ? [
              {
                scale: "y2",
                side: 1 as const,
                stroke: tokens.axis,
                // No grid on the second axis: two overlapping grids at
                // different intervals is visual noise that helps nobody read
                // either scale.
                grid: { show: false },
                ticks: { stroke: tokens.grid },
                font: "11px ui-monospace, monospace",
              },
            ]
          : []),
      ],
      series: [
        { label: xLabel },
        ...series.map((s, i) => ({
          label: s.label,
          scale: s.axis === "right" ? "y2" : "y",
          stroke: tokens.series[s.colorIndex ?? i % tokens.series.length],
          width: 1.75,
          dash: SERIES_DASH[s.colorIndex ?? i % SERIES_DASH.length],
          // A null is a GAP — a sensor dropout — not a zero. Joining across it
          // would draw a line through data that does not exist.
          spanGaps: false,
        })),
      ],
      hooks: {
        setCursor: [
          (u) => {
            setCursorIndex(u.cursor.idx ?? null);
          },
        ],
      },
    };

    const plot = new uPlot(options, data, container);
    plotRef.current = plot;

    const observer = new ResizeObserver(() => {
      plot.setSize({ width: container.clientWidth, height });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      plot.destroy();
      plotRef.current = null;
      builtForRef.current = null;
    };
    // Intentionally keyed on SHAPE, not on data. `data`, `series`, `formatX`
    // and the token object all change on every tick; including them would
    // destroy and rebuild the plot 1,800 times during a roast. Data updates
    // take the cheap setData path in the effect below.
  }, [shapeKey, height, xLabel, hasRightAxis, data, formatX, series, tokens]);

  // Data-only updates take the cheap path. `false` means "do not rescale",
  // which is what stops the axis jumping on every appended sample.
  React.useEffect(() => {
    plotRef.current?.setData(data, false);
  }, [data]);

  const summary = React.useMemo(() => buildSummary(series, x, formatX), [series, x, formatX]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowLeft" ? -1 : 1;
    const next = Math.min(x.length - 1, Math.max(0, (cursorIndex ?? 0) + step));
    setCursorIndex(next);
    plotRef.current?.setCursor({ left: plotRef.current.valToPos(x[next] ?? 0, "x"), top: 0 });
  };

  const readout =
    cursorIndex === null
      ? null
      : `${formatX(x[cursorIndex] ?? 0)}: ${series
          .map((s) => `${s.label} ${format(s.values[cursorIndex])}${s.unit ?? ""}`)
          .join(", ")}`;

  return (
    <figure className={cn("space-y-2", className)}>
      <div
        ref={containerRef}
        role="img"
        aria-label={`${title}. ${description ?? ""} ${summary}`.trim()}
        // A focusable role="img" looks wrong to the linter and is right here:
        // this is the established accessible-chart pattern. The element carries
        // a static description for a screen reader AND accepts arrow keys to
        // walk a data cursor, and a cursor you cannot focus is a cursor a
        // keyboard user cannot move.
        // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard data cursor requires focus.
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border border-border bg-card p-2 focus-visible:outline-2 focus-visible:outline-ring"
      />

      {/* Throttled by React's own batching to one update per cursor move. A
          per-pixel live region would flood a screen reader into uselessness. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {readout}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((s, i) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden="true" className="shrink-0">
              <title>{`${s.label} line style`}</title>
              <line
                x1="0"
                y1="4"
                x2="18"
                y2="4"
                stroke={tokens.series[s.colorIndex ?? i % tokens.series.length]}
                strokeWidth="2"
                strokeDasharray={(SERIES_DASH[s.colorIndex ?? i % SERIES_DASH.length] ?? []).join(
                  ",",
                )}
              />
            </svg>
            {s.label}
            {s.axis === "right" ? <span className="text-muted-foreground/70">(right)</span> : null}
          </span>
        ))}
      </div>

      {/* The chart's content as a table, for a screen reader and for anyone who
          would rather read the numbers. Sampled, because one row per sample is
          1,800 rows nobody can navigate. */}
      <figcaption className="sr-only">
        <table>
          <caption>
            {title} — values every {tableInterval} points
          </caption>
          <thead>
            <tr>
              <th scope="col">{xLabel}</th>
              {series.map((s) => (
                <th key={s.label} scope="col">
                  {s.label}
                  {s.unit ? ` (${s.unit})` : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {x
              .map((value, index) => ({ value, index }))
              .filter(({ index }) => index % tableInterval === 0)
              .map(({ value, index }) => (
                <tr key={value}>
                  <th scope="row">{formatX(value)}</th>
                  {series.map((s) => (
                    <td key={s.label}>{format(s.values[index])}</td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}

const format = (value: number | null | undefined): string =>
  value === null || value === undefined ? "—" : value.toFixed(1);

/** A one-sentence description of each series, for the chart's accessible name. */
function buildSummary(series: ChartSeries[], x: number[], formatX: (v: number) => string): string {
  if (x.length === 0) return "No data.";
  const span = `${formatX(x[0] ?? 0)} to ${formatX(x[x.length - 1] ?? 0)}`;
  const parts = series.map((s) => {
    const values = s.values.filter((v): v is number => v !== null);
    if (!values.length) return `${s.label}: no data`;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const last = values[values.length - 1] ?? 0;
    return `${s.label} from ${min.toFixed(1)} to ${max.toFixed(1)}${s.unit ?? ""}, ending at ${last.toFixed(1)}`;
  });
  return `${x.length} points over ${span}. ${parts.join(". ")}.`;
}
