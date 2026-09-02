/**
 * A deterministic roast simulator.
 *
 * Exists so the telemetry pipeline can be demonstrated and TESTED without a
 * roasting machine. Three consumers share it deliberately — the demo bridge,
 * the seed script, and the test suite — because a simulator that only the demo
 * uses drifts away from what the tests assume.
 *
 * Two design choices are load-bearing:
 *
 * DETERMINISTIC. Seeded from a string via a small PRNG rather than
 * Math.random, which is not reproducible and differs between Node and workerd.
 * A simulator whose output drifts between environments is useless for golden
 * -file tests, which is most of its value.
 *
 * A MODEL, NOT A RECORDING. A replayed lookup table cannot respond to input,
 * so opening the gas would change nothing and every demo would be a lie. This
 * is a first-order lumped-capacitance model: bean temperature chases
 * environment temperature, drying is endothermic, and the roast turns
 * exothermic once enough development has accumulated. Opening the gas really
 * does pull first crack earlier, which is also what makes DTR assertions in
 * tests mean something.
 */

/* ------------------------------------------------------------------- PRNG */

/**
 * mulberry32: eight lines, no dependencies, identical in every JS runtime.
 * The exact algorithm matters less than it being reproducible and seedable.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a, so a human-readable seed string maps to a stable 32-bit number. */
function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ------------------------------------------------------------------ types */

export type RoastSample = {
  /** Seconds since charge. */
  t: number;
  /** Bean temperature, °C. */
  bt: number;
  /** Environment (drum air) temperature, °C. */
  et: number;
  /** Rate of rise, °C per minute. */
  ror: number;
  gas: number;
  airflow: number;
  drumRpm: number;
};

export type RoastEvent = {
  t: number;
  kind: "charge" | "turning_point" | "dry_end" | "first_crack_start" | "drop";
};

export type Fault = "stall" | "network_gap" | "thermocouple_spike";

export type SimulatorOptions = {
  seed: string;
  /** Batch size, kg. A fuller drum has more thermal mass and heats slower. */
  chargeKg?: number;
  /** Machine capacity, kg. */
  capacityKg?: number;
  chargeTempC?: number;
  ambientTempC?: number;
  /** Gas as a percentage, 0–100. Changing it mid-roast changes the curve. */
  gas?: number;
  airflow?: number;
  sampleRateHz?: number;
};

export type Injection =
  | { fault: "stall"; fromT: number }
  | { fault: "network_gap"; fromT: number; toT: number }
  | { fault: "thermocouple_spike"; atT: number; magnitudeC?: number };

/* -------------------------------------------------------------- simulator */

const DEFAULTS = {
  chargeKg: 12,
  capacityKg: 15,
  chargeTempC: 200,
  ambientTempC: 21,
  gas: 65,
  airflow: 50,
  sampleRateHz: 2,
};

/**
 * Development accumulated past this threshold triggers first crack.
 *
 * Calibrated so a 12 kg charge at 60% gas reaches first crack around 8-9
 * minutes and drops around 10-11, which is where drum roasts actually live.
 */
const FIRST_CRACK_THRESHOLD = 4_500;
/** Moisture, as a fraction of charge weight, that must boil off first. */
const INITIAL_MOISTURE = 0.11;
/**
 * How quickly the bean-temperature probe stops reading the drum and starts
 * reading the beans.
 *
 * This lag is WHY roasters see a turning point: the probe is hot from the
 * previous batch, cold beans arrive, and the reading falls until the beans
 * themselves are heating faster than the probe is equilibrating. Modelling it
 * as a blend reproduces the dip; modelling bean temperature alone would give a
 * monotonic rise that no roaster would recognise.
 */
const PROBE_SETTLE_SECONDS = 52;

export class RoastSimulator {
  private rnd: () => number;
  private opts: Required<SimulatorOptions>;
  private injections: Injection[] = [];

  private t = 0;
  /** Actual bean mass temperature. Starts near ambient: the beans are cold. */
  private beanT: number;
  /** Drum air temperature. Starts hot and is pulled down by the charge. */
  private drumT: number;
  /** What the probe reads — a blend of the two, which is what a roaster sees. */
  private bt: number;
  private prevBt: number;
  private moisture = INITIAL_MOISTURE;
  private development = 0;
  private drift = 0;

  private firstCrackAt: number | null = null;
  private turningPointAt: number | null = null;
  private dryEndAt: number | null = null;
  private events: RoastEvent[] = [{ t: 0, kind: "charge" }];

