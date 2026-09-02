import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import { firstMissingSeq } from "../lib/domain/resume";

/**
 * One live roast.
 *
 * A roast is a SESSION: twelve minutes, a single writer, several people
 * watching, and all of its value in the live curve. That is what a Durable
 * Object is for. (An espresso shot is the opposite — an event that is over
 * before anyone looks — which is why shots are queue-batched instead.)
 *
 * Four decisions here are load-bearing:
 *
 * SQLITE, NOT MEMORY. A DO can be evicted mid-roast. Losing the first six
 * minutes of a curve because an isolate was reclaimed is not an acceptable
 * failure for something a roaster cannot repeat.
 *
 * HIBERNATABLE SOCKETS. Twenty idle tablets watching a twelve-minute roast
 * must not bill twelve minutes of wall clock each. Pings are answered without
 * waking the object at all.
 *
 * COALESCED FAN-OUT. Samples arriving at 2 Hz are flushed to viewers on a
 * 250 ms frame, in columnar form. A chart cannot render faster than that, and
 * a burst replay after a reconnect becomes one frame rather than four hundred.
 *
 * BACKPRESSURE BY REFUSAL. The writer is a machine with a local buffer, so
 * refusing a write it can retry is strictly better than growing unbounded
 * memory that eventually takes the roast down with it.
 */

const FLUSH_MS = 250;
const MAX_VIEWERS = 50;
/** Shop-floor wifi half-opens sockets constantly; treat silence as death. */
const STALL_MS = 120_000;
const ABANDON_MS = 15 * 60_000;
const MAX_BUFFERED_SAMPLES = 20_000;
/** The wire schema. Columnar: ~6x smaller than an array of objects. */
const WIRE = ["t", "bt", "et", "ror", "gas", "airflow"] as const;

export type IngestSample = {
  t: number;
  bt: number;
  et?: number;
  ror?: number;
  gas?: number;
  airflow?: number;
  drumRpm?: number;
};

export type IngestBody = {
  seq: number;
  samples: IngestSample[];
  events?: { t: number; kind: string; note?: string }[];
};

export type IngestAck = {
  ok: boolean;
  ackSeq?: number;
  /** Set when the DO noticed a gap; the bridge replays from here. */
  resumeFrom?: number | null;
  error?: string;
  retryAfterMs?: number;
};

type Viewer = { canWrite: boolean; decimate: number };

