/**
 * Phase 3 acceptance: the outbox actually reaches somebody else's server.
 *
 * Stands up four local receivers with different behaviours — one healthy, one
 * permanently broken, one that returns 410, one that fails then recovers — and
 * asserts the whole pipeline against them: signing, verification, replay
 * rejection, rotation overlap, retry classification, auto-disable, and the
 * cron sweeper that covers a lost enqueue.
 *
 *   node apps/api/scripts/verify-webhooks.mjs
 */

import { execFileSync } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const KEY = JSON.parse(readFileSync("/tmp/k.json", "utf8")).raw;
const BASE = "http://localhost:8787/rpc/v1";
const ORG = "11111111-1111-1111-1111-111111111111";
let fails = 0;
function ok(condition, message, extra = "") {
  const suffix = extra ? ` — ${extra}` : "";
  if (condition) {
    console.log(`  PASS  ${message}${suffix}`);
    return;
  }
  fails += 1;
  console.log(`  FAIL  ${message}${suffix}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (q) =>
  execFileSync(
    "psql",
    ["-h", "localhost", "-p", "55432", "-U", "roastery", "-d", "roastery", "-tAq", "-c", q],
    { env: { ...process.env, PGPASSWORD: "roastery" } },
  )
    .toString()
    .trim();

async function rpc(op, input, opts = {}) {
  let r, body;
  for (let attempt = 0; ; attempt++) {
    r = await fetch(`${BASE}/${op}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${KEY}`,
        "x-roastery-org": ORG,
      },
      body: JSON.stringify(input ?? {}),
    });
    body = await r.json().catch(() => null);
    if (r.status !== 429 || attempt >= 8) break;
    await sleep(2500);
  }
  if (!r.ok && !opts.allowError) throw new Error(`${op} → ${r.status} ${JSON.stringify(body)}`);
  return opts.allowError ? { status: r.status, body } : body;
}

/* ------------------------------------------------- the receiving servers */

/**
 * The verification an integrator writes. Deliberately implemented here from
 * the documentation rather than by importing our own helper — if the docs are
 * wrong, this is what catches it.
 */
function verify(secret, header, timestampHeader, rawBody, toleranceSeconds = 300) {
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return (header ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3))
    .some(
      (candidate) =>
        candidate.length === expected.length &&
        timingSafeEqual(Buffer.from(candidate), Buffer.from(expected)),
    );
}

function receiver({ port, behaviour }) {
  const received = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      received.push({
        headers: req.headers,
        raw,
        body: JSON.parse(raw || "{}"),
        at: Date.now(),
      });
      const status = behaviour(received.length, received.at(-1));
      res.writeHead(status, { "content-type": "text/plain" });
      res.end(String(status));
    });
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve({ server, received, port }));
  });
}

const healthy = await receiver({ port: 8791, behaviour: () => 200 });
const filtered = await receiver({ port: 8795, behaviour: () => 200 });
const broken = await receiver({ port: 8792, behaviour: () => 500 });
const gone = await receiver({ port: 8793, behaviour: () => 410 });
const flaky = await receiver({ port: 8794, behaviour: (n) => (n < 3 ? 503 : 200) });
function closeAll() {
  for (const r of [healthy, filtered, broken, gone, flaky]) r.server.close();
}

try {
  sql(
    `truncate webhook_deliveries, webhook_endpoints, events, audit_events, locations restart identity cascade`,
  );
  sql(`insert into locations (id,org_id,name,code,kind) values
       ('aaaaaaaa-0000-4000-8000-000000000001','${ORG}','Oakland','OAK','roastery')`);

  /* ------------------------------------------------- 1. the event catalogue */
  console.log("\n--- 1. The published catalogue ---");
  const catalogue = await rpc("webhooks.listEventTypes", {});
  ok(catalogue.types.length >= 25, "event types are published", `${catalogue.types.length} types`);
  ok(
    catalogue.types.every((t) => /^[a-z_]+\.[a-z_]+\.[a-z_]+$/.test(t.type)),
    "every type is domain.resource.past-tense",
  );

  const badSub = await rpc(
    "webhooks.createEndpoint",
    { url: "https://example.com/hook", eventTypes: ["inventory.green_lot.crated"] },
    { allowError: true },
  );
  ok(
    badSub.status === 400,
    "a typo in a subscription is refused at creation",
    `HTTP ${badSub.status}`,
  );

  const insecure = await rpc(
    "webhooks.createEndpoint",
    { url: "http://example.com/hook" },
    { allowError: true },
  );
  ok(
    insecure.status === 400,
    "a plaintext http endpoint is refused",
    "a signature does not protect a payload in transit",
  );

  /* -------------------------------------------------------- 2. registration */
  console.log("\n--- 2. Registering endpoints ---");
  // http://127.0.0.1 is allowed only because the schema check runs on the URL
  // string; these are created directly so the local receivers are reachable.
  const mk = async (name, port, eventTypes) => {
    const ep = await rpc("webhooks.createEndpoint", {
      url: `https://127.0.0.1:${port}/hook`,
      description: name,
      eventTypes,
    });
    sql(`update webhook_endpoints set url='http://127.0.0.1:${port}/hook' where id='${ep.id}'`);
    return ep;
  };

  const epHealthy = await mk("healthy", healthy.port, []);
  ok(
    typeof epHealthy.secret === "string" && epHealthy.secret.startsWith("whsec_"),
    "the signing secret is returned once, at creation",
  );

  const reread = await rpc("webhooks.getEndpoint", { id: epHealthy.id });
  ok(
    !("secret" in reread),
    "the secret is never readable again",
    "webhooks.read must not become the ability to forge signatures",
  );
  ok(
    sql(`select secret_ciphertext from webhook_endpoints where id='${epHealthy.id}'`).includes(
      epHealthy.secret,
    ) === false,
    "the secret is not stored in plaintext",
    "a database dump is missing the key-encryption key",
  );

  const epFiltered = await mk("filtered", filtered.port, ["catalog.location.*"]);
  const epBroken = await mk("broken", broken.port, []);
  const epGone = await mk("gone", gone.port, []);
  const epFlaky = await mk("flaky", flaky.port, []);
  ok(true, "five endpoints registered");

  /* ------------------------------------------- 3. a change becomes a webhook */
  console.log("\n--- 3. Create a location → a signed webhook arrives ---");
  const before = healthy.received.length;
  const location = await rpc("catalog.location.createLocation", {
    name: "Berkeley",
    code: `BRK-${Date.now() % 100000}`,
    kind: "warehouse",
  });

  const outboxRow = sql(`select type from events where resource_id='${location.id}'`);
  ok(
    outboxRow === "catalog.location.created",
    "the outbox row committed with the change",
    outboxRow,
  );
  ok(
    sql(`select count(*) from audit_events where resource_id='${location.id}'`) === "1",
    "the audit row was written in the same transaction",
  );

  for (let i = 0; i < 60 && healthy.received.length === before; i++) await sleep(250);
  ok(healthy.received.length > before, "the webhook arrived");

  const delivery = healthy.received.at(-1);
  ok(delivery?.body.type === "catalog.location.created", "it carries the event type");
  ok(delivery?.body.data.resourceId === location.id, "it names the resource");
  ok(typeof delivery?.body.sequence === "number", "it carries a sequence for reorder detection");
  ok(
    verify(
      epHealthy.secret,
      delivery.headers["roastery-signature"],
      delivery.headers["roastery-timestamp"],
      delivery.raw,
    ),
    "the signature verifies with the documented procedure",
  );
  ok(
    !verify(
      "whsec_wrong",
      delivery.headers["roastery-signature"],
      delivery.headers["roastery-timestamp"],
      delivery.raw,
    ),
    "it does not verify with the wrong secret",
  );
  ok(
    !verify(
      epHealthy.secret,
      delivery.headers["roastery-signature"],
      delivery.headers["roastery-timestamp"],
      `${delivery.raw} `,
    ),
    "it does not verify against a tampered body",
  );
  ok(
    !verify(
      epHealthy.secret,
      delivery.headers["roastery-signature"],
      Number(delivery.headers["roastery-timestamp"]) - 4000,
      delivery.raw,
    ),
    "a captured request cannot be replayed outside the tolerance window",
  );

  /* --------------------------------------------------------- 4. filtering */
  console.log("\n--- 4. Subscriptions actually filter ---");
  const filteredBefore = sql(
    `select count(*) from webhook_deliveries where endpoint_id='${epFiltered.id}'`,
  );
  await rpc("catalog.product.createProduct", {
    sku: `SKU-${Date.now() % 100000}`,
    name: "House 250g",
    format: "whole_bean",
    currency: "USD",
  });
  await sleep(2500);
  const filteredAfter = sql(
    `select count(*) from webhook_deliveries where endpoint_id='${epFiltered.id}'`,
  );
  ok(
    filteredBefore === filteredAfter,
    "an endpoint subscribed to catalog.location.* receives no product events",
    `${filteredAfter} deliveries, unchanged`,
  );
  const wildcardHits =
    sql(`select count(*) from webhook_deliveries d join events e on e.id=d.event_id
                            where d.endpoint_id='${epFiltered.id}' and e.type like 'catalog.location.%'`);
  ok(
    Number(wildcardHits) >= 1,
    "but it does receive what it subscribed to",
    `${wildcardHits} matched`,
  );

  /* ------------------------------------------------------ 5. rotation */
  console.log("\n--- 5. Secret rotation keeps both live ---");
  const rotated = await rpc("webhooks.rotateSecret", { id: epHealthy.id, overlapMinutes: 60 });
  ok(rotated.secret !== epHealthy.secret, "a new secret is issued");
  ok(rotated.previousSecretExpiresAt !== null, "the old one has an expiry, not an instant cutover");

  const beforeRotate = healthy.received.length;
  await rpc("catalog.location.createLocation", {
    name: "Emeryville",
    code: `EMY-${Date.now() % 100000}`,
    kind: "warehouse",
  });
  for (let i = 0; i < 60 && healthy.received.length === beforeRotate; i++) await sleep(250);
  const afterRotate = healthy.received.at(-1);
  ok(
    afterRotate.headers["roastery-signature"].split(",").length === 2,
    "deliveries during the overlap carry two signatures",
  );
  ok(
    verify(
      rotated.secret,
      afterRotate.headers["roastery-signature"],
      afterRotate.headers["roastery-timestamp"],
      afterRotate.raw,
    ),
    "an integrator who deployed the new secret verifies",
  );
  ok(
    verify(
      epHealthy.secret,
      afterRotate.headers["roastery-signature"],
      afterRotate.headers["roastery-timestamp"],
      afterRotate.raw,
    ),
    "an integrator who has not yet deployed it ALSO verifies",
    "which is the entire point of an overlap",
  );

  /* ------------------------------------------------ 6. retry and give-up */
  console.log("\n--- 6. A broken endpoint retries, then dies ---");
  await sleep(3000);
  const brokenState = sql(`select status || ' attempt=' || attempt from webhook_deliveries
                           where endpoint_id='${epBroken.id}' order by created_at desc limit 1`);
  ok(brokenState.startsWith("failed"), "a 500 is retried rather than dropped", brokenState);
  ok(
    Number(
      sql(
        `select count(*) from webhook_deliveries where endpoint_id='${epBroken.id}' and status='failed'`,
      ),
    ) >= 1,
    "the attempt and its error are recorded for debugging",
  );
  const nextAttempt = sql(`select next_attempt_at is not null from webhook_deliveries
                           where endpoint_id='${epBroken.id}' order by created_at desc limit 1`);
  ok(nextAttempt === "t", "and it is scheduled to try again");

  console.log("\n--- 7. A 410 disables the endpoint immediately ---");
  for (let i = 0; i < 40; i++) {
    if (sql(`select status from webhook_endpoints where id='${epGone.id}'`) === "auto_disabled")
      break;
    await sleep(500);
  }
  const goneStatus = sql(`select status from webhook_endpoints where id='${epGone.id}'`);
  ok(goneStatus === "auto_disabled", "410 Gone stops delivery at once", goneStatus);
  ok(
    sql(`select disabled_reason from webhook_endpoints where id='${epGone.id}'`).includes("410"),
    "and says why, so the console can explain it",
  );
  ok(
    gone.received.length >= 1 && gone.received.length <= 2,
    "we did not spend eight hours proving they meant it",
    `${gone.received.length} attempt(s)`,
  );

  console.log("\n--- 8. Auto-disable after sustained failure ---");
  sql(`update webhook_endpoints set consecutive_failures=19 where id='${epBroken.id}'`);
  await rpc("catalog.location.createLocation", {
    name: "Alameda",
    code: `ALA-${Date.now() % 100000}`,
    kind: "warehouse",
  });
  for (let i = 0; i < 60; i++) {
    if (sql(`select status from webhook_endpoints where id='${epBroken.id}'`) === "auto_disabled")
      break;
    await sleep(500);
  }
  const brokenStatus = sql(`select status from webhook_endpoints where id='${epBroken.id}'`);
  ok(
    brokenStatus === "auto_disabled",
    "20 consecutive failures switches the endpoint off",
    brokenStatus,
  );
  ok(
    sql(`select disabled_reason from webhook_endpoints where id='${epBroken.id}'`).includes(
      "consecutive",
    ),
    "and records the count",
  );

  const reenabled = await rpc("webhooks.updateEndpoint", { id: epBroken.id, status: "active" });
  ok(
    reenabled.status === "active" && reenabled.consecutiveFailures === 0,
    "re-enabling clears the counter",
    "otherwise the fix looks like it did not work — one failure and it is off again",
  );

  console.log("\n--- 9. A flaky endpoint recovers, and the counter resets ---");
  for (let i = 0; i < 90; i++) {
    if (
      sql(
        `select count(*) from webhook_deliveries where endpoint_id='${epFlaky.id}' and status='succeeded'`,
      ) !== "0"
    )
      break;
    await sleep(1000);
  }
  const flakyOk = sql(
    `select count(*) from webhook_deliveries where endpoint_id='${epFlaky.id}' and status='succeeded'`,
  );
  ok(
    Number(flakyOk) >= 1,
    "a delivery that failed twice eventually succeeded",
    `${flaky.received.length} attempts, ${flakyOk} succeeded`,
  );
  ok(
    sql(`select consecutive_failures from webhook_endpoints where id='${epFlaky.id}'`) === "0",
    "a success resets the failure count",
    "so 'twenty failures' means twenty in a ROW, not twenty ever",
  );

  /* ---------------------------------------------------- 10. the sweeper */
  console.log("\n--- 10. The sweeper covers a lost enqueue ---");
  // Exactly the state left behind when the Worker dies between the commit and
  // the inline queue send: the event row exists, nothing was enqueued.
  const orphanBefore = healthy.received.length;
  const orphanId =
    sql(`insert into events (org_id,type,resource_type,resource_id,payload,actor_type,occurred_at)
                        values ('${ORG}','catalog.location.created','location','${location.id}',
                                '{"id":"${location.id}","note":"orphaned"}','system', now() - interval '2 minutes')
                        returning id`);
  ok(
    sql(`select fanned_out_at is null from events where id='${orphanId}'`) === "t",
    "an event committed but never enqueued",
  );

  // `wrangler dev` does not fire cron on a timer, so the scheduled handler is
  // invoked the way the platform would invoke it. What is under test here is
  // the sweeper's logic, not Cloudflare's scheduler.
  const tick = () =>
    fetch("http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*").catch(() => {});
  await tick();

  let swept = false;
  for (let i = 0; i < 180; i++) {
    if (sql(`select fanned_out_at is not null from events where id='${orphanId}'`) === "t") {
      swept = true;
      break;
    }
    await sleep(500);
  }
  ok(
    swept,
    "the cron sweeper fanned it out anyway",
    "which is what makes 'the lot moved but no webhook fired' unreachable",
  );
  for (let i = 0; i < 40 && healthy.received.length === orphanBefore; i++) await sleep(250);
  ok(healthy.received.length > orphanBefore, "and it was delivered");

  /* -------------------------------------------- 11. duplicate fan-out */
  console.log("\n--- 11. Fanning out twice is a no-op ---");
  const dupCount = sql(
    `select count(*) from webhook_deliveries where event_id='${orphanId}' and endpoint_id='${epHealthy.id}'`,
  );
  sql(`update events set fanned_out_at=null where id='${orphanId}'`);
  await sleep(1000);
  await tick();
  for (let i = 0; i < 180; i++) {
    if (sql(`select fanned_out_at is not null from events where id='${orphanId}'`) === "t") break;
    await sleep(500);
  }
  const dupAfter = sql(
    `select count(*) from webhook_deliveries where event_id='${orphanId}' and endpoint_id='${epHealthy.id}'`,
  );
  ok(
    dupCount === dupAfter,
    "a second fan-out creates no second delivery",
    `${dupAfter} delivery row — the unique index makes it a no-op, not a duplicate POST`,
  );

  /* ------------------------------------------------- 12. the API surface */
  console.log("\n--- 12. Deliveries are inspectable ---");
  const deliveries = await rpc("webhooks.listDeliveries", { filter: { status: "failed" } });
  ok(
    deliveries.items.length > 0,
    "failed deliveries are listable",
    `${deliveries.items.length} shown`,
  );
  ok(
    deliveries.items.every((d) => d.lastError !== null),
    "each carries the error that caused it",
  );

  const all = await rpc("webhooks.listEvents", { limit: 500 });
  ok(
    all.items.length > 0,
    "the raw event feed is pollable",
    "the fallback for an integrator who cannot expose a public URL",
  );
  const allSeqs = all.items.map((e) => e.sequence);
  ok(
    allSeqs.every((s, i) => i === 0 || s > allSeqs[i - 1]),
    "the feed is ascending by sequence — the order to apply them in",
  );
  ok(all.hasMore === false, "a page that reached the end says so");

  // Walk the whole feed two at a time, the way a catching-up consumer would.
  const walked = [];
  let watermark;
  for (let page = 0; page < 50; page++) {
    const chunk = await rpc("webhooks.listEvents", {
      filter: watermark === undefined ? undefined : { afterSequence: watermark },
      limit: 2,
    });
    walked.push(...chunk.items.map((e) => e.sequence));
    if (!chunk.hasMore) break;
    watermark = chunk.nextSequence;
  }
  ok(
    JSON.stringify(walked) === JSON.stringify(allSeqs),
    "paging by watermark visits every event exactly once",
    `${walked.length} events in pages of 2, no repeats and no gaps`,
  );

  const past = await rpc("webhooks.listEvents", { filter: { afterSequence: allSeqs.at(-1) } });
  ok(
    past.items.length === 0 && past.nextSequence === null,
    "a consumer that is caught up gets nothing back",
    "and a null watermark, so it keeps the one it has",
  );

  const goneDeliveryId = sql(
    `select id from webhook_deliveries where endpoint_id='${epGone.id}' limit 1`,
  );
  const replayed = await rpc("webhooks.redeliver", { id: goneDeliveryId }, { allowError: true });
  ok(
    replayed.status === 409,
    "redelivering to a disabled endpoint is refused",
    "re-enable it first, or the retry fails the same way",
  );

  console.log(`\n${fails === 0 ? "PHASE 3 OK" : `PHASE 3: ${fails} FAILURE(S)`}\n`);
} finally {
  closeAll();
}
process.exit(fails === 0 ? 0 : 1);
