import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { queueRole } from "../src/index";

/**
 * Every queue a config declares must reach a handler.
 *
 * The dispatcher's `default` branch acknowledges messages, on the reasoning
 * that an unknown queue is a configuration problem redelivery cannot fix. That
 * reasoning is sound and the consequence is brutal: staging declared
 * `roastery-events-staging` while the switch matched the literal
 * `roastery-events`, so all 48 seeded events were acked and dropped, the cron
 * sweeper re-enqueued them every minute, and each pass dropped them again.
 * Nothing failed. The API returned 200 to every write.
 *
 * A name is only checkable against the config that declares it, so this test
 * reads the configs rather than a list someone maintains by hand — a new
 * environment or a new queue is covered the moment it is added.
 */

const API_DIR = join(import.meta.dirname, "..");

/** The roles src/index.ts actually switches on. */
const HANDLED = new Set([
  "events",
  "webhooks",
  "shots",
  "reports",
  "maintenance",
  "events-dlq",
  "webhooks-dlq",
  "shots-dlq",
  "reports-dlq",
  "maintenance-dlq",
]);

function configs(): { file: string; queues: string[] }[] {
  return readdirSync(API_DIR)
    .filter((f) => /^wrangler(\..+)?\.jsonc$/.test(f))
    .map((file) => {
      const raw = readFileSync(join(API_DIR, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      const parsed = JSON.parse(raw) as {
        queues?: {
          producers?: { queue: string }[];
          consumers?: { queue: string; dead_letter_queue?: string }[];
        };
      };
      const queues = [
        ...(parsed.queues?.producers ?? []).map((p) => p.queue),
        ...(parsed.queues?.consumers ?? []).flatMap((c) =>
          c.dead_letter_queue ? [c.queue, c.dead_letter_queue] : [c.queue],
        ),
      ];
      return { file, queues: [...new Set(queues)] };
    })
    .filter((c) => c.queues.length > 0);
}

describe("queue dispatch", () => {
  it("finds queues to check", () => {
    // A rename of the config files would otherwise make this suite pass by
    // examining nothing.
    expect(configs().length).toBeGreaterThan(0);
  });

  it("routes every declared queue in every environment to a handler", () => {
    const unrouted = configs().flatMap(({ file, queues }) =>
      queues
        .filter((queue) => !HANDLED.has(queueRole(queue)))
        .map((queue) => `${file}: ${queue} → role "${queueRole(queue)}" has no handler`),
    );

    expect(
      unrouted,
      "These queues reach the dispatcher's default branch, which ACKS and drops " +
        "the message:\n" +
        unrouted.join("\n"),
    ).toEqual([]);
  });

  it("every consumer declares a dead letter queue, except the dead letter queues", () => {
    // A working queue without a DLQ drops poison messages after its retries.
    const missing = readdirSync(API_DIR)
      .filter((f) => /^wrangler(\..+)?\.jsonc$/.test(f))
      .flatMap((file) => {
        const raw = readFileSync(join(API_DIR, file), "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/.*$/gm, "$1");
        const consumers =
          (
            JSON.parse(raw) as {
              queues?: { consumers?: { queue: string; dead_letter_queue?: string }[] };
            }
          ).queues?.consumers ?? [];
        return consumers
          .filter((c) => !queueRole(c.queue).endsWith("-dlq") && !c.dead_letter_queue)
          .map((c) => `${file}: ${c.queue}`);
      });
    expect(missing).toEqual([]);
  });

  it("strips the environment suffix but keeps the dead-letter distinction", () => {
    expect(queueRole("roastery-events")).toBe("events");
    expect(queueRole("roastery-events-staging")).toBe("events");
    expect(queueRole("roastery-events-dlq-staging")).toBe("events-dlq");
    // A queue that merely ends in a word resembling an environment is not one.
    expect(queueRole("roastery-shots")).toBe("shots");
  });
});
