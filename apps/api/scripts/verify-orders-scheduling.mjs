/**
 * Phase 9 acceptance: forty orders become a roast day.
 *
 * Run against a local worker with a seeded org and an owner API key:
 *   node apps/api/scripts/verify-orders-scheduling.mjs
 *
 * It truncates the order, blend, roasted-lot and machine tables first, so
 * point it only at a throwaway verification database.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const KEY = JSON.parse(readFileSync("/tmp/k.json", "utf8")).raw;
const BASE = "http://localhost:8787/rpc/v1";
const ORG = "11111111-1111-1111-1111-111111111111";
const LOC = "aaaaaaaa-0000-4000-8000-000000000001";
let fails = 0;
const ok = (c, m, extra = "") =>
  c
    ? console.log(`  PASS  ${m}${extra ? ` — ${extra}` : ""}`)
    : (fails++, console.log(`  FAIL  ${m}${extra ? ` — ${extra}` : ""}`));

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
  // The burst limiter is deliberately tight; a seeding loop is exactly the
  // runaway it exists to cap, so back off rather than disable it.
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
    await new Promise((res) =>
      setTimeout(res, Number(r.headers.get("retry-after") ?? 2) * 1000 + 250),
    );
  }
  if (!r.ok && !opts.allowError) throw new Error(`${op} → ${r.status} ${JSON.stringify(body)}`);
  return opts.allowError ? { status: r.status, body } : body;
}

sql(`truncate scheduled_batches, production_schedules, allocations, fulfillments,
     sales_order_lines, sales_orders, customers, blend_components, blends,
     roasted_lots, machines restart identity cascade`);

/* ---------------------------------------------------------- 1. catalog */
console.log("\n--- 1. Catalog: roasters and blends ---");
const machines = [];
for (const [code, name, cap] of [
  ["P12", "Probat P12", 12],
  ["P30", "Probat P30", 30],
]) {
  machines.push(
    await rpc("catalog.machine.registerMachine", {
      name,
      code,
      machineType: "drum",
      capacityKg: cap,
      locationId: LOC,
    }),
  );
}
ok(
  machines.length === 2,
  "two roasters registered",
  machines.map((m) => `${m.code} ${m.capacityKg}kg`).join(", "),
);

// Component stock for the blend recipes. Roasted lots normally arrive by
// completing a roast batch (proven in phase 7); here they are fixtures.
sql(`insert into roasted_lots (id,org_id,name,lot_code,lot_kind,initial_weight_kg,current_weight_kg,status,location_id)
     values ('bbbbbbbb-0000-4000-8000-000000000001','${ORG}','Component','CMP-1','loose',0,0,'available','${LOC}')`);

const blendDefs = [
  ["Morning Light", "BL-LIGHT", "light", false],
  ["Signature Espresso", "BL-ESP", "medium", false],
  ["Deep French", "BL-FRENCH", "dark", false],
  ["Swiss Water Decaf", "BL-DECAF", "medium", true],
  ["Seasonal Unspecified", "BL-SEASON", null, false],
];
const blends = {};
for (const [name, code, roastLevel, isDecaf] of blendDefs) {
  blends[code] = await rpc("inventory.blend.createBlend", {
    name,
    code,
    blendType: "post_roast",
    targetWeightLossPct: "15.00",
    ...(roastLevel ? { roastLevel } : {}),
    isDecaf,
    components: [
      { roastedLotId: "bbbbbbbb-0000-4000-8000-000000000001", targetRatioPct: "100.0000" },
    ],
  });
}
ok(
  Object.keys(blends).length === 5,
  "five blends created",
  Object.values(blends)
    .map((b) => `${b.code}=${b.roastLevel ?? "?"}${b.isDecaf ? "/decaf" : ""}`)
    .join(" "),
);

/* -------------------------------------------- 2. roasted stock on hand */
console.log("\n--- 2. Roasted stock on the shelf ---");
// Only BL-LIGHT and BL-ESP have finished stock, and not enough of it. The rest
// of the order book has to be produced.
const stock = [
  ["BL-LIGHT", "RL-LIGHT-A", 40, "2026-09-20"],
  ["BL-LIGHT", "RL-LIGHT-B", 25, "2026-09-12"],
  ["BL-ESP", "RL-ESP-A", 30, "2026-09-18"],
];
for (const [blendCode, lotCode, weight, bb] of stock) {
  sql(`insert into roasted_lots (org_id,name,lot_code,lot_kind,blend_id,initial_weight_kg,current_weight_kg,status,location_id,roasted_at,best_before_at)
       values ('${ORG}','${blendCode} stock','${lotCode}','blended','${blends[blendCode].id}',${weight},${weight},'available','${LOC}',now(),'${bb}')`);
}
ok(
  Number(
    sql("select count(*) from roasted_lots where status='available' and current_weight_kg>0"),
  ) === 3,
  "three roasted lots available",
  "95 kg total",
);

