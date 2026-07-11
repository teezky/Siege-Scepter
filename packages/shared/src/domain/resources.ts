import type { ResourceAmounts, ResourceId } from '../config/resources.js';
import { RESOURCE_IDS, STORAGE_CAPPED_RESOURCES, emptyResourceAmounts } from '../config/resources.js';

/**
 * Time-based resource calculation (project instructions section 9).
 *
 * We never store a continuously ticking total. We store the amount at a
 * reference time plus a production rate, and compute the current amount
 * from elapsed server time. All results are integers; fractional production
 * within an interval is floored. When production inputs change, the caller
 * must persist the computed amount and reset the reference timestamp.
 */

export interface ResourceStateAtRef {
  /** Integer amount at the reference time. */
  amountAtRef: number;
  /** Production per hour (integer). */
  ratePerHour: number;
}

export function currentAmount(
  state: ResourceStateAtRef,
  refTimeMs: number,
  nowMs: number,
  capacity: number | null
): number {
  const elapsedMs = Math.max(0, nowMs - refTimeMs);
  const produced = Math.floor((elapsedMs * state.ratePerHour) / 3_600_000);
  const raw = state.amountAtRef + produced;
  if (capacity === null) return raw;
  // Never destroy an existing overflow (e.g. capacity shrank), but never grow past it.
  return raw > capacity ? Math.max(state.amountAtRef, capacity) : raw;
}

export interface CityResourceSnapshot {
  amounts: ResourceAmounts;
  ratesPerHour: ResourceAmounts;
  refTimeMs: number;
  storageCapacity: number;
}

/** Current amounts for every resource of a city. */
export function currentAmounts(snapshot: CityResourceSnapshot, nowMs: number): ResourceAmounts {
  const result = emptyResourceAmounts();
  for (const resource of RESOURCE_IDS) {
    const capped = STORAGE_CAPPED_RESOURCES.includes(resource);
    result[resource] = currentAmount(
      { amountAtRef: snapshot.amounts[resource], ratePerHour: snapshot.ratesPerHour[resource] },
      snapshot.refTimeMs,
      nowMs,
      capped ? snapshot.storageCapacity : null
    );
  }
  return result;
}

/** True if `amounts` covers `cost` for every resource. */
export function canAfford(amounts: ResourceAmounts, cost: Partial<Record<ResourceId, number>>): boolean {
  return (Object.entries(cost) as [ResourceId, number][]).every(
    ([resource, needed]) => amounts[resource] >= needed
  );
}

/** Returns new amounts with `cost` subtracted. Throws if unaffordable. */
export function subtractCost(
  amounts: ResourceAmounts,
  cost: Partial<Record<ResourceId, number>>
): ResourceAmounts {
  if (!canAfford(amounts, cost)) {
    throw new RangeError('Insufficient resources');
  }
  const result = { ...amounts };
  for (const [resource, needed] of Object.entries(cost) as [ResourceId, number][]) {
    result[resource] -= needed;
  }
  return result;
}
