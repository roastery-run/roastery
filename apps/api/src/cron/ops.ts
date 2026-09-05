/**
 * Watching our own failures, the way the product watches a customer's.
 *
 * `cron/alerts.ts` is the customer-facing digest: overdue fixations, lots below
 * their minimum. Nothing was pointed the other way. A week of staging produced
 * sixty errors and thirty dropped queue messages and told nobody, which is
 * precisely the failure the digest's own header warns about — an alerting
 * system fails by being silent or by being muted.
 *
 * So the same discipline applies here. One email per rule per hour, deduped in
 * KV rather than by a check the sender might skip, and a threshold that has to
 * be crossed rather than a notification for every event.
 *
 * The thresholds are evaluated by a pure function, tested, because the one
 * thing worse than no alerting is alerting that is wrong about whether
 * anything is wrong.
 */
import type { Env } from "../env";
import { trySend } from "../lib/email/send";

/** What the Analytics SQL API gives back, one row per metric name. */
export type MetricSample = { kind: string; subject: string; count: number };

export type Threshold = { rule: string; severity: "warning" | "critical"; message: string };

/** Below this, a percentage is noise: one failure in three requests is not 33%. */
const MIN_REQUESTS_FOR_RATE = 20;
const ERROR_RATE_LIMIT = 0.02;

/**
 * Which rules a window of samples trips.
 *
 * Pure and separately tested: this is the judgement, and the surrounding code
 * is only plumbing that fetches rows and sends mail.
 */
export function evaluateThresholds(samples: MetricSample[]): Threshold[] {
  const tripped: Threshold[] = [];
  const total = (kind: string) =>
    samples.filter((s) => s.kind === kind).reduce((sum, s) => sum + s.count, 0);

  // Any dead letter at all. This is not a rate: a message that exhausted every
  // retry is a webhook a customer will never receive, or espresso shots that
  // are gone, and one is worth knowing about.
  const deadLetters = samples.filter((s) => s.kind === "dead_letter");
  if (deadLetters.length > 0) {
    const detail = deadLetters.map((s) => `${s.subject} (${s.count})`).join(", ");
    tripped.push({
      rule: "dead_letters",
      severity: "critical",
      message: `Messages were dead-lettered: ${detail}. They will not be retried again.`,
    });
  }

  const errors = total("server_error");
  const requests = total("request");
  if (requests >= MIN_REQUESTS_FOR_RATE && errors / requests > ERROR_RATE_LIMIT) {
    const pct = ((errors / requests) * 100).toFixed(1);
    tripped.push({
      rule: "error_rate",
      severity: "critical",
      message: `${pct}% of requests failed with a 5xx (${errors} of ${requests}).`,
    });
  }

  const failedJobs = samples.filter((s) => s.kind === "maintenance_failed");
  if (failedJobs.length > 0) {
    const detail = failedJobs.map((s) => `${s.subject} (${s.count})`).join(", ");
    tripped.push({
      rule: "maintenance_failed",
      severity: "warning",
      // A scheduled job's failure is invisible by nature: nobody is waiting on
      // a response, so the only evidence is a log line and this.
      message: `Scheduled work failed: ${detail}.`,
    });
  }

  return tripped;
}

const WINDOW_MINUTES = 15;

export async function checkOpsThresholds(env: Env): Promise<void> {
  const recipient = env.OPS_ALERT_EMAIL;
  if (!recipient || !env.CF_ACCOUNT_ID || !env.CF_ANALYTICS_TOKEN) return;

  let samples: MetricSample[];
  try {
    samples = await querySamples(env);
  } catch (error) {
    console.error(
      JSON.stringify({
        msg: "ops_check_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return;
  }

  for (const threshold of evaluateThresholds(samples)) {
    if (!(await claimHour(env, threshold.rule))) continue;
    const subject = `[ROASTERY ${threshold.severity}] ${threshold.rule.replace(/_/g, " ")}`;
    await trySend(env, {
      to: recipient,
      subject,
      text: threshold.message,
      html: `<p>${threshold.message}</p>`,
    });
  }
}

/**
 * One send per rule per hour.
 *
 * KV rather than the alert_notifications table because this is not tenant
 * data — it belongs to the deployment, not to an organization — but the
 * reasoning is the same one the table's unique index encodes: an alert that
 * repeats every five minutes is an alert somebody silences, and then the next
 * real one goes unread too.
 *
 * Claim-then-send, so two overlapping cron runs cannot both send.
 */
async function claimHour(env: Env, rule: string): Promise<boolean> {
  const hour = new Date().toISOString().slice(0, 13);
  const key = `ops-alert:${rule}:${hour}`;
  const existing = await env.ROASTERY_KV.get(key);
  if (existing) return false;
  await env.ROASTERY_KV.put(key, "1", { expirationTtl: 7200 });
  return true;
}

/**
 * Reads the counters back.
 *
 * Analytics Engine is written from a binding but only read over HTTP, so this
 * is a fetch rather than another binding call.
 */
async function querySamples(env: Env): Promise<MetricSample[]> {
  const sql = `
    SELECT blob1 AS kind, blob2 AS subject, SUM(_sample_interval) AS count
    FROM roastery_ops
    WHERE timestamp > NOW() - INTERVAL '${WINDOW_MINUTES}' MINUTE
    GROUP BY kind, subject
    FORMAT JSON
  `;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}` },
      body: sql,
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error(`Analytics query failed: ${response.status}`);
  const body = (await response.json()) as {
    data?: { kind: string; subject: string; count: string }[];
  };
  return (body.data ?? []).map((row) => ({
    kind: row.kind,
    subject: row.subject,
    count: Number(row.count),
  }));
}
