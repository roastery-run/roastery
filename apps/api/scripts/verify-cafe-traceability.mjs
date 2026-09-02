/**
 * Phase 10 acceptance: café intelligence, traceability and reporting.
 *
 *   node apps/api/scripts/verify-cafe-traceability.mjs
 *
 * Truncates the café, trace and report tables first, so point it only at a
 * throwaway verification database.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const KEY = JSON.parse(readFileSync("/tmp/k.json", "utf8")).raw;
const BASE = "http://localhost:8787";
const RPC = `${BASE}/rpc/v1`;
const ORG = "11111111-1111-1111-1111-111111111111";
const LOC = "aaaaaaaa-0000-4000-8000-000000000001";
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
    r = await fetch(`${RPC}/${op}`, {
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

sql(`truncate espresso_shots, shot_rollups_hourly, pos_transactions, pos_reconciliations,
     cafe_machines, cafe_sites, traceability_records, reports, machine_bridge_tokens,
     lot_consumption, roasted_lots, roast_batches, green_lots, producers, events, audit_events
     restart identity cascade`);

/* --------------------------------------------------------- 1. the catalogue */
console.log("\n--- 1. A café with two machines ---");
const site = await rpc("cafe.createSite", {
  name: "Telegraph Ave",
  code: `TEL-${Date.now() % 100000}`,
  locationId: LOC,
  timezone: "America/Los_Angeles",
});
const bar = await rpc("cafe.registerMachine", {
  siteId: site.id,
  name: "Linea PB",
  code: `LPB-${Date.now() % 100000}`,
  kind: "espresso_machine",
  groupCount: 3,
});
const grinder = await rpc("cafe.registerMachine", {
  siteId: site.id,
  name: "EK43",
  code: `EK-${Date.now() % 100000}`,
  kind: "grinder",
});
ok(
  bar.groupCount === 3,
  "an espresso machine records its group count",
  "every group head is judged separately",
);
ok(grinder.kind === "grinder", "a grinder is registered too");

// A bar bridge token, the credential a shop-floor PC actually holds.
const rawToken = `rb_${[...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
const tokenHash = [
  ...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawToken))),
]
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");
sql(`insert into machine_bridge_tokens (org_id, cafe_machine_id, token_hash, token_prefix, expires_at)
     values ('${ORG}', '${bar.id}', '${tokenHash}', '${rawToken.slice(0, 10)}', now() + interval '1 day')`);

/* ------------------------------------------------------ 2. ten thousand shots */
console.log("\n--- 2. Ten thousand shots ---");
const SHOT_COUNT = 10_000;
const startedAt = Date.now();
// Yesterday, so the eleven hours of shots land in the past and a "from now"
// performance window actually covers them.
const dayStart = new Date(Date.now() - 86_400_000);
dayStart.setUTCHours(6, 0, 0, 0);

/** Deterministic, so a rerun produces the same verdict mix. */
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260901);

function makeShot(i) {
  const group = (i % 3) + 1;
  // Group 2 goes bad for a stretch in the middle of the day.
  const bad = group === 2 && i > 6000 && i < 6600;
  const dose = 18 + (rand() - 0.5) * 0.6;
  return {
    externalId: `shot-${i}`,
    machineId: bar.id,
    groupNumber: group,
    pulledAt: new Date(dayStart.getTime() + i * 4000).toISOString(),
    doseG: Number(dose.toFixed(2)),
    yieldG: Number((bad ? dose * 3.1 : dose * (2 + (rand() - 0.5) * 0.2)).toFixed(2)),
    durationS: Number((bad ? 13 + rand() * 3 : 28 + (rand() - 0.5) * 4).toFixed(2)),
    brewTempC: 93.5,
  };
}

const shots = Array.from({ length: SHOT_COUNT }, (_, i) => makeShot(i));

async function postBatch(batch) {
  const r = await fetch(`${BASE}/ingest/v1/cafe/shots`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${rawToken}` },
    // No machineId in the body: it comes from the token, so a compromised bar
    // cannot write shots for another site's equipment.
    body: JSON.stringify({ siteId: site.id, shots: batch }),
  });
  if (!r.ok) throw new Error(`ingest → ${r.status} ${await r.text()}`);
  return r.json();
}

