/**
 * The live roast connection.
 *
 * The naive version — one `setState` per message — is why most live-telemetry
 * UIs stutter: a roast is 1,800 samples at 1 Hz, and a replay burst after a
 * dropout delivers four hundred of them in one frame. That would be four
 * hundred React renders of a component tree containing a chart.
 *
 * So: samples land in **preallocated Float64Arrays behind a ref**, and React is
 * told about almost nothing. `useSyncExternalStore` publishes only the
 * connection status and a 4 Hz numeric readout; the chart reads the arrays
 * directly and redraws on its own schedule. A 400-sample burst becomes one
 * draw and zero renders.
 */
import * as React from "react";

const CAPACITY = 4096;
/** Four times a second. Faster is unreadable; slower feels dead. */
const READOUT_HZ = 4;
/** A half-open socket shows a frozen curve that looks live — worse than "reconnecting". */
const SILENCE_TIMEOUT_MS = 35_000;

export type RoastState = "idle" | "running" | "stalled" | "complete";
export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

export type RoastMark = { t: number; kind: string };

export type Readout = {
  elapsedSeconds: number;
  beanTempC: number | null;
  envTempC: number | null;
  rorCPerMin: number | null;
  sampleCount: number;
  state: RoastState;
};

export type LiveRoast = {
  status: ConnectionStatus;
  /**
   * Records an operator mark.
   *
   * Sent over the SOCKET, not through the RPC API. First crack is a sound the
   * roaster hears, and the mark has to reach the live session — and every
   * other tab watching it — at the moment they hear it, not after a round trip
   * through Postgres. The Durable Object checks write permission before
   * accepting it, so a read-only viewer cannot fake one.
   */
  mark: (kind: string) => boolean;
  readout: Readout;
  marks: RoastMark[];
  /** Read directly by the chart. Never copied into React state. */
  series: {
    t: Float64Array;
    bt: Float64Array;
    et: Float64Array;
    ror: Float64Array;
    length: number;
  };
  /** Bumped on every draw-worthy change, so a chart can subscribe cheaply. */
  revision: number;
};

type Store = {
  status: ConnectionStatus;
  readout: Readout;
  marks: RoastMark[];
  revision: number;
};

const EMPTY_READOUT: Readout = {
  elapsedSeconds: 0,
  beanTempC: null,
  envTempC: null,
  rorCPerMin: null,
  sampleCount: 0,
  state: "idle",
};

export function useLiveRoast(batchId: string, orgId: string | null): LiveRoast {
  // Allocated once. Growing an array 1,800 times during a roast is 1,800
  // allocations and copies at exactly the moment latency is visible.
  const series = React.useRef({
    t: new Float64Array(CAPACITY),
    bt: new Float64Array(CAPACITY),
    et: new Float64Array(CAPACITY),
    ror: new Float64Array(CAPACITY),
    length: 0,
  });

  const store = React.useRef<Store>({
    status: "connecting",
    readout: EMPTY_READOUT,
    marks: [],
    revision: 0,
  });

  const socketRef = React.useRef<WebSocket | null>(null);
  const listeners = React.useRef(new Set<() => void>());
  const notify = React.useCallback(() => {
    for (const listener of listeners.current) listener();
  }, []);

  const subscribe = React.useCallback((listener: () => void) => {
    listeners.current.add(listener);
    return () => listeners.current.delete(listener);
  }, []);

  const getSnapshot = React.useCallback(() => store.current, []);
  const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  React.useEffect(() => {
    if (!orgId) return;

    let socket: WebSocket | null = null;
    let closed = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    let readoutTimer: ReturnType<typeof setInterval> | null = null;
    let dirty = false;

    const publish = (patch: Partial<Store>) => {
      store.current = { ...store.current, ...patch };
      notify();
    };

    const armSilenceTimer = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        // A socket can stay "open" while the connection underneath is dead.
        // Showing a frozen curve that looks live is worse than admitting it.
        socket?.close();
      }, SILENCE_TIMEOUT_MS);
    };

    const append = (row: number[]) => {
      const s = series.current;
      if (s.length >= CAPACITY) return;
      const [t = 0, bt = Number.NaN, et = Number.NaN, ror = Number.NaN] = row;
      s.t[s.length] = t;
      s.bt[s.length] = bt;
      s.et[s.length] = et;
      s.ror[s.length] = ror;
      s.length += 1;
      dirty = true;
    };

    const connect = () => {
      if (closed) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(
        `${protocol}//${window.location.host}/stream/v1/roast/${batchId}?org=${orgId}`,
      );
      socketRef.current = socket;

      socket.onopen = () => {
        attempt = 0;
        publish({ status: "open" });
        armSilenceTimer();
      };

      socket.onmessage = (event) => {
        armSilenceTimer();
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(event.data as string);
        } catch {
          return;
        }

        switch (message.type) {
          case "hello":
            publish({ status: "open" });
            break;
          case "backfill":
          case "samples": {
            // Columnar frames: `schema` names the channels and each row is an
            // array. Roughly six times smaller than an array of objects, and
            // it deserializes straight into these arrays.
            for (const row of (message.samples as number[][]) ?? []) append(row);
            break;
          }
          case "backfillEvents": {
            const events = (message.events as RoastMark[]) ?? [];
            publish({ marks: [...store.current.marks, ...events] });
            break;
          }
          case "event":
            publish({
              marks: [
                ...store.current.marks,
                { t: message.t as number, kind: message.kind as string },
              ],
            });
            break;
          case "state":
            publish({
              readout: { ...store.current.readout, state: message.state as RoastState },
            });
            break;
        }
      };

      socket.onclose = () => {
        if (closed) return;
        publish({ status: "reconnecting" });
        // Jittered: twelve roasters on one shop-floor access point must not
        // stampede the same Durable Object in lockstep after an outage.
        const base = Math.min(1000 * 2 ** attempt, 15_000);
        const delay = base * (0.5 + Math.random() * 0.5);
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };

      socket.onerror = () => socket?.close();
    };

    // One timer publishes the readout, rather than every message doing it.
    // 3,600 messages become 3,600 array writes and a few hundred text updates.
    readoutTimer = setInterval(() => {
      if (!dirty) return;
      dirty = false;
      const s = series.current;
      const i = s.length - 1;
      if (i < 0) return;
      const finite = (v: number) => (Number.isFinite(v) ? v : null);
      publish({
        readout: {
          ...store.current.readout,
          elapsedSeconds: s.t[i] ?? 0,
          beanTempC: finite(s.bt[i] ?? Number.NaN),
          envTempC: finite(s.et[i] ?? Number.NaN),
          rorCPerMin: finite(s.ror[i] ?? Number.NaN),
          sampleCount: s.length,
        },
        revision: store.current.revision + 1,
      });
    }, 1000 / READOUT_HZ);

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (silenceTimer) clearTimeout(silenceTimer);
      if (readoutTimer) clearInterval(readoutTimer);
      socket?.close();
      socketRef.current = null;
      series.current.length = 0;
      store.current = { status: "closed", readout: EMPTY_READOUT, marks: [], revision: 0 };
    };
  }, [batchId, orgId, notify]);

  const mark = React.useCallback((kind: string): boolean => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type: "mark", kind }));
    // Not applied optimistically: the object echoes the mark back with the
    // elapsed time IT holds, which is the authoritative one. Guessing the time
    // here would put a first crack in the log a second off where it happened.
    return true;
  }, []);

  return {
    status: snapshot.status,
    readout: snapshot.readout,
    marks: snapshot.marks,
    series: series.current,
    revision: snapshot.revision,
    mark,
  };
}