  constructor(options: SimulatorOptions) {
    this.opts = { ...DEFAULTS, ...options };
    this.rnd = mulberry32(hashSeed(options.seed));
    this.beanT = this.opts.ambientTempC;
    this.drumT = this.opts.chargeTempC;
    this.bt = this.opts.chargeTempC;
    this.prevBt = this.bt;
  }

  /** Applies a fault, so the recovery paths have something to recover from. */
  inject(injection: Injection): this {
    this.injections.push(injection);
    return this;
  }

  setGas(pct: number): this {
    this.opts.gas = Math.max(0, Math.min(100, pct));
    return this;
  }

  setAirflow(pct: number): this {
    this.opts.airflow = Math.max(0, Math.min(100, pct));
    return this;
  }

  get elapsed(): number {
    return this.t;
  }

  get firstCrackTime(): number | null {
    return this.firstCrackAt;
  }

  get emittedEvents(): readonly RoastEvent[] {
    return this.events;
  }

  get finished(): boolean {
    return this.events.some((e) => e.kind === "drop");
  }

  private noise(scale: number): number {
    return (this.rnd() - 0.5) * 2 * scale;
  }

  private stalled(): boolean {
    return this.injections.some((i) => i.fault === "stall" && this.t >= i.fromT);
  }

  /** Whether a sample at this time is suppressed, simulating a dropped link. */
  isGapped(t: number): boolean {
    return this.injections.some((i) => i.fault === "network_gap" && t >= i.fromT && t <= i.toT);
  }

  private spike(): number {
    const s = this.injections.find(
      (i) => i.fault === "thermocouple_spike" && Math.abs(this.t - i.atT) < 1.1,
    );
    return s && s.fault === "thermocouple_spike" ? (s.magnitudeC ?? 40) : 0;
  }

  /** Advances the model by `dt` seconds and returns the resulting sample. */
  tick(dt: number): RoastSample {
    this.t += dt;

    // A fuller drum has more thermal mass, so everything happens slower.
    const load = this.opts.chargeKg / this.opts.capacityKg;
    const heatInput = this.stalled() ? 0 : this.opts.gas / 100;
    const airLoss = this.opts.airflow / 100;

    // Drum temperature: driven by the burner, cooled by airflow, and pulled
    // down by the cold charge it is heating.
    // At 60% gas and 50% airflow this settles around 240 C, which is where
    // drum air actually sits: the beans must be able to reach ~205 C, so the
    // drum has to run comfortably above that.
    const drumTarget = this.opts.ambientTempC + heatInput * 420 - airLoss * 60;
    this.drumT += (drumTarget - this.drumT) * 0.01 * dt;
    this.drumT -= (this.drumT - this.beanT) * 0.0016 * load * dt;

    // Bean temperature chases the drum.
    let dBean = (this.drumT - this.beanT) * (0.0034 / (0.55 + load)) * dt;

    // Drying is endothermic: while moisture remains it absorbs energy that
    // would otherwise raise bean temperature, which is what flattens the curve
    // before dry end.
    if (this.moisture > 0) {
      const evaporation = Math.min(this.moisture, 0.000021 * Math.max(0, this.beanT - 90) * dt);
      this.moisture -= evaporation;
      dBean -= evaporation * 210;
      if (this.moisture <= 0.0005 && this.dryEndAt === null) {
        this.dryEndAt = this.t;
        this.events.push({ t: round(this.t, 2), kind: "dry_end" });
      }
    }

    // Past dry end the roast accumulates development. Because it accrues
    // faster at higher bean temperature, more gas genuinely pulls first crack
    // earlier — the property that makes this a model rather than a recording.
    if (this.moisture <= 0.0005) {
      this.development += Math.max(0, this.beanT - 140) * dt;
      if (this.development > FIRST_CRACK_THRESHOLD && this.firstCrackAt === null) {
        this.firstCrackAt = this.t;
        this.events.push({ t: round(this.t, 2), kind: "first_crack_start" });
      }
      // First crack is exothermic: the beans start producing their own heat.
      if (this.firstCrackAt !== null) dBean += 0.02 * dt;
    }

    this.beanT += dBean;

    // The probe reading: an exponential approach rather than a linear ramp.
    // A ramp reaches its clamp at a fixed time and pins the turning point
    // there, which makes the turning point an artifact of the clamp rather
    // than of the crossover between a cooling drum and warming beans. With an
    // asymptotic blend the turning point emerges from the physics and moves
    // with the inputs, which is the whole point of modelling it.
    const w = 1 - Math.exp(-this.t / PROBE_SETTLE_SECONDS);
    this.prevBt = this.bt;
    this.bt = this.beanT * w + this.drumT * (1 - w);

    // The turning point is DETECTED, not scheduled, so it moves with the
    // inputs exactly as it does on a real machine.
    if (this.turningPointAt === null && this.bt > this.prevBt && this.t > 10) {
      this.turningPointAt = this.t;
      this.events.push({ t: round(this.t, 2), kind: "turning_point" });
    }

    const ror = ((this.bt - this.prevBt) / dt) * 60;

    // Slow thermocouple drift plus per-reading noise, both seeded. Without
    // noise a smoothing or curve-fitting bug looks correct.
    this.drift += this.noise(0.004) * dt;

    return {
      t: round(this.t, 2),
      bt: round(this.bt + this.drift + this.noise(0.3) + this.spike(), 2),
      et: round(this.drumT + this.noise(1.2), 2),
      ror: round(ror, 3),
      gas: this.opts.gas,
      airflow: this.opts.airflow,
      drumRpm: 58,
    };
  }

