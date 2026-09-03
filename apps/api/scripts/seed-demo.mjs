/**
 * A believable slice of a working roastery.
 *
 * Everything goes through the API rather than straight into Postgres, so the
 * seed exercises the same validation, ledger and event paths a real user would
 * — a seeder that writes rows directly will happily create states the product
 * cannot, and then the screens built against it are wrong.
 *
 * Local (defaults to the docker Postgres and a key in /tmp/k.json):
 *   node apps/api/scripts/seed-demo.mjs
 *
 * A deployed environment — run bootstrap-org.mjs first for the org and key:
 *   RPC_URL=https://api-staging.roastery.run \
 *   API_KEY=sk_… ORG_ID=… DATABASE_URL=… \
 *   node apps/api/scripts/seed-demo.mjs --yes
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { createRoastSimulator } from "../../../packages/roast-sim/src/index.ts";

const LOCAL_DB = "postgres://roastery:roastery@localhost:55432/roastery";

const KEY = process.env.API_KEY ?? JSON.parse(readFileSync("/tmp/k.json", "utf8")).raw;
const RPC = `${(process.env.RPC_URL ?? "http://localhost:8787").replace(/\/$/, "")}/rpc/v1`;
const ORG = process.env.ORG_ID ?? "11111111-1111-1111-1111-111111111111";
const DB = process.env.DATABASE_URL ?? LOCAL_DB;

// This script TRUNCATES before seeding. Against localhost that is the point;
// anywhere else it needs saying out loud, because the failure mode is silent
// and total.
const isLocal = /localhost|127\.0\.0\.1/.test(DB);
if (!isLocal && !process.argv.includes("--yes")) {
  console.error(
    `Refusing to truncate a non-local database.\n` +
      `  target: ${DB.replace(/\/\/[^@]*@/, "//…@")}\n` +
      `Pass --yes if that is really what you want.`,
  );
  process.exit(1);
}

const client = new pg.Client({ connectionString: DB });
await client.connect();
const sql = async (q) => {
  const result = await client.query(q);
  return result.rows[0] ? Object.values(result.rows[0])[0] : "";
};

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

/** Machine telemetry: a different prefix, a different credential. */
async function ingest(path, token, body) {
  const response = await fetch(`${RPC.replace("/rpc/v1", "")}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const parsed = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${path} → ${response.status} ${JSON.stringify(parsed)}`);
  return parsed;
}

const chunk = (items, size) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, i * size + size),
  );

