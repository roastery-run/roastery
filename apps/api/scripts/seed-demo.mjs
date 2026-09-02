/**
 * A believable slice of a working roastery.
 *
 * Everything goes through the API rather than straight into Postgres, so the
 * seed exercises the same validation, ledger and event paths a real user would
 * — a seeder that writes rows directly will happily create states the product
 * cannot, and then the screens built against it are wrong.
 *
 *   node apps/api/scripts/seed-demo.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const KEY = JSON.parse(readFileSync("/tmp/k.json", "utf8")).raw;
const RPC = "http://localhost:8787/rpc/v1";
const ORG = "11111111-1111-1111-1111-111111111111";

const sql = (q) =>
  execFileSync(
    "psql",
    ["-h", "localhost", "-p", "55432", "-U", "roastery", "-d", "roastery", "-tAq", "-c", q],
    {
      env: { ...process.env, PGPASSWORD: "roastery" },
    },
  )
    .toString()
    .trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(op, input) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${RPC}/${op}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${KEY}`,
        "x-roastery-org": ORG,
      },
      body: JSON.stringify(input ?? {}),
    });
    const body = await response.json().catch(() => null);
    if (response.status === 429 && attempt < 8) {
      await sleep(2500);
      continue;
    }
    if (!response.ok) throw new Error(`${op} → ${response.status} ${JSON.stringify(body)}`);
    return body;
  }
}

console.log("Clearing previous demo data…");
sql(`truncate green_lots, roast_batches, roasted_lots, blends, customers, sales_orders,
     contracts, samples, cupping_sessions, machines, partners, producers, products,
     cafe_sites, cafe_machines, espresso_shots, shot_rollups_hourly, events, audit_events,
     traceability_records, reports, lot_consumption
     restart identity cascade`);

const stamp = Date.now() % 100000;

/* ------------------------------------------------------------- catalogue */
console.log("Catalogue…");
const locations = await rpc("catalog.location.listLocations", { page: { limit: 10 } });
const roastery = locations.items[0];

const machines = [];
for (const [code, name, capacity] of [
  ["P12", "Probat P12", 12],
  ["P30", "Probat P30", 30],
  ["LORING-35", "Loring S35 Kestrel", 35],
]) {
  machines.push(
    await rpc("catalog.machine.registerMachine", {
      name,
      code: `${code}-${stamp}`,
      machineType: "drum",
      capacityKg: capacity,
      locationId: roastery.id,
      brand: name.split(" ")[0],
    }),
  );
}

const partners = [];
for (const [name, code, kind] of [
  ["Cafe Imports", "CI", "importer"],
  ["Sucafina Specialty", "SUC", "importer"],
  ["Blue Ridge Wholesale", "BRW", "customer"],
]) {
  partners.push(
    await rpc("catalog.party.createPartner", { name, code: `${code}-${stamp}`, types: [kind] }),
  );
}

const producers = [];
for (const [name, code, country, region, minM, maxM] of [
  ["Finca La Esperanza", "FLE", "CO", "Huila", 1650, 1900],
  ["Konga Cooperative", "KON", "ET", "Yirgacheffe", 1900, 2100],
  ["Fazenda Rainha", "FRA", "BR", "Sul de Minas", 950, 1150],
  ["Hacienda Sonora", "HSO", "CR", "Central Valley", 1200, 1400],
]) {
  producers.push(
    await rpc("catalog.party.createProducer", {
      name,
      code: `${code}-${stamp}`,
      kind: "farm",
      country,
      region,
      altitudeMinM: minM,
      altitudeMaxM: maxM,
    }),
  );
}

for (const [sku, name, format, weight, price] of [
  ["RET-250-HOUSE", "House Blend 250g", "whole_bean", 0.25, "16.50"],
  ["RET-1KG-HOUSE", "House Blend 1kg", "whole_bean", 1, "54.00"],
  ["WHL-5KG-ESP", "Espresso 5kg", "whole_bean", 5, "215.00"],
]) {
  await rpc("catalog.product.createProduct", {
    sku: `${sku}-${stamp}`,
    name,
    format,
    netWeightKg: weight,
    listPrice: Number(price),
    currency: "USD",
  });
}

/* ------------------------------------------------------------ green lots */
console.log("Green coffee…");
const lots = [];
const GREEN = [
  ["Huila Washed", "COL", 0, 1200, "washed", 2026, "5.85"],
  ["Konga Natural", "ETH", 1, 600, "natural", 2026, "8.40"],
  ["Rainha Pulped Natural", "BRA", 2, 1800, "pulped_natural", 2025, "4.15"],
  ["Sonora Honey", "CRI", 3, 450, "honey", 2026, "7.20"],
  ["Huila Decaf EA", "COL-DEC", 0, 300, "washed", 2026, "6.90"],
];
for (const [name, code, producerIndex, weight, process, year, cost] of GREEN) {
  lots.push(
    await rpc("inventory.green.importGreenLot", {
      name,
      lotCode: `${code}-${stamp}`,
      weightKg: String(weight),
      producerId: producers[producerIndex].id,
      partnerId: partners[0].id,
      locationId: roastery.id,
      processMethod: process,
      harvestYear: year,
      unitCost: cost,
      currency: "USD",
      bagCount: Math.round(weight / 69),
      bagWeightKg: "69",
      varieties: ["Caturra", "Castillo"],
      minWeightKg: "150",
    }),
  );
}

