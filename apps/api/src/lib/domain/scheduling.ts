/**
 * Turning demand into a roast sequence.
 *
 * Pure functions, deliberately: the sequencing rules below encode how a
 * roastery actually runs a day, and they are worth testing without a database
 * standing in the way.
 *
 * THE SEQUENCE IS NOT ARBITRARY. Three rules, each for a physical reason:
 *
 *   1. Group by profile. Every profile change is a machine changeover — the
 *      drum has to settle at a new charge temperature — so scattering three
 *      batches of the same coffee across a day costs three warm-ups instead
 *      of one.
 *
 *   2. Light before dark. A dark roast leaves oil and chaff in the drum; a
 *      lighter roast run afterwards picks it up. Running the other way round
 *      means cleaning between every pair.
 *
 *   3. Decaf last. Decaffeinated beans behave differently and can carry
 *      solvent or process residue, and cross-contamination into a regular
 *      batch is the one that reaches a customer who asked for caffeine.
 *
 * A scheduler that ignores these produces a plan that is arithmetically
 * correct and that no roaster will follow.
 */

export type DemandItem = {
  orderLineId: string;
  /** What must be produced. */
  blendId: string | null;
  profileId: string | null;
  label: string;
  roastedKg: number;
  /** Earliest requested ship date across the lines merged into this item. */
  dueAt: string | null;
  roastLevel?: "light" | "medium" | "dark" | null;
  isDecaf?: boolean;
};

export type MachineCapacity = {
  machineId: string;
  /** Nominal batch size. */
  capacityKg: number;
  minBatchKg?: number | null;
  maxBatchKg?: number | null;
  /** How many batches this machine can run in the planning window. */
  maxBatches?: number;
};

export type PlannedBatch = {
  machineId: string;
  position: number;
  profileId: string | null;
  blendId: string | null;
  label: string;
  plannedChargeKg: number;
  plannedYieldKg: number;
  demandLineIds: string[];
};

export type SchedulePlan = {
  batches: PlannedBatch[];
  /** Demand that could not be placed, and why. */
  unscheduled: { label: string; roastedKg: number; reason: string }[];
};

/** Roast loss, so a batch is charged with enough green to yield the target. */
const DEFAULT_LOSS_PCT = 15;

/**
 * Merges demand for the same thing.
 *
 * Twelve customers each ordering 5 kg of the house blend is one roast, not
 * twelve. Merging before sizing is what turns an order book into a production
 * plan rather than a list.
 */
export type AggregatedDemand = DemandItem & { lineIds: string[] };

