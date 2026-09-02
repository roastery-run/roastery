/**
 * A simulated machine bridge.
 *
 * Stands in for the shop-floor agent that reads a roaster's probes and posts
 * them upstream. Uses the same simulator the tests do, so what a demo shows and
 * what the tests assert cannot drift apart.
 *
 *   node apps/api/scripts/sim-bridge.mjs \
 *     --api http://localhost:8787 --token rb_... --batch <uuid> [--speed 8]
 *
 * Fault injection is the point of the --gap flag: it drops samples for a
 * window, so the resume path has something real to recover.
 */
import { createRoastSimulator } from "../../../packages/roast-sim/src/index.ts";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);

const api = args.api ?? "http://localhost:8787";
const token = args.token;
const batchId = args.batch;
const speed = Number(args.speed ?? 8);
const seed = args.seed ?? "demo";
const gas = Number(args.gas ?? 65);

if (!token || !batchId) {
  console.error("Usage: --token <rb_...> --batch <uuid> [--speed 8] [--gap 120:160]");
  process.exit(1);
}

const sim = createRoastSimulator({ seed, gas });

/**
 * The network gap is simulated HERE, in the bridge, not in the simulator.
 *
 * The distinction matters. `sim.inject({ fault: "network_gap" })` models data
 * the bridge NEVER RECEIVED — a sensor or serial dropout — which no replay can
 * recover, because the samples never existed anywhere. What we want to
 * exercise is the opposite and far more common case: the roast was measured
 * fine, the bridge holds it, and the UPLINK failed. That is recoverable, and
 * recovering it is the whole point of the resume protocol.
 */
let gapFrom = Number.POSITIVE_INFINITY;
let gapTo = Number.NEGATIVE_INFINITY;
if (args.gap) {
  [gapFrom, gapTo] = args.gap.split(":").map(Number);
  console.log(`  simulating an uplink outage from ${gapFrom}s to ${gapTo}s`);
}

let seq = 0;
let buffer = [];
/** What the bridge holds locally, so a refused or lost POST can be replayed. */
const localRing = new Map();

async function post(body) {
  // The outage is bounded by WHEN the request is made, not by which samples it
  // carries. Keying it to the payload would drop the replay too — the outage
  // would follow the data forever and the resume path could never succeed,
  // which is exactly the bug that made this window look unrecoverable.
  if (sim.elapsed >= gapFrom && sim.elapsed <= gapTo) {
    return { status: 0, json: {}, dropped: true };
  }
  const res = await fetch(`${api}/ingest/v1/roast/${batchId}/samples`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function flush(events = []) {
  if (!buffer.length && !events.length) return;
  seq += 1;
  const body = { seq, samples: buffer, events };
  localRing.set(seq, body);
  buffer = [];

  const { status, json, dropped } = await post(body);
  if (dropped) return;

  // The server reports the FIRST sequence it is missing. Replay from there and
  // keep going until it reports none — one pass is not enough, because each
  // replayed batch can reveal the next hole.
  if (json.resumeFrom != null) {
    console.log(`  server is missing seq ${json.resumeFrom}; replaying`);
    let missing = json.resumeFrom;
    let guard = 0;
    while (missing != null && guard++ < 5000) {
      const missed = localRing.get(missing);
      if (!missed) break;
      const replay = await post(missed);
      if (replay.dropped) break;
      missing = replay.json?.resumeFrom ?? null;
    }
    if (missing == null) console.log("  replay complete; server has the full run");
  }
  if (status === 429) {
    console.log("  backpressure; holding");
    await new Promise((r) => setTimeout(r, json.retryAfterMs ?? 1000));
  }
}

console.log(`  streaming batch ${batchId} at ${speed}x`);
let lastFlush = -1;
let sentEvents = 0;

for await (const sample of sim.stream({ realtime: true, speed })) {
  buffer.push(sample);
  // Post about once a second of simulated time, as a real bridge would.
  if (sample.t - lastFlush >= 1) {
    // Every event not yet sent, by index rather than by time — `charge` sits
    // at t=0 and a time comparison silently drops it.
    const due = sim.emittedEvents.slice(sentEvents);
    sentEvents = sim.emittedEvents.length;
    await flush(due.map((e) => ({ t: e.t, kind: e.kind })));
    lastFlush = sample.t;
  }
}

// The drop event is emitted after the loop ends, so it needs a final flush.
await flush(sim.emittedEvents.slice(sentEvents).map((e) => ({ t: e.t, kind: e.kind })));
console.log(`  done: ${seq} posts, roast ended at ${sim.elapsed}s`);
