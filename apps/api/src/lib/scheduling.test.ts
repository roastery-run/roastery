import { describe, expect, it } from "vitest";
import {
  aggregateDemand,
  buildSchedule,
  type DemandItem,
  sequenceRank,
  splitIntoBatches,
} from "./scheduling";

const item = (over: Partial<DemandItem> = {}): DemandItem => ({
  orderLineId: crypto.randomUUID(),
  blendId: "house",
  profileId: "p-house",
  label: "House Blend",
  roastedKg: 10,
  dueAt: "2026-04-01",
  roastLevel: "medium",
  isDecaf: false,
  ...over,
});

describe("demand aggregation", () => {
  it("merges orders for the same coffee into one requirement", () => {
    // Twelve customers ordering 5 kg of the house blend is one roast, not
    // twelve — merging is what turns an order book into a production plan.
    const merged = aggregateDemand(Array.from({ length: 12 }, () => item({ roastedKg: 5 })));
    expect(merged).toHaveLength(1);
    expect(merged[0]?.roastedKg).toBe(60);
    expect(merged[0]?.lineIds).toHaveLength(12);
  });

  it("keeps different coffees apart", () => {
    const merged = aggregateDemand([
      item({ blendId: "house", profileId: "p1" }),
      item({ blendId: "single", profileId: "p2" }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it("adopts the earliest due date in the group", () => {
    // The merged batch must satisfy the most urgent order in it.
    const merged = aggregateDemand([
      item({ dueAt: "2026-05-01" }),
      item({ dueAt: "2026-04-02" }),
      item({ dueAt: "2026-06-01" }),
    ]);
    expect(merged[0]?.dueAt).toBe("2026-04-02");
  });
});

describe("batch sizing", () => {
  it("charges enough green to yield the roasted target", () => {
    // 10 kg of roasted coffee needs ~11.76 kg of green at 15% loss. Sizing the
    // batch against the roasted figure under-charges on every single batch.
    const [batch] = splitIntoBatches(10, { machineId: "m", capacityKg: 15 });
    expect(batch?.chargeKg).toBeCloseTo(11.7647, 3);
    expect(batch?.yieldKg).toBeCloseTo(10, 3);
  });

  it("splits a requirement larger than the drum", () => {
    // 30 kg roasted is ~35.3 kg green, which does not fit a 12 kg drum.
    const batches = splitIntoBatches(30, { machineId: "m", capacityKg: 12 });
    expect(batches).toHaveLength(3);
    const yielded = batches.reduce((a, b) => a + b.yieldKg, 0);
    expect(yielded).toBeCloseTo(30, 2);
  });

  it("spreads evenly rather than leaving a stub batch", () => {
    // Three even batches roast more consistently than two full ones and a
    // remainder, and consistency is the entire point of a profile.
    const batches = splitIntoBatches(30, { machineId: "m", capacityKg: 12 });
    const charges = batches.map((b) => b.chargeKg);
    expect(Math.max(...charges) - Math.min(...charges)).toBeLessThan(0.01);
  });

  it("never plans a batch above the drum's capacity", () => {
    const batches = splitIntoBatches(100, { machineId: "m", capacityKg: 12, maxBatchKg: 12 });
    expect(batches.every((b) => b.chargeKg <= 12.0001)).toBe(true);
  });
});

describe("sequencing rules", () => {
  it("runs light before dark", () => {
    // A dark roast leaves residue a lighter one picks up.
    expect(sequenceRank({ roastLevel: "light", isDecaf: false })).toBeLessThan(
      sequenceRank({ roastLevel: "dark", isDecaf: false }),
    );
  });

  it("runs decaf last however light it is", () => {
    // Cross-contamination into a regular batch is the failure that reaches a
    // customer who asked for caffeine.
    expect(sequenceRank({ roastLevel: "light", isDecaf: true })).toBeGreaterThan(
      sequenceRank({ roastLevel: "dark", isDecaf: false }),
    );
  });

  it("treats an unknown roast level cautiously, not as light", () => {
    const unknown = sequenceRank({ roastLevel: null, isDecaf: false });
    expect(unknown).toBeGreaterThan(sequenceRank({ roastLevel: "light", isDecaf: false }));
  });
});

describe("building a day's plan", () => {
  const machine = { machineId: "m1", capacityKg: 12 };

  it("orders the day light, dark, then decaf", () => {
    const plan = buildSchedule(
      [
        item({ blendId: "dk", profileId: "p-dark", label: "Dark", roastLevel: "dark" }),
        item({ blendId: "dc", profileId: "p-decaf", label: "Decaf", isDecaf: true }),
        item({ blendId: "lt", profileId: "p-light", label: "Light", roastLevel: "light" }),
      ],
      [machine],
    );
    expect(plan.batches.map((b) => b.label)).toEqual(["Light", "Dark", "Decaf"]);
  });

  it("keeps batches of the same coffee adjacent", () => {
    // Every profile change is a machine changeover, so scattering three
    // batches of one coffee across a day costs three warm-ups.
    const plan = buildSchedule(
      [
        item({ blendId: "a", profileId: "pa", label: "A", roastedKg: 30 }),
        item({ blendId: "b", profileId: "pb", label: "B", roastedKg: 10 }),
      ],
      [{ machineId: "m1", capacityKg: 12 }],
    );
    const labels = plan.batches.map((b) => b.label);
    const firstA = labels.indexOf("A");
    const lastA = labels.lastIndexOf("A");
    // Every A is contiguous: no B sits between two As.
    expect(labels.slice(firstA, lastA + 1).every((l) => l === "A")).toBe(true);
  });

  it("spreads work across machines instead of queueing on one", () => {
    const plan = buildSchedule(
      [
        item({ blendId: "a", profileId: "pa", label: "A" }),
        item({ blendId: "b", profileId: "pb", label: "B" }),
      ],
      [
        { machineId: "m1", capacityKg: 12 },
        { machineId: "m2", capacityKg: 12 },
      ],
    );
    expect(new Set(plan.batches.map((b) => b.machineId)).size).toBe(2);
  });

  it("reports what it could not place rather than dropping it", () => {
    const plan = buildSchedule(
      [item({ roastedKg: 500 })],
      [{ machineId: "m1", capacityKg: 12, maxBatches: 2 }],
    );
    expect(plan.batches).toHaveLength(2);
    // Silently planning less than was ordered is the worst outcome: the
    // shortfall must be visible before the day starts.
    expect(plan.unscheduled.length).toBeGreaterThan(0);
    expect(plan.unscheduled[0]?.reason).toMatch(/batch limit/);
  });

  it("says so when there is no machine at all", () => {
    const plan = buildSchedule([item()], []);
    expect(plan.batches).toEqual([]);
    expect(plan.unscheduled[0]?.reason).toMatch(/No machine/);
  });

  it("carries the order lines through, so a roaster sees the why", () => {
    const plan = buildSchedule([item({ roastedKg: 5 }), item({ roastedKg: 5 })], [machine]);
    expect(plan.batches[0]?.demandLineIds).toHaveLength(2);
  });
});

describe("buildSchedule — spreading work across drums", () => {
  const p12 = { machineId: "p12", capacityKg: 12 };
  const p30 = { machineId: "p30", capacityKg: 30 };
  const item = (over: Partial<DemandItem> = {}): DemandItem => ({
    orderLineId: "l1",
    blendId: "b1",
    profileId: "b1",
    label: "House",
    roastedKg: 100,
    dueAt: null,
    ...over,
  });

  it("splits one requirement across both drums instead of queueing it on one", () => {
    const plan = buildSchedule([item()], [p12, p30]);
    const machinesUsed = new Set(plan.batches.map((b) => b.machineId));
    expect(machinesUsed).toEqual(new Set(["p12", "p30"]));
  });

  it("plans the full requirement when there is capacity for it", () => {
    const plan = buildSchedule([item({ roastedKg: 100 })], [p12, p30]);
    const yielded = plan.batches.reduce((s, b) => s + b.plannedYieldKg, 0);
    expect(yielded).toBeCloseTo(100, 2);
    expect(plan.unscheduled).toHaveLength(0);
  });

  it("never charges a drum past its capacity", () => {
    const plan = buildSchedule([item({ roastedKg: 400 })], [p12, p30]);
    for (const b of plan.batches) {
      expect(b.plannedChargeKg).toBeLessThanOrEqual(b.machineId === "p12" ? 12 : 30);
    }
  });

  it("reports one shortfall per requirement, not one per unplaced batch", () => {
    // Two batch slots total against a requirement needing far more: the naive
    // implementation emits a note for every batch it could not place.
    const plan = buildSchedule(
      [item({ roastedKg: 500 })],
      [
        { ...p12, maxBatches: 1 },
        { ...p30, maxBatches: 1 },
      ],
    );
    expect(plan.batches).toHaveLength(2);
    expect(plan.unscheduled).toHaveLength(1);
    expect(plan.unscheduled[0]?.roastedKg).toBeGreaterThan(400);
  });

  it("keeps each blend contiguous on every drum", () => {
    const plan = buildSchedule(
      [
        item({
          orderLineId: "a",
          blendId: "light",
          profileId: "light",
          label: "L",
          roastedKg: 80,
          roastLevel: "light",
        }),
        item({
          orderLineId: "b",
          blendId: "dark",
          profileId: "dark",
          label: "D",
          roastedKg: 80,
          roastLevel: "dark",
        }),
      ],
      [p12, p30],
    );
    for (const machineId of ["p12", "p30"]) {
      const queue = plan.batches
        .filter((b) => b.machineId === machineId)
        .sort((a, b) => a.position - b.position)
        .map((b) => b.blendId);
      const runs = queue.filter((id, i) => id !== queue[i - 1]);
      expect(runs).toEqual([...new Set(runs)]);
    }
  });

  it("gives each drum its own position sequence starting at zero", () => {
    const plan = buildSchedule([item({ roastedKg: 200 })], [p12, p30]);
    for (const machineId of ["p12", "p30"]) {
      const positions = plan.batches
        .filter((b) => b.machineId === machineId)
        .map((b) => b.position)
        .sort((a, b) => a - b);
      expect(positions).toEqual(positions.map((_, i) => i));
    }
  });
});

describe("splitIntoBatches — the machine minimum", () => {
  it("takes fewer, larger batches rather than splitting below the minimum", () => {
    // 10 kg roasted ≈ 11.76 kg charge. Two 5.88 kg batches would each be under
    // the 8 kg minimum, so this has to be one batch.
    const batches = splitIntoBatches(10, {
      machineId: "m",
      capacityKg: 6,
      minBatchKg: 8,
      maxBatchKg: 6,
    });
    expect(batches).toHaveLength(1);
    expect(batches[0]?.chargeKg).toBeCloseTo(11.7647, 3);
  });

  it("flags a requirement that is smaller than the drum minimum rather than padding it", () => {
    const batches = splitIntoBatches(1, { machineId: "m", capacityKg: 12, minBatchKg: 5 });
    expect(batches).toHaveLength(1);
    expect(batches[0]?.belowMinimum).toBe(true);
    // Padding up to 5 kg would roast coffee nobody ordered.
    expect(batches[0]?.chargeKg).toBeLessThan(5);
  });
});