console.log(`Seeding ${RPC}`);
console.log("Clearing previous demo data…");
await sql(`truncate green_lots, roast_batches, roasted_lots, blends, customers, sales_orders,
     contracts, samples, cupping_sessions, machines, partners, producers, products,
     cafe_sites, cafe_machines, espresso_shots, shot_rollups_hourly, events, audit_events,
     traceability_records, reports, lot_consumption, green_gradings,
     machine_bridge_tokens, roast_profiles
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
        // Wholesale coffee is quoted per kilogram, not per item.
        priceUnit: "kg",
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

/* ------------------------------------------------------- green contracts */
console.log("Contracts…");
const day = 86_400_000;
const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);

const contracts = [];
for (const [number, partnerIndex, producerIndex, weight, price, differential] of [
  ["GC-COL-01", 0, 0, "19320", "5.95", null],
  ["GC-ETH-01", 1, 1, "9660", null, "1.85"],
]) {
  contracts.push(
    await rpc("sourcing.contract.createContract", {
      contractNumber: `${number}-${stamp}`,
      partnerId: partners[partnerIndex].id,
      currency: "USD",
      priceType: differential ? "differential" : "fixed",
      incoterm: "FOB",
      contractDate: isoDay(-45),
      paymentTermsDays: 30,
      lines: [
        {
          description: `${producers[producerIndex].name} — ${producers[producerIndex].region}`,
          producerId: producers[producerIndex].id,
          weightKg: weight,
          bagCount: Math.round(Number(weight) / 69),
          bagWeightKg: "69",
          ...(price ? { unitPrice: price } : { differential, futuresMonth: "2026-12" }),
        },
      ],
    }),
  );
}

// One milestone deliberately OVERDUE. The alert scan and the dashboard's
// "needs attention" panel are only worth looking at when something is.
for (const [contractIndex, kind, dueInDays] of [
  [0, "contract_signed", -40],
  [0, "fixation", -3],
  [0, "vessel_departure", 5],
  [1, "contract_signed", -38],
  [1, "shipment", 12],
]) {
  const milestone = await rpc("sourcing.contract.createContractMilestone", {
    contractId: contracts[contractIndex].id,
    kind,
    dueAt: new Date(Date.now() + dueInDays * day).toISOString(),
  });
  if (kind === "contract_signed") {
    await rpc("sourcing.contract.completeContractMilestone", { id: milestone.id });
  }
}

// A shipment that arrives becomes a green lot, with its cost derived from the
// contract rather than typed in again.
const shipment = await rpc("sourcing.contract.createContractShipment", {
  contractId: contracts[0].id,
  reference: `SHP-${stamp}-01`,
  weightKg: "9660",
  vessel: "MV Cap San Raphael",
  carrier: "Hapag-Lloyd",
  containerNumber: `HLCU${stamp}`,
  portOfLoading: "Cartagena",
  portOfDischarge: "Oakland",
  etd: isoDay(-28),
  eta: isoDay(-4),
  destinationLocationId: roastery.id,
});
const contractDetail = await rpc("sourcing.contract.getContract", { id: contracts[0].id });
await rpc("sourcing.contract.receiveContractShipment", {
  shipmentId: shipment.id,
  locationId: roastery.id,
  lines: [
    {
      contractLineId: contractDetail.lines[0].id,
      weightKg: "9660",
      lotCode: `COL-CT-${stamp}`,
      lotName: "Huila Washed — contract arrival",
    },
  ],
});

/* -------------------------------------------------------------- grading */
console.log("Grading…");
// One pass, one fail. A failing grade quarantines the lot, which is the whole
// point of recording one — a result that is not enforced is decoration.
await rpc("quality.grading.recordGrading", {
  greenLotId: lots[0].id,
  standard: "sca",
  moisturePct: 10.8,
  waterActivity: 0.55,
  screenSizeAvg: 17.2,
  densityGPerL: 712,
  defectsPrimary: 0,
  defectsSecondary: 4,
  notes: "Clean screen, even colour.",
});
await rpc("quality.grading.recordGrading", {
  greenLotId: lots[3].id,
  standard: "sca",
  moisturePct: 13.4,
  waterActivity: 0.68,
  screenSizeAvg: 15.1,
  defectsPrimary: 2,
  defectsSecondary: 9,
  notes: "Over moisture and two full defects. Quarantined pending re-sample.",
});

/* --------------------------------------------------------- roast batches */
console.log("Roasting…");
/**
 * Every batch is roasted for real.
 *
 * `completeRoastBatch` refuses a batch with no telemetry, so there is no
 * shortcut here — the samples go through the ingest endpoint to the Durable
 * Object, and completion reads the curve back out and writes it to Postgres
 * and R2. That is deliberate: it means seeding a demo exercises the live-roast
 * path rather than quietly inserting rows the product could never produce.
 */
const bridgeTokens = new Map();
for (const machine of machines) {
  const issued = await rpc("catalog.machine.issueMachineBridgeToken", {
    machineId: machine.id,
    expiresInHours: 24,
  });
  bridgeTokens.set(machine.id, issued.token);
}

const batches = [];
const ROASTS = [
  [0, 0, 0, 10, "medium", 62],
  [1, 1, 2, 26, "dark", 70],
  [0, 2, 1, 9, "light", 58],
  [2, 0, 0, 30, "medium", 66],
  [1, 1, 4, 24, "medium", 64],
  [0, 2, 1, 11, "light", 60],
];

for (const [machineIndex, profileIndex, lotIndex, chargeKg, level, gas] of ROASTS) {
  const machine = machines[machineIndex];
  const batch = await rpc("production.roast.startRoastBatch", {
    batchNumber: `RB-${stamp}-${batches.length + 1}`,
    machineId: machine.id,
    profileId: profiles[profileIndex].id,
    greenLotId: lots[lotIndex].id,
    chargeWeightKg: String(chargeKg),
    locationId: roastery.id,
  });

  // The same simulator the tests use, so a demo curve and an asserted curve
  // cannot drift apart.
  const sim = createRoastSimulator({
    seed: `${stamp}-${batch.batchNumber}`,
    chargeKg,
    capacityKg: Number(machine.capacityKg ?? chargeKg),
    gas,
    sampleRateHz: 1,
  });
  // Not realtime: a seed should not take twelve minutes per batch. The curve
  // is identical either way; only the wall clock differs.
  const samples = [];
  for await (const sample of sim.stream({ realtime: false })) samples.push(sample);
  const events = sim.emittedEvents;

  // 200 per request is the endpoint's cap: a bridge chunks its buffer rather
  // than sending a whole roast in one POST.
  let seq = 0;
  for (const group of chunk(samples, 200)) {
    await ingest(`/ingest/v1/roast/${batch.id}/samples`, bridgeTokens.get(machine.id), {
      seq: seq++,
      samples: group.map((s) => ({
        t: s.t,
        bt: s.bt,
        et: s.et,
        ror: s.ror,
        gas: s.gas,
        airflow: s.airflow,
        drumRpm: s.drumRpm,
      })),
      // First crack is a SOUND, observed by a person. The bridge carries the
      // operator's marks alongside the probe readings.
      events: events.map((e) => ({ t: e.t, kind: e.kind })),
    });
  }

  const drop = samples.at(-1);
  const completed = await rpc("production.roast.completeRoastBatch", {
    id: batch.id,
    // A believable 14–16% weight loss, from the curve rather than a constant.
    dropWeightKg: (chargeKg * (1 - (0.14 + ((drop?.t ?? 600) % 20) / 1000))).toFixed(4),
    notes: `${level} roast, dropped at ${Math.round(drop?.bt ?? 0)}°C`,
  });
  batches.push(completed);
}

// Completing a batch creates a roasted lot; the batch response does not carry
// its id, so read them back rather than guessing.
const roastedLots = (await rpc("inventory.roast.listRoastedLots", { page: { limit: 50 } })).items;

/* -------------------------------------------------------------- cupping */
console.log("Cupping…");
const session = await rpc("quality.cupping.createCuppingSession", {
  sessionNumber: `CUP-${stamp}-01`,
  name: "Weekly production panel",
  mode: "blind",
  samples: batches.slice(0, 4).map((batch) => ({ roastBatchId: batch.id })),
});

const table = await rpc("quality.cupping.getCuppingTable", { sessionId: session.id });
// Three cuppers, deliberately not identical. A panel with no spread has
// nothing to calibrate against, and the variance is the interesting number.
const CUPPERS = ["Ana", "Priya", "Tom"];
for (const [cupperIndex, cupper] of CUPPERS.entries()) {
  for (const [sampleIndex, sample] of table.samples.entries()) {
    const lean = (cupperIndex - 1) * 0.25;
    const base = 7.25 + ((sampleIndex * 3) % 5) * 0.25;
    const attr = (offset) => Math.min(9.75, Math.max(6, base + offset + lean));
    await rpc("quality.cupping.submitCuppingScore", {
      sessionSampleId: sample.id,
      cupperName: cupper,
      scores: {
        fragrance: attr(0),
        flavor: attr(0.25),
        aftertaste: attr(-0.25),
        acidity: attr(0.5),
        body: attr(0),
        balance: attr(0.25),
        uniformity: 10,
        cleanCup: 10,
        sweetness: 10,
        overall: attr(0.25),
      },
      defectsPenalty: sampleIndex === 3 ? 2 : 0,
      descriptors: ["stone fruit", "cocoa", "citrus"].slice(0, 1 + (sampleIndex % 3)),
      notes: `${cupper}: table ${sampleIndex + 1}`,
    });
  }
}
await rpc("quality.cupping.finalizeCuppingSession", { sessionId: session.id });

/* ----------------------------------------------------------------- café */
console.log("Café…");
const site = await rpc("cafe.createSite", {
  name: "Ferry Building Bar",
  code: `FBB-${stamp}`,
  locationId: roastery.id,
  timezone: "America/Los_Angeles",
});

const barMachines = [];
for (const [name, code, kind, groups] of [
  ["La Marzocco Linea PB", "LM-1", "espresso_machine", 3],
  ["Mahlkönig E80", "GR-1", "grinder", 1],
]) {
  barMachines.push(
    await rpc("cafe.registerMachine", {
      siteId: site.id,
      name,
      code: `${code}-${stamp}`,
      kind,
      groupCount: groups,
      brand: name.split(" ")[0],
    }),
  );
}

const barToken = (
  await rpc("cafe.issueBridgeToken", { cafeMachineId: barMachines[0].id, expiresInHours: 24 })
).token;

/**
 * A day of service on a three-group machine.
 *
 * Group 2 starts channelling partway through service: water finds a path
 * through the puck, so the shot runs SHORT and yields MORE — a high ratio
 * reached quickly. Modelling it as short-and-low instead produces a choked
 * group, which the classifier correctly calls `fast` and which never trips the
 * channelling detector.
 *
 * One failing group hidden behind two healthy ones is the most common real
 * fault on a three-group machine, which is why the live detector judges each
 * group separately rather than averaging the machine.
 */
const shots = [];
const openedAt = new Date(Date.now() - 9 * 3_600_000);
for (let i = 0; i < 240; i++) {
  const group = (i % 3) + 1;
  const drifting = group === 2 && i > 90;
  shots.push({
    externalId: `shot-${stamp}-${i}`,
    machineId: barMachines[0].id,
    groupNumber: group,
    pulledAt: new Date(openedAt.getTime() + i * 90_000).toISOString(),
    doseG: 18 + ((i % 5) - 2) * 0.1,
    // Ratio > 2.6 in under 22s is the signature; in spec is 1.6–2.6 over 22–34s.
    yieldG: drifting ? 48 + (i % 3) : 36 + ((i % 7) - 3) * 0.5,
    durationS: drifting ? 17 + (i % 3) : 27 + ((i % 5) - 2) * 0.4,
    brewTempC: 93 + ((i % 3) - 1) * 0.2,
    peakPressureBar: 9 + ((i % 4) - 2) * 0.1,
    grindSetting: drifting ? "3.8" : "4.2",
    baristaRef: CUPPERS[i % CUPPERS.length],
    discarded: drifting && i % 11 === 0,
  });
}
for (const group of chunk(shots, 200)) {
  await ingest("/ingest/v1/cafe/shots", barToken, { siteId: site.id, shots: group });
}

/* ------------------------------------------------- traceability, reports */
console.log("Certificates and reports…");
for (const lot of roastedLots.slice(0, 3)) {
  await rpc("traceability.issueCertificate", { roastedLotId: lot.id });
}

await rpc("reporting.generateReport", {
  kind: "inventory_valuation",
  title: "Inventory valuation — seed",
  parameters: { locationId: roastery.id },
});

/**
 * Shots are queue-batched, so they are not in Postgres the instant ingest
 * returns 200. Counting immediately reported "0 shots" for a seed that had
 * just posted 240 of them — a number that looks like a failure and is not.
 */
async function settled(table, expected) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const n = Number(await sql(`select count(*) from ${table}`));
    if (n >= expected) return n;
    await sleep(1500);
  }
  return Number(await sql(`select count(*) from ${table}`));
}
await settled("espresso_shots", shots.length);

console.log("\nSeeded:");
for (const [label, table] of [
  ["green lots", "green_lots"],
  ["blends", "blends"],
  ["profiles", "roast_profiles"],
  ["machines", "machines"],
  ["customers", "customers"],
  ["orders", "sales_orders"],
  ["samples", "samples"],
  ["roast batches", "roast_batches"],
  ["roasted lots", "roasted_lots"],
  ["contracts", "contracts"],
  ["gradings", "green_gradings"],
  ["cupping scores", "cupping_scores"],
  ["shots", "espresso_shots"],
  ["certificates", "traceability_records"],
  ["events", "events"],
]) {
  const n = await sql(`select count(*) from ${table}`);
  console.log(`  ${String(n).padStart(4)}  ${label}`);
}

await client.end();
