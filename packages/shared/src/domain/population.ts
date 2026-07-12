import { BUILDINGS, type BuildingId } from '../config/buildings.js';
import { POPULATION } from '../config/population.js';
import {
  RESOURCE_IDS,
  STORAGE_CAPPED_RESOURCES,
  emptyResourceAmounts,
  type ResourceAmounts
} from '../config/resources.js';
import { buildingProductionPerHour, cityStorageCapacity } from './buildings.js';

/**
 * Population + resource simulation (project instructions section 9).
 *
 * The city's state is stored at a reference time and advanced on demand by
 * `advanceCity`, a pure deterministic function shared by server and client,
 * so both always agree. Between events every rate is constant; the only
 * events are (a) a citizen arriving and (b) food storage running dry.
 * Construction completions are handled by the server BETWEEN calls: it
 * settles state at each completion moment, so within one `advanceCity` call
 * the building levels never change.
 */

export interface CityBuildingState {
  buildingId: BuildingId;
  level: number;
  /** Workers assigned to this building (0 for non-production buildings). */
  workers: number;
}

/** Citizens the city can house (base + town hall + houses). */
export function cityHousingCapacity(buildings: readonly CityBuildingState[]): number {
  let capacity = POPULATION.baseHousing;
  for (const { buildingId, level } of buildings) {
    const housing = BUILDINGS[buildingId].housing;
    if (housing && level > 0) capacity += housing.perLevel * level;
  }
  return capacity;
}

/** Workers assigned across all buildings. */
export function assignedWorkers(buildings: readonly CityBuildingState[]): number {
  return buildings.reduce((sum, b) => sum + b.workers, 0);
}

/**
 * Net per-resource rates per hour: worker production, minus food eaten by
 * the whole population, plus taxes paid by free citizens. Integers only.
 * Note: the food rate may be negative; `advanceCity` clamps stock at zero
 * (famine pauses growth but never kills citizens — design doc 11.2).
 */
export function cityRatesPerHour(
  buildings: readonly CityBuildingState[],
  population: number
): ResourceAmounts {
  const rates = emptyResourceAmounts();
  for (const building of buildings) {
    const def = BUILDINGS[building.buildingId];
    if (def.production && building.level > 0) {
      rates[def.production.resource] += buildingProductionPerHour(def, building.workers);
    }
  }
  rates.food -= population * POPULATION.foodPerCitizenPerHour;
  const free = Math.max(0, population - assignedWorkers(buildings));
  rates.coins += free * POPULATION.taxCoinsPerFreeCitizenPerHour;
  return rates;
}

export interface CitySimState {
  /** Amounts at refTime (integers in storage; fractions only inside a walk). */
  amounts: ResourceAmounts;
  population: number;
  /** When the next citizen arrives; null while housing is full. */
  nextArrivalAtMs: number | null;
  refTimeMs: number;
}

export interface CitySimResult {
  /** Floored to integers — safe to persist or display. */
  amounts: ResourceAmounts;
  population: number;
  nextArrivalAtMs: number | null;
  /** Rates in effect at the target time (net, incl. food upkeep and taxes). */
  ratesPerHour: ResourceAmounts;
}

const MS_PER_HOUR = 3_600_000;
const ARRIVAL_INTERVAL_MS = POPULATION.arrivalIntervalMinutes * 60_000;

/**
 * Advances city state from `state.refTimeMs` to `targetMs`.
 * Pure and deterministic; never mutates its input.
 */
export function advanceCity(
  state: CitySimState,
  buildings: readonly CityBuildingState[],
  targetMs: number
): CitySimResult {
  const capacity = cityStorageCapacity(buildings);
  const housing = cityHousingCapacity(buildings);

  const amounts: ResourceAmounts = { ...state.amounts };
  let population = state.population;
  let nextArrivalAtMs = state.nextArrivalAtMs;
  let t = state.refTimeMs;

  // A housing upgrade may have re-opened growth since the state was written.
  if (nextArrivalAtMs === null && population < housing) {
    nextArrivalAtMs = t + ARRIVAL_INTERVAL_MS;
  }

  // Each iteration advances to the next event or to the target. Arrivals are
  // at least one interval apart, so iterations are bounded; the cap is a
  // safety net against config mistakes, not a code path.
  const maxIterations = Math.ceil((targetMs - t) / ARRIVAL_INTERVAL_MS) + RESOURCE_IDS.length + 8;
  for (let i = 0; i < maxIterations && t < targetMs; i++) {
    const rates = cityRatesPerHour(buildings, population);
    const famine = amounts.food <= 0 && rates.food < 0;

    let next = targetMs;
    let event: 'arrival' | 'foodZero' | null = null;
    if (nextArrivalAtMs !== null && nextArrivalAtMs <= next) {
      next = Math.max(t, nextArrivalAtMs);
      event = 'arrival';
    }
    if (!famine && rates.food < 0 && amounts.food > 0) {
      const foodZeroAt = t + (amounts.food / -rates.food) * MS_PER_HOUR;
      if (foodZeroAt < next) {
        next = foodZeroAt;
        event = 'foodZero';
      }
    }

    // Advance every resource linearly across [t, next].
    const elapsed = next - t;
    for (const resource of RESOURCE_IDS) {
      const rate = resource === 'food' && famine ? 0 : rates[resource];
      const raw = amounts[resource] + (elapsed * rate) / MS_PER_HOUR;
      const capped = STORAGE_CAPPED_RESOURCES.includes(resource);
      let value = raw;
      if (capped && raw > capacity) value = Math.max(amounts[resource], capacity);
      amounts[resource] = Math.max(0, value);
    }
    t = next;

    if (event === 'foodZero') {
      amounts.food = 0; // snap away float residue so the famine branch engages
    } else if (event === 'arrival' && nextArrivalAtMs !== null) {
      if (population >= housing) {
        nextArrivalAtMs = null;
      } else if (amounts.food > 0) {
        population += 1;
        nextArrivalAtMs = population < housing ? nextArrivalAtMs + ARRIVAL_INTERVAL_MS : null;
      } else {
        // Famine: nobody moves in; try again one interval later.
        nextArrivalAtMs = nextArrivalAtMs + ARRIVAL_INTERVAL_MS;
      }
    }
  }

  for (const resource of RESOURCE_IDS) {
    amounts[resource] = Math.floor(amounts[resource]);
  }
  return { amounts, population, nextArrivalAtMs, ratesPerHour: cityRatesPerHour(buildings, population) };
}