export function aggregateDemand(items: DemandItem[]): AggregatedDemand[] {
  const merged = new Map<string, AggregatedDemand>();

  for (const item of items) {
    // What gets roasted together is defined by the blend and the profile;
    // which customer ordered it is irrelevant to the drum.
    const key = `${item.blendId ?? "none"}:${item.profileId ?? "none"}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, { ...item, lineIds: [item.orderLineId] });
      continue;
    }

    existing.roastedKg = round4(existing.roastedKg + item.roastedKg);
    // The earliest due date wins: a merged batch has to satisfy the most
    // urgent order inside it, not the average.
    if (item.dueAt && (!existing.dueAt || item.dueAt < existing.dueAt)) {
      existing.dueAt = item.dueAt;
    }
    existing.lineIds.push(item.orderLineId);
  }

  return [...merged.values()];
}

/** Ranks a roast for sequencing. Lower runs earlier. */
export function sequenceRank(item: Pick<DemandItem, "roastLevel" | "isDecaf">): number {
  // Decaf last, regardless of how light it is: residue reaching a regular
  // batch is the failure that actually gets to a customer.
  if (item.isDecaf) return 100;
  switch (item.roastLevel) {
    case "light":
      return 1;
    case "medium":
      return 2;
    case "dark":
      return 3;
    default:
      // Unknown roast level sits between medium and dark rather than first: a
      // guess that runs an unknown coffee before a light one risks the exact
      // contamination the ordering exists to prevent.
      return 2.5;
  }
}

/**
 * Splits demand into batches a machine can actually run.
 *
 * A partial batch still occupies the drum, so a 30 kg requirement on a 12 kg
 * machine is three batches, not two and a half.
 */
export function splitIntoBatches(
  roastedKg: number,
  capacity: MachineCapacity,
  lossPct = DEFAULT_LOSS_PCT,
): { chargeKg: number; yieldKg: number; belowMinimum?: boolean }[] {
  const maxCharge = capacity.maxBatchKg ?? capacity.capacityKg;
  const minCharge = capacity.minBatchKg ?? 0;
  if (maxCharge <= 0) return [];

  // Charge weight is GREEN; the requirement is ROASTED. Sizing the batch
  // against the roasted figure under-charges by the loss on every batch.
  const totalCharge = roastedKg / (1 - lossPct / 100);
  if (totalCharge <= 0) return [];

  let count = Math.ceil(round4(totalCharge) / maxCharge);

  // Splitting more finely than the minimum charge produces batches the drum
  // cannot roast. Take fewer, larger batches instead — the alternative, padding
  // a short batch up to the minimum, would roast coffee nobody ordered.
  if (minCharge > 0) {
    const maxUsableBatches = Math.floor(round4(totalCharge) / minCharge);
    if (maxUsableBatches >= 1) count = Math.min(count, maxUsableBatches);
  }
  if (count < 1) count = 1;

  // Spread evenly rather than filling batches to capacity and leaving a
  // remainder: three even 10 kg batches roast more consistently than two of 12
  // and one of 6, and consistency is the entire point of a profile.
  const perBatch = round4(totalCharge / count);

  // Only reachable when the whole requirement is under the machine minimum.
  // It is planned anyway and flagged, because dropping it silently would lose
  // an order; a roaster can combine it with something else or run it short.
  const belowMinimum = minCharge > 0 && perBatch < minCharge;

  const batches: { chargeKg: number; yieldKg: number; belowMinimum?: boolean }[] = [];
  for (let i = 0; i < count; i++) {
    batches.push({
      chargeKg: perBatch,
      yieldKg: round4(perBatch * (1 - lossPct / 100)),
      ...(belowMinimum ? { belowMinimum: true } : {}),
    });
  }
  return batches;
}

/**
 * Builds the day's plan.
 *
 * Demand is merged, sized into batches, then ordered: by sequence rank first
 * (light, medium, dark, decaf), and within a rank by profile so identical
 * roasts run back to back.
 *
 * Each requirement is spread across the available drums rather than pinned to
 * one. Pinning is the obvious implementation and it is wrong: 114 kg would
 * queue on a 12 kg roaster for twelve batches while a 30 kg roaster stands
 * idle beside it, and the plan would then declare a shortfall the roastery
 * does not actually have.
 */
export function buildSchedule(
  demand: DemandItem[],
  machines: MachineCapacity[],
  options: { lossPct?: number } = {},
): SchedulePlan {
  const unscheduled: SchedulePlan["unscheduled"] = [];
  if (!machines.length) {
    return {
      batches: [],
      unscheduled: demand.map((d) => ({
        label: d.label,
        roastedKg: d.roastedKg,
        reason: "No machine is available",
      })),
    };
  }

  const merged = aggregateDemand(demand);

  const ordered = [...merged].sort((a, b) => {
    const rank = sequenceRank(a) - sequenceRank(b);
    if (rank !== 0) return rank;
    // Within a rank, keep identical profiles adjacent so the drum is not
    // re-tuned between them.
    const profile = (a.profileId ?? "").localeCompare(b.profileId ?? "");
    if (profile !== 0) return profile;
    // Then most urgent first.
    return (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999");
  });

  const batches: PlannedBatch[] = [];
  /** Batches already committed to each machine, across every requirement. */
  const used = new Map<string, number>();
  const slotsLeft = (m: MachineCapacity) =>
    (m.maxBatches ?? Number.POSITIVE_INFINITY) - (used.get(m.machineId) ?? 0);

  for (const item of ordered) {
    const lossPct = options.lossPct ?? DEFAULT_LOSS_PCT;
    const totalCharge = item.roastedKg / (1 - lossPct / 100);

    // Hand out one batch slot at a time to the least-loaded machine, largest
    // drum first on a tie, until the requirement is covered or every machine
    // is at its limit. Counting slots before sizing is what lets each machine's
    // share be spread evenly within that machine.
    const slots = new Map<string, number>();
    let planned = 0;
    while (planned < totalCharge - 1e-9) {
      const candidates = machines.filter((m) => slotsLeft(m) - (slots.get(m.machineId) ?? 0) > 0);
      const usable = candidates.filter((m) => (m.maxBatchKg ?? m.capacityKg) > 0);
      if (!usable.length) break;
      const machine = usable.reduce((best, m) => {
        const load = (used.get(m.machineId) ?? 0) + (slots.get(m.machineId) ?? 0);
        const bestLoad = (used.get(best.machineId) ?? 0) + (slots.get(best.machineId) ?? 0);
        if (load !== bestLoad) return load < bestLoad ? m : best;
        // Same load: prefer the bigger drum, so the day finishes sooner.
        return (m.maxBatchKg ?? m.capacityKg) > (best.maxBatchKg ?? best.capacityKg) ? m : best;
      });
      slots.set(machine.machineId, (slots.get(machine.machineId) ?? 0) + 1);
      planned += machine.maxBatchKg ?? machine.capacityKg;
    }

    if (!slots.size) {
      unscheduled.push({
        label: item.label,
        roastedKg: item.roastedKg,
        reason: machines.some((m) => (m.maxBatchKg ?? m.capacityKg) > 0)
          ? "Every machine is at its batch limit for this window"
          : "No machine has a usable capacity",
      });
      continue;
    }

    // Split the requirement between machines in proportion to the capacity
    // each one is contributing, then size that share evenly on that machine.
    const offered = [...slots.entries()].map(([machineId, n]) => {
      const m = machines.find((x) => x.machineId === machineId);
      if (!m) throw new Error(`Unknown machine ${machineId}`);
      return { machine: m, slots: n, capacity: n * (m.maxBatchKg ?? m.capacityKg) };
    });
    const offeredCapacity = offered.reduce((sum, o) => sum + o.capacity, 0);
    const coveredCharge = Math.min(totalCharge, offeredCapacity);

    let belowMinimum = false;
    for (const o of offered) {
      const shareCharge = round4((coveredCharge * o.capacity) / offeredCapacity);
      const shareRoasted = shareCharge * (1 - lossPct / 100);
      const sized = splitIntoBatches(shareRoasted, o.machine, lossPct).slice(0, o.slots);
      for (const b of sized) {
        if (b.belowMinimum) belowMinimum = true;
        const position = used.get(o.machine.machineId) ?? 0;
        batches.push({
          machineId: o.machine.machineId,
          position,
          profileId: item.profileId,
          blendId: item.blendId,
          label: item.label,
          plannedChargeKg: b.chargeKg,
          plannedYieldKg: b.yieldKg,
          demandLineIds: item.lineIds,
        });
        used.set(o.machine.machineId, position + 1);
      }
    }

    // ONE note per requirement, carrying the whole shortfall. A note per
    // unplaced batch turns a two-line warning into twenty-six and guarantees
    // nobody reads any of them.
    const shortCharge = totalCharge - coveredCharge;
    if (shortCharge > 1e-4) {
      unscheduled.push({
        label: item.label,
        roastedKg: round4(shortCharge * (1 - lossPct / 100)),
        reason: "Every machine is at its batch limit for this window",
      });
    }
    if (belowMinimum) {
      unscheduled.push({
        label: item.label,
        roastedKg: 0,
        reason: "Planned below the machine minimum batch size",
      });
    }
  }

  // Returned in the order the floor runs them: round by round, so reading down
  // the list is reading down the day.
  batches.sort((a, b) => a.position - b.position || a.machineId.localeCompare(b.machineId));

  return { batches, unscheduled };
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
