/**
 * Operational counters.
 *
 * The system alerts its customers well — a missed fixation, a lot below its
 * minimum, an endpoint auto-disabled — and told nobody running it anything.
 * Sixty errors and thirty dropped queue messages went past on staging over a
 * week with no signal at all, which is the same failure mode the alert digest
 * was carefully designed to avoid, pointed inward.
 *
 * Analytics Engine rather than KV or a table, for one reason: queue depth is
 * not readable from a binding, so the only way to know a dead-letter queue is
 * filling is to count messages as they arrive and read the count back later.
 * KV cannot do that — it caps at roughly one write per second per key, and a
 * burst of dead letters is exactly when writes arrive faster than that. A
 * table would put a database write on the failure path, which is the one place
 * it must not be.
 *
 * Writes are fire-and-forget. A counter that can break the thing it measures
 * is worse than no counter.
 */
import type { Env } from "../../env";

export type OpsMetric =
  /** A message that exhausted its retries. The signal that something is stuck. */
  | { kind: "dead_letter"; queue: string }
  /** An unhandled 5xx. Rate, not count, is what matters. */
  | { kind: "server_error"; operation: string }
  /** A scheduled job that threw. Silent by nature, so counted explicitly. */
  | { kind: "maintenance_failed"; job: string }
  /** Every request, so the error rate has a denominator. */
  | { kind: "request"; operation: string };

export function recordMetric(env: Env, metric: OpsMetric): void {
  const dataset = env.OPS_METRICS;
  if (!dataset) return;
  try {
    dataset.writeDataPoint({
      // Blob 1 is the metric name and blob 2 its subject, so a query can group
      // by either without knowing which metric it is looking at.
      blobs: [metric.kind, subjectOf(metric)],
      doubles: [1],
      // Indexed by metric name: the queries are all "how many of X in the last
      // fifteen minutes", and the index is what keeps that cheap.
      indexes: [metric.kind],
    });
  } catch {
    // Never let instrumentation fail a request. If the binding is missing or
    // the write is rejected, the alternative to a missing data point is a 500
    // on a path that was otherwise fine.
  }
}

function subjectOf(metric: OpsMetric): string {
  switch (metric.kind) {
    case "dead_letter":
      return metric.queue;
    case "maintenance_failed":
      return metric.job;
    default:
      return metric.operation;
  }
}