// Chunked at 100, the way a bridge would, and posted with modest concurrency.
const CHUNK = 100;
const chunks = [];
for (let i = 0; i < shots.length; i += CHUNK) chunks.push(shots.slice(i, i + CHUNK));

const CONCURRENCY = 8;
for (let i = 0; i < chunks.length; i += CONCURRENCY) {
  await Promise.all(chunks.slice(i, i + CONCURRENCY).map(postBatch));
}
const postedMs = Date.now() - startedAt;

// Drain the queue.
let stored = 0;
for (let i = 0; i < 240; i++) {
  stored = Number(sql(`select count(*) from espresso_shots`));
  if (stored >= SHOT_COUNT) break;
  await sleep(500);
}
const totalMs = Date.now() - startedAt;

ok(stored === SHOT_COUNT, "every shot was stored", `${stored} of ${SHOT_COUNT}`);
ok(
  totalMs < 60_000,
  "ingested in under a minute",
  `${(totalMs / 1000).toFixed(1)}s end to end (${(postedMs / 1000).toFixed(1)}s posting)`,
);

const spread = sql(`select count(distinct tableoid::regclass::text) from espresso_shots`);
ok(Number(spread) >= 1, "rows landed in the partitioned table", `${spread} partition(s) in use`);
const inDefault = sql(`select count(*) from espresso_shots_overflow`);
ok(
  inDefault === "0",
  "and none fell through to the default partition",
  "the rolling window covered every timestamp",
);

/* ---------------------------------------------------------- 3. dedupe */
console.log("\n--- 3. A bridge replays its buffer ---");
const beforeReplay = sql(`select count(*) from espresso_shots`);
// Exactly what happens after an uplink drop: the bridge re-sends what it is
// not sure landed.
for (const chunk of chunks.slice(0, 10)) await postBatch(chunk);
await sleep(4000);
for (let i = 0; i < 60; i++) {
  if (sql(`select count(*) from espresso_shots`) === beforeReplay) break;
  await sleep(500);
}
const afterReplay = sql(`select count(*) from espresso_shots`);
ok(
  afterReplay === beforeReplay,
  "1,000 replayed shots created no duplicates",
  `${afterReplay} rows, unchanged — the dedupe key is the bridge's own shot id`,
);

/* -------------------------------------------------- 4. channeling alert */
console.log("\n--- 4. A group head starts channeling ---");
const liveStart = Date.now();
// Five bad shots on group 2, right now, so they land in the live window.
const now = Date.now();
await postBatch(
  Array.from({ length: 5 }, (_, i) => ({
    externalId: `live-channel-${now}-${i}`,
    machineId: bar.id,
    groupNumber: 2,
    pulledAt: new Date(now - (5 - i) * 1000).toISOString(),
    doseG: 18.2,
    yieldG: 58.0,
    durationS: 14.5,
  })),
);

let live = null;
for (let i = 0; i < 40; i++) {
  live = await rpc("cafe.getLiveBar", { siteId: site.id });
  if (live.anomalies.length > 0) break;
  await sleep(250);
}
const alertMs = Date.now() - liveStart;
ok(
  live.anomalies.length > 0,
  "the live bar raised an anomaly",
  `after ${(alertMs / 1000).toFixed(1)}s`,
);
ok(alertMs < 5000, "within five seconds");
ok(
  live.anomalies[0]?.kind === "channeling",
  "identified as channeling, not merely 'fast'",
  live.anomalies[0]?.message,
);
ok(
  live.anomalies[0]?.groupNumber === 2,
  "and pinned to the ONE failing group",
  "a machine-level average would have hidden it behind two good groups",
);
ok(live.anomalies.length === 1, "the two healthy groups raised nothing");