/* ------------------------------------------------- 3. the order book */
console.log("\n--- 3. Forty orders ---");
const customers = [];
for (let i = 0; i < 8; i++) {
  customers.push(
    await rpc("orders.createCustomer", {
      name: `Cafe ${String.fromCharCode(65 + i)}`,
      code: `CUST-${i + 1}`,
      customerType: i < 5 ? "wholesale" : "retail",
      currency: "USD",
    }),
  );
}

// Deterministic spread so the run is reproducible.
const codes = ["BL-LIGHT", "BL-ESP", "BL-FRENCH", "BL-DECAF", "BL-SEASON"];
const orders = [];
for (let i = 0; i < 40; i++) {
  const blendCode = codes[i % codes.length];
  const weightKg = (4 + ((i * 7) % 22)).toFixed(4);
  const o = await rpc("orders.createOrder", {
    orderNumber: `SO-${1000 + i}`,
    customerId: customers[i % customers.length].id,
    channel: i % 4 === 0 ? "webstore" : "direct",
    currency: "USD",
    requestedShipAt: `2026-09-${String(5 + (i % 10)).padStart(2, "0")}`,
    lines: [
      {
        blendId: blends[blendCode].id,
        description: `${blends[blendCode].name} whole bean`,
        quantity: "1.0000",
        weightKg,
        unitPrice: "18.500000",
      },
    ],
  });
  orders.push(o);
}
ok(orders.length === 40, "40 orders created", `SO-1000..SO-${1000 + 39}`);

const draftDemand = await rpc("production.schedule.listDemandAggregate", {});
ok(
  draftDemand.items.length === 0,
  "a DRAFT order is not demand",
  "drafts must not reach the roasting floor",
);

for (const o of orders) await rpc("orders.confirmOrder", { id: o.id });
ok(true, "40 orders confirmed");

/* ------------------------------------------------------ 4. allocation */
console.log("\n--- 4. Allocate what is already on the shelf ---");
let allocated = 0,
  shortfalls = 0,
  fefoOk = true;
for (const o of orders) {
  const res = await rpc("orders.allocateOrder", { id: o.id, strategy: "fefo" });
  for (const line of res.lines) {
    if (Number(line.allocatedKg) > 0) allocated += Number(line.allocatedKg);
    if (Number(line.shortfallKg) > 0) shortfalls++;
    // FEFO: within one allocation the picks must be in non-decreasing
    // best-before order.
    const dates = line.picks.map((p) => p.bestBeforeAt).filter(Boolean);
    for (let i = 1; i < dates.length; i++) if (dates[i] < dates[i - 1]) fefoOk = false;
  }
}
ok(allocated > 0, "stock committed to orders", `${allocated.toFixed(4)} kg allocated`);
ok(fefoOk, "picks follow first-expiry-first-out");
const remainingStock = Number(
  sql(
    "select coalesce(sum(current_weight_kg - reserved_weight_kg),0) from roasted_lots where blend_id is not null",
  ),
);
ok(
  Math.abs(allocated + remainingStock - 95) < 0.001,
  "allocation reserves without moving stock",
  `${allocated.toFixed(2)} reserved + ${remainingStock.toFixed(2)} free = 95 kg still on hand`,
);
ok(
  shortfalls > 0,
  "unmet demand reported as shortfall, not silent success",
  `${shortfalls} short lines`,
);

/* -------------------------------------------------------- 5. demand */
console.log("\n--- 5. What production still has to cover ---");
const demand = await rpc("production.schedule.listDemandAggregate", {});
ok(
  demand.items.length === 5,
  "40 orders merge into 5 requirements",
  `${demand.totalRoastedKg} kg outstanding`,
);
const decafPos = demand.items.findIndex((d) => d.label.includes("Decaf"));
ok(decafPos === demand.items.length - 1, "decaf ranked last in the demand preview");
for (const d of demand.items)
  console.log(
    `        ${d.label.padEnd(24)} ${String(d.roastedKg).padStart(10)} kg  from ${d.orderLineCount} lines  due ${d.dueAt}`,
  );

/* ------------------------------------------------------ 6. schedule */
console.log("\n--- 6. Generate the roast day ---");
const schedule = await rpc("production.schedule.generateProductionSchedule", {
  name: "Tuesday roast",
  scheduledDate: "2026-09-02",
  locationId: LOC,
  maxBatchesPerMachine: 18,
});
ok(schedule.status === "draft", "generated as a DRAFT for human release");

const byMachine = new Map(machines.map((m) => [m.id, m.code]));
const codeOf = (id) => Object.keys(blends).find((c) => blends[c].id === id);
const defOf = (id) => blendDefs.find(([, c]) => c === codeOf(id));

console.log("        pos  machine  blend                     charge     yield");
for (const b of schedule.batches) {
  console.log(
    `        ${String(b.position).padStart(3)}  ${(byMachine.get(b.machineId) ?? "?").padEnd(7)}  ${(defOf(b.blendId)?.[0] ?? "?").padEnd(24)} ${String(b.plannedChargeKg).padStart(9)} ${String(b.plannedYieldKg).padStart(9)}`,
  );
}

const rank = { light: 1, medium: 2, dark: 3 };
const rankOf = (id) => {
  const d = defOf(id);
  return d?.[3] ? 100 : (rank[d?.[2]] ?? 2.5);
};