  /** Ends the roast, emitting the drop event. */
  drop(): RoastEvent {
    const event: RoastEvent = { t: round(this.t, 2), kind: "drop" };
    this.events.push(event);
    return event;
  }

  /**
   * Runs a whole roast to completion.
   *
   * Drops a fixed interval after first crack, which is how a roaster actually
   * decides: development time, not total time.
   */
  run(options: { developmentSeconds?: number; maxSeconds?: number } = {}): {
    samples: RoastSample[];
    events: RoastEvent[];
  } {
    const dt = 1 / this.opts.sampleRateHz;
    const development = options.developmentSeconds ?? 110;
    const maxSeconds = options.maxSeconds ?? 1500;
    const samples: RoastSample[] = [];

    while (this.t < maxSeconds) {
      samples.push(this.tick(dt));
      if (this.firstCrackAt !== null && this.t >= this.firstCrackAt + development) break;
    }
    this.drop();
    return { samples, events: [...this.events] };
  }

  /**
   * Yields samples for streaming, optionally in real time.
   *
   * `speed` compresses the wait, so a 12-minute roast can be demonstrated in
   * well under a minute without changing the curve it produces.
   */
  async *stream(
    options: { realtime?: boolean; speed?: number; developmentSeconds?: number } = {},
  ): AsyncGenerator<RoastSample> {
    const dt = 1 / this.opts.sampleRateHz;
    const speed = options.speed ?? 1;
    const development = options.developmentSeconds ?? 110;

    while (this.t < 1500) {
      const sample = this.tick(dt);
      // A gapped sample is generated but not yielded: the roast really
      // happened, the network just did not carry it. That is exactly what the
      // bridge's resume path has to recover.
      if (!this.isGapped(sample.t)) yield sample;
      if (options.realtime) await sleep((dt * 1000) / speed);
      if (this.firstCrackAt !== null && this.t >= this.firstCrackAt + development) break;
    }
    this.drop();
  }
}

export function createRoastSimulator(options: SimulatorOptions): RoastSimulator {
  return new RoastSimulator(options);
}

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function sleep(ms: number): Promise<void> {
  // Declared rather than imported: this package targets both Node and workerd,
  // and pulling in either runtime's typings would tie it to one of them.
  const timer = (globalThis as { setTimeout?: (fn: () => void, ms: number) => unknown }).setTimeout;
  return new Promise((resolve) => {
    if (timer) timer(() => resolve(), ms);
    else resolve();
  });
}

/** Metrics a completed roast is judged on. */
export function summarize(samples: RoastSample[], events: readonly RoastEvent[]) {
  const fc = events.find((e) => e.kind === "first_crack_start")?.t ?? null;
  const drop = events.find((e) => e.kind === "drop")?.t ?? samples.at(-1)?.t ?? 0;
  const dryEnd = events.find((e) => e.kind === "dry_end")?.t ?? null;
  return {
    totalTimeS: drop,
    firstCrackS: fc,
    dryEndS: dryEnd,
    developmentTimeS: fc === null ? null : round(drop - fc, 2),
    // Development time ratio: the share of the roast after first crack, and
    // the number roasters argue about most.
    dtrPct: fc === null || drop === 0 ? null : round(((drop - fc) / drop) * 100, 2),
    dropTempC: samples.at(-1)?.bt ?? null,
    maxRor: samples.reduce((max, s) => Math.max(max, s.ror), Number.NEGATIVE_INFINITY),
  };
}