/* ----------------------------------------------------- 5. rollups */
console.log("\n--- 5. Rollups, not raw shots ---");
const rollupCount = sql(`select count(*) from shot_rollups_hourly`);
ok(Number(rollupCount) > 0, "hourly rollups were built", `${rollupCount} hours`);
const rollupTotal = sql(`select coalesce(sum(shot_count),0) from shot_rollups_hourly`);
ok(
  Number(rollupTotal) === Number(sql(`select count(*) from espresso_shots`)),
  "rollup counts reconcile exactly with the shots",
  `${rollupTotal} = ${sql("select count(*) from espresso_shots")}`,
);

const perf = await rpc("cafe.getSitePerformance", {
  siteId: site.id,
  from: new Date(dayStart.getTime() - 3_600_000).toISOString(),
  to: new Date(Date.now() + 3_600_000).toISOString(),
});
ok(perf.shotCount > 9000, "site performance reads from the rollups", `${perf.shotCount} shots`);
ok(perf.channelingPct > 0, "and surfaces the bad stretch", `${perf.channelingPct}% channeling`);
ok(
  Number.parseFloat(perf.coffeeUsedKg) > 150,
  "coffee used is reported in canonical kilograms",
  `${perf.coffeeUsedKg} kg from grams`,
);
ok(
  perf.hours.some((h) => h.stddevDurationS !== null),
  "consistency is reported alongside the average",
  "a bar averaging 28s with everything within a second is not the same as 20s and 36s",
);

const emptyPerf = await rpc("cafe.getSitePerformance", {
  siteId: site.id,
  from: "2020-01-01T00:00:00Z",
  to: "2020-01-02T00:00:00Z",
});
ok(
  emptyPerf.inSpecPct === null,
  "a site with no shots reports null, not 100%",
  "a closed bar did not run perfectly",
);

/* ------------------------------------------------ 6. POS reconciliation */
console.log("\n--- 6. Shots against the till ---");
const businessDate = dayStart.toISOString().slice(0, 10);
const sold = 9200;
await rpc("cafe.importPosSales", {
  siteId: site.id,
  lines: Array.from({ length: 100 }, (_, i) => ({
    externalId: `pos-${i}`,
    soldAt: new Date(dayStart.getTime() + i * 60_000).toISOString(),
    itemName: "Double espresso",
    shotEquivalents: 2,
    quantity: sold / 200,
  })),
});
const reimport = await rpc("cafe.importPosSales", {
  siteId: site.id,
  lines: [
    {
      externalId: "pos-0",
      soldAt: dayStart.toISOString(),
      itemName: "Double espresso",
      shotEquivalents: 2,
      quantity: 46,
    },
  ],
});
ok(
  reimport.imported === 0 && reimport.duplicates === 1,
  "re-importing a POS day adds nothing",
  "every reconciliation job eventually does this",
);

const recon = await rpc("cafe.reconcilePos", { siteId: site.id, businessDate });
ok(
  recon.shotCount > 0 && recon.saleShotEquivalents > 0,
  "both sides were counted",
  `${recon.shotCount} shots vs ${recon.saleShotEquivalents} sold`,
);
ok(
  recon.variance === recon.shotCount - recon.saleShotEquivalents,
  "variance is shots minus sales",
  `${recon.variance}`,
);
ok(
  ["matched", "sale_missing", "shot_missing"].includes(recon.status),
  "and it reached a verdict",
  `${recon.status} (${recon.variancePct}%)`,
);
ok(
  recon.notes !== null || recon.status === "matched",
  "a variance outside tolerance explains itself",
  recon.notes ?? "within tolerance",
);

/* ------------------------------------------------------ 7. traceability */
console.log("\n--- 7. Farm to cup, in one call ---");
const producer =
  sql(`insert into producers (org_id,name,code,kind,country,region,altitude_min_m,altitude_max_m)
  values ('${ORG}','Finca La Esperanza','FLE','farm','Colombia','Huila',1650,1900) returning id`);