// Each machine runs its own queue, so the sequence is checked per machine.
let monotonic = true;
let decafLast = true;
let contiguous = true;
for (const [machineId, code] of byMachine) {
  const queue = schedule.batches
    .filter((b) => b.machineId === machineId)
    .sort((a, b) => a.position - b.position);
  if (!queue.length) continue;
  for (let i = 1; i < queue.length; i++) {
    if (rankOf(queue[i].blendId) < rankOf(queue[i - 1].blendId)) monotonic = false;
  }
  if (!defOf(queue.at(-1).blendId)?.[3]) decafLast = false;
  const runs = [];
  for (const b of queue) if (runs.at(-1) !== b.blendId) runs.push(b.blendId);
  if (runs.length !== new Set(runs).size) contiguous = false;
  console.log(
    `        ${code}: ${queue.map((b) => codeOf(b.blendId).replace("BL-", "")).join(" → ")}`,
  );
}
ok(monotonic, "each drum runs light → medium → unknown → dark → decaf");
ok(decafLast, "decaf is the last batch on every drum that runs it");
ok(contiguous, "each blend is one contiguous run — no changeover repeated");

const capOf = new Map(machines.map((m) => [m.id, Number(m.capacityKg)]));
const overCapacity = schedule.batches.filter(
  (b) => Number(b.plannedChargeKg) > capOf.get(b.machineId) + 1e-9,
);
ok(
  overCapacity.length === 0,
  "no batch exceeds the drum it is assigned to",
  `largest charge ${Math.max(...schedule.batches.map((b) => Number(b.plannedChargeKg))).toFixed(2)} kg`,
);
ok(
  new Set(schedule.batches.map((b) => b.machineId)).size === 2,
  "work spread across both roasters",
);

// A requirement is spread across drums, not queued behind one.
const bigBlend = blends["BL-DECAF"].id;
ok(
  new Set(schedule.batches.filter((b) => b.blendId === bigBlend).map((b) => b.machineId)).size ===
    2,
  "a large requirement is split across drums, not pinned to one",
);

ok(
  schedule.batches.every((b) => b.demandLineIds.length > 0),
  "every batch names the order lines it satisfies",
);

const plannedYield = schedule.batches.reduce((s, b) => s + Number(b.plannedYieldKg), 0);
ok(
  Math.abs(plannedYield - Number(demand.totalRoastedKg)) < 1,
  "planned yield covers the outstanding demand",
  `${plannedYield.toFixed(2)} kg planned vs ${demand.totalRoastedKg} kg needed`,
);
for (const n of schedule.feasibilityNotes) console.log(`        note: ${n}`);
ok(schedule.feasibilityNotes.length === 0, "a plan that covers the book carries no warnings");

console.log("\n--- 7. A day that does NOT fit ---");
const tight = await rpc("production.schedule.generateProductionSchedule", {
  name: "Short shift",
  scheduledDate: "2026-09-03",
  locationId: LOC,
  maxBatchesPerMachine: 10,
});
for (const n of tight.feasibilityNotes) console.log(`        ${n}`);
ok(
  tight.feasibilityNotes.length === 2,
  "two shortfalls flagged on the plan itself",
  `${tight.feasibilityNotes.length} notes`,
);
ok(
  tight.feasibilityNotes.every((n) => /kg unplanned/.test(n)),
  "each note says how much is unplanned, not merely that something failed",
);
ok(
  tight.batches.length > 0 && tight.batches.length < schedule.batches.length,
  "the short shift still plans what it can",
  `${tight.batches.length} of ${schedule.batches.length} batches`,
);

/* --------------------------------------------------------- 8. release */
console.log("\n--- 8. Release to the floor ---");
const released = await rpc("production.schedule.releaseScheduleToProduction", { id: schedule.id });
ok(released.status === "released", "schedule released");
const again = await rpc(
  "production.schedule.releaseScheduleToProduction",
  { id: schedule.id },
  { allowError: true },
);
ok(
  again.status === 409,
  "releasing twice is a conflict, not a second release",
  `HTTP ${again.status}`,
);

const fetched = await rpc("production.schedule.getProductionSchedule", { id: schedule.id });
ok(
  fetched.batches.length === schedule.batches.length && fetched.status === "released",
  "a roaster can fetch the released sequence",
  `${fetched.batches.length} batches in order`,
);

/* --------------------------------------------------------- 9. authz */
console.log("\n--- 9. Authorization still holds ---");
const noCred = await fetch(`${BASE}/orders.listOrders`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{",
});
ok(
  noCred.status === 401,
  "malformed body with no credential is 401, never 400",
  `HTTP ${noCred.status}`,
);
const foreign = await fetch(`${BASE}/orders.listOrders`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${KEY}`,
    "x-roastery-org": "22222222-2222-2222-2222-222222222222",
  },
  body: "{}",
});
ok(foreign.status === 403, "a foreign org header is refused", `HTTP ${foreign.status}`);

console.log(`\n${fails === 0 ? "PHASE 9 OK" : `PHASE 9: ${fails} FAILURE(S)`}\n`);
process.exit(fails === 0 ? 0 : 1);
