/**
 * One Durable Object per café SITE.
 *
 * The cardinality boundary is the whole design here. A roast is a session —
 * twelve minutes, one writer, a live audience — so it gets an object each. A
 * shot is an event: 28 seconds, already over before anyone looks, and a
 * twenty-group chain still only produces about 0.1 writes a second in
 * aggregate. An object per MACHINE would be thousands of objects each handling
 * one write every few minutes: maximum cost, minimum benefit.
 *
 * A SITE earns one, because a site is where somebody is standing. The manager
 * watching the bar wants a live view, and the five-minute anomaly window that
 * tells them a group head is channeling has to be in memory to answer in
 * seconds rather than on the next fifteen-minute rollup.
 *
 * Shots still reach Postgres through the queue, not through here. This object
 * is a live view, never the system of record — losing it costs a dashboard,
 * not data.
 */
import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import { type Anomaly, detectAnomalies, type ShotVerdict } from "../lib/domain/espresso";

export type LiveShot = {
  externalId: string;
  machineId: string;
  groupNumber: number;
  pulledAt: number;
  doseG: number | null;
  yieldG: number | null;
  durationS: number | null;
  ratio: number | null;
  verdict: ShotVerdict;
};

type SocketMeta = { orgId: string; siteId: string };

/** How much history the live view keeps. Beyond this, ask the database. */
const WINDOW_MS = 5 * 60_000;
const MAX_BUFFERED = 500;

/** Re-alerting on the same group before this has elapsed is noise, not news. */
const ALERT_COOLDOWN_MS = 5 * 60_000;

export class CafeSiteDO extends DurableObject<Env> {
  private shots: LiveShot[] = [];
  private lastAlertAt = new Map<string, number>();
  private siteId: string | null = null;
  private orgId: string | null = null;

  /**
   * Records shots and returns anything worth interrupting somebody about.
   *
   * Called from the queue consumer AFTER the database write, so the live view
   * can never show a shot that failed to persist.
   */
  async record(input: {
    orgId: string;
    siteId: string;
    shots: LiveShot[];
  }): Promise<{ anomalies: Anomaly[]; windowSize: number }> {
    this.orgId = input.orgId;
    this.siteId = input.siteId;

    this.shots.push(...input.shots);
    this.prune();

    const anomalies = detectAnomalies(
      this.shots.map((s) => ({
        pulledAt: s.pulledAt,
        verdict: s.verdict,
        groupNumber: s.groupNumber,
      })),
    );

    // Per machine AND group: two machines at one site can each have a bad
    // group, and suppressing the second because the first already alerted
    // would hide a real fault.
    const fresh: Anomaly[] = [];
    const now = Date.now();
    for (const anomaly of anomalies) {
      const machineId = this.shots.find((s) => s.groupNumber === anomaly.groupNumber)?.machineId;
      const key = `${machineId ?? "?"}:${anomaly.groupNumber}:${anomaly.kind}`;
      const last = this.lastAlertAt.get(key) ?? 0;
      if (now - last < ALERT_COOLDOWN_MS) continue;
      this.lastAlertAt.set(key, now);
      fresh.push(anomaly);
    }

    if (input.shots.length > 0) {
      this.broadcast({ type: "shots", shots: input.shots });
    }
    for (const anomaly of fresh) {
      this.broadcast({ type: "anomaly", anomaly });
    }

    return { anomalies: fresh, windowSize: this.shots.length };
  }

  /** The live bar view: what has happened in the last five minutes. */
  async snapshot(): Promise<{
    siteId: string | null;
    shots: LiveShot[];
    anomalies: Anomaly[];
    watchers: number;
  }> {
    this.prune();
    return {
      siteId: this.siteId,
      shots: [...this.shots].sort((a, b) => b.pulledAt - a.pulledAt),
      anomalies: detectAnomalies(
        this.shots.map((s) => ({
          pulledAt: s.pulledAt,
          verdict: s.verdict,
          groupNumber: s.groupNumber,
        })),
      ),
      watchers: this.ctx.getWebSockets().length,
    };
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade") !== "websocket") {
      return Response.json({ error: "Expected a websocket upgrade" }, { status: 426 });
    }

    const orgId = url.searchParams.get("orgId");
    const siteId = url.searchParams.get("siteId");
    if (!orgId || !siteId) {
      return Response.json({ error: "orgId and siteId are required" }, { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // Hibernatable. A manager leaves the bar view open all day; without this
    // an idle tab bills wall-clock for every hour it is on screen.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ orgId, siteId } satisfies SocketMeta);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        JSON.stringify({ type: "ping" }),
        JSON.stringify({ type: "pong" }),
      ),
    );

    this.prune();
    server.send(
      JSON.stringify({
        type: "snapshot",
        shots: [...this.shots].sort((a, b) => b.pulledAt - a.pulledAt).slice(0, 50),
      }),
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    ws.close();
  }

  private broadcast(message: unknown): void {
    const payload = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {
        // A socket that died between the roster read and the send. The next
        // close event removes it; failing the whole batch for one dead tab
        // would drop the broadcast for everyone else.
      }
    }
  }

  private prune(): void {
    const cutoff = Date.now() - WINDOW_MS;
    this.shots = this.shots.filter((s) => s.pulledAt >= cutoff);
    // A bar bridge replaying a large buffer could otherwise push the window
    // past anything useful. The database has all of it; this is a view.
    if (this.shots.length > MAX_BUFFERED) {
      this.shots = this.shots.sort((a, b) => b.pulledAt - a.pulledAt).slice(0, MAX_BUFFERED);
    }
  }
}
