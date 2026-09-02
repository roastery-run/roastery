import { describe, expect, it } from "vitest";
import { createRoastSimulator, summarize } from "./index";

describe("determinism", () => {
  it("produces an identical curve from the same seed", () => {
    const a = createRoastSimulator({ seed: "ethiopia-filter" }).run();
    const b = createRoastSimulator({ seed: "ethiopia-filter" }).run();
    // Byte-identical, not merely similar: golden-file tests depend on this,
    // and Math.random would not survive it.
    expect(a.samples).toEqual(b.samples);
    expect(a.events).toEqual(b.events);
  });

  it("produces a different curve from a different seed", () => {
    const a = createRoastSimulator({ seed: "seed-one" }).run();
    const b = createRoastSimulator({ seed: "seed-two" }).run();
    expect(a.samples).not.toEqual(b.samples);
  });
});

describe("the model responds to input", () => {
  it("pulls first crack earlier when the gas is opened", () => {
    const low = createRoastSimulator({ seed: "gas", gas: 45 }).run();
    const high = createRoastSimulator({ seed: "gas", gas: 85 }).run();

    const lowFc = summarize(low.samples, low.events).firstCrackS;
    const highFc = summarize(high.samples, high.events).firstCrackS;

    expect(lowFc).not.toBeNull();
    expect(highFc).not.toBeNull();
    // This is the property that separates a model from a recording. Without
    // it, every demo of "adjust the gas" would be a lie.
    expect(highFc as number).toBeLessThan(lowFc as number);
  });

  it("heats a fuller drum more slowly", () => {
    const light = createRoastSimulator({ seed: "load", chargeKg: 6, capacityKg: 15 }).run();
    const full = createRoastSimulator({ seed: "load", chargeKg: 14, capacityKg: 15 }).run();
    const lightFc = summarize(light.samples, light.events).firstCrackS as number;
    const fullFc = summarize(full.samples, full.events).firstCrackS as number;
    expect(fullFc).toBeGreaterThan(lightFc);
  });

  it("stalls when the burner is cut", () => {
    const normal = createRoastSimulator({ seed: "stall" }).run();
    const stalled = createRoastSimulator({ seed: "stall" })
      .inject({ fault: "stall", fromT: 120 })
      .run({ maxSeconds: 1200 });

    const normalFc = summarize(normal.samples, normal.events).firstCrackS;
    const stalledFc = summarize(stalled.samples, stalled.events).firstCrackS;
    // A stalled roast either never reaches first crack, or reaches it much
    // later. Either way the watchdog has something real to detect.
    expect(stalledFc === null || (stalledFc as number) > (normalFc as number)).toBe(true);
  });
});

describe("the curve is physically plausible", () => {
  const { samples, events } = createRoastSimulator({ seed: "shape" }).run();
  const s = summarize(samples, events);

  it("passes through the phases a roaster expects, in order", () => {
    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe("charge");
    expect(kinds).toContain("turning_point");
    expect(kinds).toContain("dry_end");
    expect(kinds).toContain("first_crack_start");
    expect(kinds.at(-1)).toBe("drop");

    const at = (k: string) => events.find((e) => e.kind === k)?.t ?? Number.NaN;
    expect(at("turning_point")).toBeLessThan(at("dry_end"));
    expect(at("dry_end")).toBeLessThan(at("first_crack_start"));
    expect(at("first_crack_start")).toBeLessThan(at("drop"));
  });

  it("lands in a realistic time and temperature range", () => {
    // A drum roast is usually 9-14 minutes and dropped between 190 and 225 C.
    expect(s.totalTimeS).toBeGreaterThan(540);
    expect(s.totalTimeS).toBeLessThan(900);
    expect(s.dropTempC as number).toBeGreaterThan(185);
    expect(s.dropTempC as number).toBeLessThan(235);
  });

  it("produces a development time ratio in the range roasters argue about", () => {
    // 12-22% is the band most specialty roasters target.
    expect(s.dtrPct as number).toBeGreaterThan(10);
    expect(s.dtrPct as number).toBeLessThan(25);
  });

  it("puts the turning point where a roaster expects it, not at a fixed clamp", () => {
    const hot = createRoastSimulator({ seed: "shape", gas: 85 }).run();
    const cool = createRoastSimulator({ seed: "shape", gas: 50 }).run();
    const tpOf = (r: { events: readonly { t: number; kind: string }[] }) =>
      r.events.find((e) => e.kind === "turning_point")?.t ?? 0;

    // Both in the 60-160s band a roaster would recognise...
    for (const t of [tpOf(hot), tpOf(cool)]) {
      expect(t).toBeGreaterThan(60);
      expect(t).toBeLessThan(160);
    }
    // ...and it MOVES with the heat, rather than being an artifact of when a
    // blend factor happens to reach its limit.
    expect(tpOf(hot)).toBeLessThan(tpOf(cool));
  });

  it("rises overall, and the temperature dips before the turning point", () => {
    const turning = events.find((e) => e.kind === "turning_point")?.t ?? 0;
    const beforeTurn = samples.filter((x) => x.t <= turning);
    const first = beforeTurn[0]?.bt ?? 0;
    const lowest = Math.min(...beforeTurn.map((x) => x.bt));
    expect(lowest).toBeLessThan(first);
    expect(samples.at(-1)?.bt ?? 0).toBeGreaterThan(lowest);
  });
});

describe("fault injection", () => {
  it("suppresses samples during a network gap but keeps roasting", async () => {
    const sim = createRoastSimulator({ seed: "gap" }).inject({
      fault: "network_gap",
      fromT: 100,
      toT: 140,
    });

    const received: number[] = [];
    for await (const sample of sim.stream()) received.push(sample.t);

    const inGap = received.filter((t) => t >= 100 && t <= 140);
    expect(inGap).toEqual([]);
    // The roast continued through the gap — that is what the resume path has
    // to recover, and why the gap is not simply "pause".
    expect(received.some((t) => t > 140)).toBe(true);
  });

  it("injects a thermocouple spike without derailing the roast", () => {
    const clean = createRoastSimulator({ seed: "spike" }).run();
    const spiked = createRoastSimulator({ seed: "spike" })
      .inject({ fault: "thermocouple_spike", atT: 200, magnitudeC: 45 })
      .run();

    const near = (r: { samples: { t: number; bt: number }[] }) =>
      r.samples.find((x) => Math.abs(x.t - 200) < 0.6)?.bt ?? 0;

    expect(near(spiked) - near(clean)).toBeGreaterThan(30);
    // A single bad reading must not change the outcome, or every smoothing
    // bug would look like a real roast difference.
    expect(summarize(spiked.samples, spiked.events).firstCrackS).toBe(
      summarize(clean.samples, clean.events).firstCrackS,
    );
  });
});