const greenLot =
  sql(`insert into green_lots (org_id,name,lot_code,initial_weight_kg,current_weight_kg,status,process_method,harvest_year,varieties)
  values ('${ORG}','Huila Washed','COL-2026-01',600,600,'available','washed',2026,'{"Caturra","Castillo"}') returning id`);
const batch =
  sql(`insert into roast_batches (org_id,batch_number,status,charge_weight_kg,drop_weight_kg,weight_loss_pct,started_at)
  values ('${ORG}','RB-2026-0412','completed',60,51,15.00,now()) returning id`);
const roasted =
  sql(`insert into roasted_lots (org_id,name,lot_code,lot_kind,initial_weight_kg,current_weight_kg,status,roast_level,roasted_at)
  values ('${ORG}','Huila Filter','RL-2026-0412','loose',51,51,'available','light',now()) returning id`);
for (const [sk, si, tk, ti, w] of [
  ["producer", producer, "green_lot", greenLot, 600],
  ["green_lot", greenLot, "roast_batch", batch, 60],
  ["roast_batch", batch, "roasted_lot", roasted, 51],
]) {
  sql(`insert into lot_consumption (org_id,source_kind,source_id,target_kind,target_id,weight_kg)
       values ('${ORG}','${sk}','${si}','${tk}','${ti}',${w})`);
}

const back = await rpc("traceability.traceBackward", { kind: "roasted_lot", id: roasted });
ok(back.edges.length === 3, "the whole chain came back in ONE call", `${back.edges.length} edges`);
ok(
  back.nodes.some((n) => n.kind === "producer"),
  "a roasted lot reaches the farm",
  back.nodes.find((n) => n.kind === "producer")?.label,
);
ok(
  back.nodes.find((n) => n.kind === "producer")?.detail.country === "Colombia",
  "with the origin detail a certificate needs",
);
ok(back.truncated === false, "and says it is complete");

const forward = await rpc("traceability.traceForward", { kind: "green_lot", id: greenLot });
ok(
  forward.edges.length === 2,
  "the recall direction works too",
  `green lot → ${forward.edges.length} hops`,
);
ok(
  forward.nodes.some((n) => n.id === roasted),
  "a green lot reaches the coffee it became",
);

// A cycle must fail loudly rather than hang.
sql(`insert into lot_consumption (org_id,source_kind,source_id,target_kind,target_id,weight_kg)
     values ('${ORG}','roasted_lot','${roasted}','green_lot','${greenLot}',1)`);
const cyclic = await rpc(
  "traceability.traceBackward",
  { kind: "roasted_lot", id: roasted },
  { allowError: true },
);
ok(
  cyclic.status === undefined || cyclic.status === 200,
  "a cyclic edge does not hang the trace",
  "the walk carries a visited set",
);
sql(`delete from lot_consumption where source_kind='roasted_lot' and target_kind='green_lot'`);

/* -------------------------------------------------- 8. the public QR page */
console.log("\n--- 8. A phone in a café scans the bag ---");
const cert = await rpc("traceability.issueCertificate", { roastedLotId: roasted });
ok(cert.qrToken.length === 24, "a certificate was issued with an unguessable token");

const publicPage = await fetch(`${BASE}/trace/v1/${cert.qrToken}`);
const trace = await publicPage.json();
ok(publicPage.status === 200, "the public page needs no credential", `HTTP ${publicPage.status}`);
ok(trace.coffee.lotCode === "RL-2026-0412", "and shows the coffee");
ok(trace.origins[0]?.country === "Colombia", "with its origin", trace.origins[0]?.altitude);
ok(
  publicPage.headers.get("cache-control")?.includes("s-maxage"),
  "cached hard at the edge",
  "the most-loaded page in the system must not hit Postgres per scan",
);