export class RoastBatchDO extends DurableObject<Env> {
  private pending: number[][] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSeq = -1;
  private lastIngestAt = 0;
  private state: "open" | "roasting" | "cooling" | "complete" | "stalled" = "open";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS samples (
          t REAL PRIMARY KEY, bt REAL, et REAL, ror REAL,
          gas REAL, airflow REAL, drum_rpm REAL);
        CREATE TABLE IF NOT EXISTS events (t REAL, kind TEXT, note TEXT);
        CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
        -- Which sequence numbers have actually arrived. A single high-water
        -- mark cannot express "everything except 680-694", which is exactly
        -- the state an uplink outage leaves behind.
        CREATE TABLE IF NOT EXISTS seqs (seq INTEGER PRIMARY KEY);`);
      this.lastSeq = Number(this.meta("lastSeq") ?? -1);
      this.state = (this.meta("state") as typeof this.state) ?? "open";
    });
    // Answered without waking the object, so an idle viewer costs nothing.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", JSON.stringify({ type: "pong" })),
    );
  }

  private meta(key: string): string | null {
    const row = this.ctx.storage.sql
      .exec<{ v: string }>("SELECT v FROM meta WHERE k = ?", key)
      .toArray()[0];
    return row?.v ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO meta VALUES (?, ?)", key, value);
  }

  /* ------------------------------------------------------------- lifecycle */

  async open(init: { orgId: string; batchId: string; profile?: unknown }): Promise<void> {
    this.setMeta("init", JSON.stringify(init));
    this.state = "open";
    this.setMeta("state", this.state);
    this.lastIngestAt = Date.now();
    await this.ctx.storage.setAlarm(Date.now() + STALL_MS);
  }

  async ingest(body: IngestBody): Promise<IngestAck> {
    if (this.state === "complete") return { ok: false, error: "batch_complete" };

    // A REPLAY carries an OLDER sequence number than the newest one seen, so a
    // simple `seq <= lastSeq` duplicate check rejects exactly the traffic the
    // resume protocol asks for — which silently makes an outage permanent.
    // Instead, record which sequences have arrived and accept any of them.
    // Applying one twice is harmless: samples are keyed by time and written
    // with INSERT OR REPLACE, so the operation is idempotent by construction.
    const alreadySeen =
      this.ctx.storage.sql
        .exec<{ n: number }>("SELECT count(*) AS n FROM seqs WHERE seq = ?", body.seq)
        .toArray()[0]?.n ?? 0;
    if (alreadySeen > 0) {
      return { ok: true, ackSeq: this.lastSeq, resumeFrom: this.firstMissingSeq() };
    }

    const depth =
      this.ctx.storage.sql.exec<{ n: number }>("SELECT count(*) AS n FROM samples").toArray()[0]
        ?.n ?? 0;
    if (depth > MAX_BUFFERED_SAMPLES) {
      // Refuse rather than grow. The bridge holds a local buffer and will
      // retry; unbounded memory here would take the whole roast down.
      return { ok: false, error: "backpressure", retryAfterMs: 1000 };
    }

    for (const s of body.samples) {
      const ror = s.ror ?? this.estimateRor(s.t, s.bt);
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO samples VALUES (?,?,?,?,?,?,?)",
        s.t,
        s.bt,
        s.et ?? null,
        ror,
        s.gas ?? null,
        s.airflow ?? null,
        s.drumRpm ?? null,
      );
      this.pending.push([s.t, s.bt, s.et ?? 0, ror, s.gas ?? 0, s.airflow ?? 0]);
    }

    for (const e of body.events ?? []) {
      this.ctx.storage.sql.exec("INSERT INTO events VALUES (?,?,?)", e.t, e.kind, e.note ?? null);
      this.broadcast({ type: "event", t: e.t, kind: e.kind });
      if (e.kind === "charge") this.state = "roasting";
      this.setMeta("state", this.state);
      if (e.kind === "drop") this.state = "cooling";
      this.setMeta("state", this.state);
    }

    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO seqs VALUES (?)", body.seq);
    this.lastSeq = Math.max(this.lastSeq, body.seq);
    this.lastIngestAt = Date.now();
    this.setMeta("lastSeq", String(this.lastSeq));
    this.scheduleFlush();
    await this.ctx.storage.setAlarm(Date.now() + STALL_MS);

    // Report the FIRST hole rather than a high-water mark, so the bridge
    // replays precisely what is missing instead of everything since the gap.
    return { ok: true, ackSeq: this.lastSeq, resumeFrom: this.firstMissingSeq() };
  }

  /**
   * The lowest sequence number not yet received, or null when the run is
   * contiguous.
   *
   * This is what a bridge needs to know to repair an outage: not "how far did
   * you get" but "what are you missing".
   */
  private firstMissingSeq(): number | null {
    return firstMissingSeq(
      this.ctx.storage.sql
        .exec<{ seq: number }>("SELECT seq FROM seqs ORDER BY seq")
        .toArray()
        .map((r) => r.seq),
    );
  }

  /**
   * Rate of rise from a least-squares fit over a trailing window.
   *
   * Finite differencing between consecutive samples turns +/-0.3 C of
   * thermocouple noise into +/-6 C/min of visual garbage, which is the number
   * a roaster is actually steering by.
   */
  private estimateRor(t: number, bt: number): number {
    const window = this.ctx.storage.sql
      .exec<{ t: number; bt: number }>("SELECT t, bt FROM samples WHERE t >= ? ORDER BY t", t - 30)
      .toArray();
    const points = [...window, { t, bt }];
    if (points.length < 3) return 0;

    const n = points.length;
    let st = 0,
      sb = 0,
      stt = 0,
      stb = 0;
    for (const p of points) {
      st += p.t;
      sb += p.bt;
      stt += p.t * p.t;
      stb += p.t * p.bt;
    }
    const denominator = n * stt - st * st;
    if (denominator === 0) return 0;
    // Slope is C per second; roasters read C per minute.
    return Math.round(((n * stb - st * sb) / denominator) * 60 * 1000) / 1000;
  }

  /** The full curve, for the flush to Postgres and R2. */
  async readCurve(): Promise<{
    samples: {
      t: number;
      bt: number;
      et: number | null;
      ror: number | null;
      gas: number | null;
      airflow: number | null;
    }[];
    events: { t: number; kind: string; note: string | null }[];
    init: unknown;
  }> {
    return {
      samples: this.ctx.storage.sql
        .exec<{
          t: number;
          bt: number;
          et: number | null;
          ror: number | null;
          gas: number | null;
          airflow: number | null;
        }>("SELECT t, bt, et, ror, gas, airflow FROM samples ORDER BY t")
        .toArray(),
      events: this.ctx.storage.sql
        .exec<{ t: number; kind: string; note: string | null }>(
          "SELECT t, kind, note FROM events ORDER BY t",
        )
        .toArray(),
      init: JSON.parse(this.meta("init") ?? "{}"),
    };
  }

  /** Marks the roast finished. The Worker flushes and then calls discard(). */
  async complete(): Promise<void> {
    this.state = "complete";
    this.setMeta("state", this.state);
    this.broadcast({ type: "state", state: "complete" });
  }

  /** Drops the buffered curve. Only ever called after a CONFIRMED write. */
  async discard(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  async status(): Promise<{ state: string; lastSeq: number; sampleCount: number }> {
    return {
      state: this.state,
      lastSeq: this.lastSeq,
      sampleCount:
        this.ctx.storage.sql.exec<{ n: number }>("SELECT count(*) AS n FROM samples").toArray()[0]
          ?.n ?? 0,
    };
  }

  /* -------------------------------------------------------------- sockets */

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.endsWith("/ws")) return new Response("Not found", { status: 404 });
    if (this.ctx.getWebSockets().length >= MAX_VIEWERS) {
      return new Response("Too many viewers", { status: 503 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    if (!server) return new Response("WebSocket error", { status: 500 });

    // Hibernatable: an idle viewer does not bill wall clock.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      canWrite: request.headers.get("X-Viewer-Write") === "1",
      decimate: 1,
    } satisfies Viewer);

    server.send(
      JSON.stringify({
        type: "hello",
        state: this.state,
        init: JSON.parse(this.meta("init") ?? "{}"),
        serverTime: Date.now(),
      }),
    );
    // Backfill so a viewer joining at minute nine sees the whole curve, not
    // just what happens next.
    for (const chunk of this.backfill()) server.send(JSON.stringify(chunk));

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") return;
    let msg: { type?: string; kind?: string; on?: boolean };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const viewer = ws.deserializeAttachment() as Viewer;

    if (msg.type === "mark" && msg.kind) {
      // First crack is a SOUND. The roaster marks it; it is never inferred
      // from the curve, and a viewer without write access cannot fake it.
      if (!viewer.canWrite) {
        ws.send(JSON.stringify({ type: "error", code: "forbidden" }));
        return;
      }
      const t = this.currentT();
      this.ctx.storage.sql.exec("INSERT INTO events VALUES (?,?,?)", t, msg.kind, null);
      this.broadcast({ type: "event", t, kind: msg.kind });
    } else if (msg.type === "lowBandwidth") {
      ws.serializeAttachment({ ...viewer, decimate: msg.on ? 4 : 1 });
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close();
    } catch {
      // Already gone.
    }
  }

  private currentT(): number {
    return (
      this.ctx.storage.sql.exec<{ t: number }>("SELECT max(t) AS t FROM samples").toArray()[0]?.t ??
      0
    );
  }

  private *backfill(chunkSize = 500) {
    const rows = this.ctx.storage.sql
      .exec<{ t: number; bt: number; et: number; ror: number; gas: number; airflow: number }>(
        "SELECT t, bt, coalesce(et,0) et, coalesce(ror,0) ror, coalesce(gas,0) gas, coalesce(airflow,0) airflow FROM samples ORDER BY t",
      )
      .toArray();
    for (let i = 0; i < rows.length; i += chunkSize) {
      yield {
        type: "backfill",
        schema: WIRE,
        samples: rows
          .slice(i, i + chunkSize)
          .map((r) => [r.t, r.bt, r.et, r.ror, r.gas, r.airflow]),
      };
    }
    const events = this.ctx.storage.sql
      .exec<{ t: number; kind: string }>("SELECT t, kind FROM events ORDER BY t")
      .toArray();
    if (events.length) yield { type: "backfillEvents", events };
  }

  /**
   * Coalesces samples into one frame per 250 ms.
   *
   * Sending per sample would mean rate x viewers messages a second for a chart
   * that cannot repaint that fast, and would turn a reconnect's replay burst
   * into hundreds of individual sends.
   */
  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (!this.pending.length) return;
      const batch = this.pending;
      this.pending = [];

      const full = JSON.stringify({ type: "samples", schema: WIRE, samples: batch });
      const thinned = JSON.stringify({
        type: "samples",
        schema: WIRE,
        samples: batch.filter((_, i) => i % 4 === 0),
      });

      for (const ws of this.ctx.getWebSockets()) {
        const viewer = ws.deserializeAttachment() as Viewer;
        try {
          ws.send(viewer?.decimate > 1 ? thinned : full);
        } catch {
          // A dead socket is reaped by the close handler.
        }
      }
    }, FLUSH_MS);
  }

  private broadcast(message: unknown): void {
    const payload = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // Ignore: the close handler reaps it.
      }
    }
  }

  /* ------------------------------------------------------------- watchdog */

  override async alarm(): Promise<void> {
    const idle = Date.now() - this.lastIngestAt;

    if (this.state === "roasting" && idle > STALL_MS) {
      // A half-open socket otherwise leaves a live-looking frozen curve on
      // screen, which is worse than saying the connection is gone.
      this.state = "stalled";
      this.setMeta("state", this.state);
      this.broadcast({ type: "state", state: "stalled" });
    }

    if (idle > ABANDON_MS && this.state !== "complete") {
      // A roaster who walks away from a crashed bridge should find the batch
      // in the log, flagged, rather than silently missing.
      this.state = "complete";
      this.setMeta("state", this.state);
      this.setMeta("abandoned", "1");
      this.broadcast({ type: "state", state: "complete", abandoned: true });
      return;
    }

    await this.ctx.storage.setAlarm(Date.now() + STALL_MS);
  }
}