// A little movement, so the ledger has something to show.
await rpc("inventory.green.adjustGreenLotQuantity", {
  id: lots[2].id,
  reason: "shrinkage",
  deltaKg: "-12.5",
  comment: "Moisture loss in storage",
});

/* ------------------------------------------------------- roasting and QC */
console.log("Roasting…");
const blends = [];
for (const [name, code, level, decaf] of [
  ["House Blend", "BL-HOUSE", "medium", false],
  ["Morning Light", "BL-LIGHT", "light", false],
  ["Deep French", "BL-FRENCH", "dark", false],
  ["Swiss Water Decaf", "BL-DECAF", "medium", true],
]) {
  blends.push(
    await rpc("inventory.blend.createBlend", {
      name,
      code: `${code}-${stamp}`,
      blendType: "pre_roast",
      targetWeightLossPct: "15.00",
      roastLevel: level,
      isDecaf: decaf,
      components: [
        { greenLotId: lots[0].id, targetRatioPct: "60.0000" },
        { greenLotId: lots[2].id, targetRatioPct: "40.0000" },
      ],
    }),
  );
}

const profiles = [];
for (const [name, code, machineIndex, charge, dropTemp, time] of [
  ["Filter — Huila", "PR-FIL-HUI", 0, "10.0", "201.5", 690],
  ["Espresso — House", "PR-ESP-HSE", 1, "26.0", "208.0", 720],
  ["Omni — Konga", "PR-OMNI-KON", 0, "9.0", "198.5", 645],
]) {
  profiles.push(
    await rpc("production.profile.createProfile", {
      name,
      code: `${code}-${stamp}`,
      machineId: machines[machineIndex].id,
      targetChargeKg: charge,
      targetDropTempC: dropTemp,
      targetTotalTimeS: time,
      targetDtrPct: "21.00",
    }),
  );
}

/* ------------------------------------------------------------ order book */
console.log("Orders…");
const customers = [];
for (const [name, code, type] of [
  ["Blue Ridge Coffee", "BRC", "wholesale"],
  ["Telegraph Cafe", "TEL", "wholesale"],
  ["Ferry Building Market", "FBM", "wholesale"],
  ["Web store", "WEB", "retail"],
]) {
  customers.push(
    await rpc("orders.createCustomer", {
      name,
      code: `${code}-${stamp}`,
      customerType: type,
      currency: "USD",
      paymentTermsDays: type === "wholesale" ? 30 : 0,
    }),
  );
}

const today = new Date();
for (let i = 0; i < 18; i++) {
  const blend = blends[i % blends.length];
  const ship = new Date(today.getTime() + (i % 12) * 86_400_000);
  const order = await rpc("orders.createOrder", {
    orderNumber: `SO-${stamp}-${1000 + i}`,
    customerId: customers[i % customers.length].id,
    channel: i % 4 === 0 ? "webstore" : "direct",
    currency: "USD",
    requestedShipAt: ship.toISOString().slice(0, 10),
    lines: [
      {
        blendId: blend.id,
        description: `${blend.name} whole bean`,
        quantity: "1.0000",
        weightKg: String(5 + ((i * 7) % 40)),
        unitPrice: "18.500000",
      },
    ],
  });
  // Most confirmed, a few left as drafts so both states are visible.
  if (i % 6 !== 0) await rpc("orders.confirmOrder", { id: order.id });
}

/* --------------------------------------------------------------- samples */
console.log("Samples…");
for (let i = 0; i < 6; i++) {
  await rpc("sourcing.sample.createSample", {
    sampleNumber: `SMP-${stamp}-${100 + i}`,
    name: `${producers[i % producers.length].name} offer sample`,
    sampleType: "offer",
    producerId: producers[i % producers.length].id,
    partnerId: partners[i % 2].id,
    weightKg: "0.3500",
  });
}

console.log("\nSeeded:");
for (const [label, table] of [
  ["green lots", "green_lots"],
  ["blends", "blends"],
  ["profiles", "roast_profiles"],
  ["machines", "machines"],
  ["customers", "customers"],
  ["orders", "sales_orders"],
  ["samples", "samples"],
  ["events", "events"],
]) {
  console.log(`  ${String(sql(`select count(*) from ${table}`)).padStart(4)}  ${label}`);
}