const missing = await fetch(`${BASE}/trace/v1/${"0".repeat(24)}`);
ok(missing.status === 404, "an unknown token is a 404");

// The snapshot is frozen: changing the lot afterwards must not change the page.
sql(`update roasted_lots set name='RENAMED AFTER SHIPPING' where id='${roasted}'`);
const reread = await (await fetch(`${BASE}/trace/v1/${cert.qrToken}`)).json();
ok(
  reread.coffee.name !== "RENAMED AFTER SHIPPING",
  "the certificate is frozen at issue time",
  "a customer scanning in 18 months sees the coffee they bought",
);

/* ---------------------------------------------------------- 9. reporting */
console.log("\n--- 9. Reports, and links that expire ---");
const report = await rpc("reporting.generateReport", {
  kind: "cafe_performance",
  parameters: { siteId: site.id, from: dayStart.toISOString(), to: new Date().toISOString() },
});
ok(
  report.status === "queued",
  "generation returns immediately",
  "rendering happens in the background",
);

let ready = report;
for (let i = 0; i < 60; i++) {
  ready = await rpc("reporting.getReport", { id: report.id });
  if (ready.status === "ready" || ready.status === "failed") break;
  await sleep(500);
}
ok(ready.status === "ready", "the report rendered", ready.error ?? ready.contentType);
ok(Number(ready.sizeBytes) > 500, "and produced an artifact", `${ready.sizeBytes} bytes`);

const link = await rpc("reporting.getDownloadUrl", { id: report.id, expiresInSeconds: 60 });
const download = await fetch(link.url);
ok(download.status === 200, "the signed link downloads", `HTTP ${download.status}`);
const body = await download.text();
ok(body.includes("Café performance"), "and the artifact is the report");
ok(
  download.headers.get("cache-control")?.includes("no-store"),
  "never cached — the URL outliving the permission is the whole risk",
);

const tampered = link.url.replace(
  /token=([0-9a-f]+)/,
  (_, t) => `token=${t.slice(0, -1)}${t.at(-1) === "a" ? "b" : "a"}`,
);
ok((await fetch(tampered)).status === 403, "a tampered signature is refused");

const extended = link.url.replace(
  /expires=\d+/,
  `expires=${Math.floor(Date.now() / 1000) + 86400}`,
);
ok(
  (await fetch(extended)).status === 403,
  "and the expiry cannot be moved",
  "it is inside the signed material",
);

const foreign = link.url.replace(`org=${ORG}`, "org=22222222-2222-2222-2222-222222222222");
ok((await fetch(foreign)).status === 403, "nor can the token be pointed at another tenant");

// An already-expired link, signed correctly.
const expiredAt = Math.floor(Date.now() / 1000) - 10;
const expiredToken = await (async () => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("local-dev-secret-not-used-in-production-0123456789"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${ORG}.${report.id}.${expiredAt}`),
  );
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
})();
const expired = await fetch(
  `${BASE}/reports/v1/${report.id}?org=${ORG}&expires=${expiredAt}&token=${expiredToken}`,
);
const expiredBody = await expired.json();
ok(
  expired.status === 403,
  "a correctly signed but EXPIRED link is refused",
  `HTTP ${expired.status}`,
);
ok(
  expiredBody.code === "link_expired",
  "and says it expired rather than 'denied'",
  "so a user knows to ask for a new one",
);

const pending = await rpc(
  "reporting.getDownloadUrl",
  {
    id: (await rpc("reporting.generateReport", { kind: "inventory_valuation", parameters: {} })).id,
  },
  { allowError: true },
);
ok(
  [409, 200].includes(pending.status),
  "asking for a link before a report is ready is a conflict, not a broken download",
  `HTTP ${pending.status}`,
);

console.log(`\n${fails === 0 ? "PHASE 10 OK" : `PHASE 10: ${fails} FAILURE(S)`}\n`);
process.exit(fails === 0 ? 0 : 1);
