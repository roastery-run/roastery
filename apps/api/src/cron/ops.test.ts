import { describe, expect, it } from "vitest";
import { evaluateThresholds, type MetricSample } from "./ops";

/**
 * When to wake somebody up.
 *
 * Both directions are failures. Missing a filling dead-letter queue means a
 * customer discovers their webhooks stopped; alerting every five minutes on
 * something ordinary means the next real alert arrives in a muted channel.
 * That is the argument the customer-facing digest makes for its dedupe index,
 * and it applies to us as much as to a roaster.
 */
const sample = (kind: string, subject: string, count: number): MetricSample => ({
  kind,
  subject,
  count,
});

describe("evaluateThresholds", () => {
  it("says nothing when nothing is wrong", () => {
    expect(evaluateThresholds([sample("request", "/rpc/v1/orders.list", 500)])).toEqual([]);
  });

  it("trips on a single dead letter, because there is no second chance", () => {
    // The message has exhausted every retry. It is a webhook a customer will
    // never receive, or espresso shots that are simply gone.
    const tripped = evaluateThresholds([sample("dead_letter", "roastery-webhooks-dlq", 1)]);
    expect(tripped).toHaveLength(1);
    expect(tripped[0]?.rule).toBe("dead_letters");
    expect(tripped[0]?.severity).toBe("critical");
    expect(tripped[0]?.message).toContain("roastery-webhooks-dlq");
  });

  it("ignores a bad ratio from too few requests", () => {
    // One failure in three is not a 33% error rate, it is one failure. Alerting
    // on it teaches everybody to ignore the channel before real traffic starts.
    expect(
      evaluateThresholds([sample("request", "/health", 3), sample("server_error", "/health", 1)]),
    ).toEqual([]);
  });

  it("trips once the error rate is real", () => {
    const tripped = evaluateThresholds([
      sample("request", "/rpc/v1/orders.list", 100),
      sample("server_error", "/rpc/v1/orders.list", 5),
    ]);
    expect(tripped.map((t) => t.rule)).toEqual(["error_rate"]);
    expect(tripped[0]?.message).toContain("5.0%");
  });

  it("stays quiet at a tolerable error rate", () => {
    expect(
      evaluateThresholds([
        sample("request", "/rpc/v1/orders.list", 1000),
        sample("server_error", "/rpc/v1/orders.list", 10),
      ]),
    ).toEqual([]);
  });

  it("reports scheduled work that failed, which nothing else would surface", () => {
    // Nobody is waiting on a cron's response, so its failure is invisible
    // unless it is counted.
    const tripped = evaluateThresholds([sample("maintenance_failed", "outbox_sweep", 3)]);
    expect(tripped).toHaveLength(1);
    expect(tripped[0]?.rule).toBe("maintenance_failed");
    expect(tripped[0]?.message).toContain("outbox_sweep");
  });

  it("reports every rule that trips, not just the first", () => {
    const tripped = evaluateThresholds([
      sample("dead_letter", "roastery-shots-dlq", 12),
      sample("request", "/rpc/v1/cafe.pos", 200),
      sample("server_error", "/rpc/v1/cafe.pos", 40),
      sample("maintenance_failed", "shot_partitions", 1),
    ]);
    expect(tripped.map((t) => t.rule).sort()).toEqual([
      "dead_letters",
      "error_rate",
      "maintenance_failed",
    ]);
  });
});
