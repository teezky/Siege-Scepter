import type { BuildingDefinition, BuildingId } from '../config/buildings.js';
import { BUILDINGS } from '../config/buildings.js';
import type { ResourceId } from '../config/resources.js';
import { BASE_STORAGE_CAPACITY } from '../config/resources.js';
import { NO_TECH_EFFECTS, type TechEffects } from './research.js';

/**
 * Pure balancing math for buildings. Integer results only — rounding happens
 * here and nowhere else, so frontend and backend can never disagree
 * (project instructions section 13).
 */

function scaledInt(base: number, factor: number, level: number): number {
  return Math.round(base * Math.pow(factor, level - 1));
}

/** Cost of upgrading a building TO the given level. */
export function buildingLevelCost(def: BuildingDefinition, level: number): Partial<Record<ResourceId, number>> {
  assertValidLevel(def, level);
  const cost: Partial<Record<ResourceId, number>> = {};
  for (const [resource, base] of Object.entries(def.baseCost) as [ResourceId, number][]) {
    cost[resource] = scaledInt(base, def.costGrowthFactor, level);
  }
  return cost;
}

/** Build time in whole seconds for upgrading TO the given level. */
export function buildingLevelSeconds(def: BuildingDefinition, level: number): number {
  assertValidLevel(def, level);
  return scaledInt(def.baseBuildSeconds, def.buildTimeGrowthFactor, level);
}

/** Worker slots a production building offers at the given level. */
export function buildingWorkerSlots(
  def: BuildingDefinition,
  level: number,
  effects: TechEffects = NO_TECH_EFFECTS
): number {
  if (!def.production || level <= 0) return 0;
  const extra = def.id === 'farm' ? effects.farmExtraSlotsPerLevel : 0;
  return (def.production.workerSlotsPerLevel + extra) * level;
}

/** Production per hour of a single building given its assigned workers. */
export function buildingProductionPerHour(
  def: BuildingDefinition,
  workers: number,
  effects: TechEffects = NO_TECH_EFFECTS
): number {
  if (!def.production || workers <= 0) return 0;
  const bonus = def.id === 'sawmill' || def.id === 'quarry' ? effects.woodStonePerWorkerBonus : 0;
  return (def.production.perWorkerPerHour + bonus) * workers;
}

/** Storage capacity contributed by a single building at the given level. */
export function buildingStorageCapacity(def: BuildingDefinition, level: number): number {
  if (!def.storage || level <= 0) return 0;
  return scaledInt(def.storage.baseCapacity, def.storage.growthFactor, level);
}

export interface CityBuildingLevel {
  buildingId: BuildingId;
  level: number;
}

/** Total storage capacity of a city (base + storage buildings). */
export function cityStorageCapacity(buildings: readonly CityBuildingLevel[]): number {
  let capacity = BASE_STORAGE_CAPACITY;
  for (const { buildingId, level } of buildings) {
    capacity += buildingStorageCapacity(BUILDINGS[buildingId], level);
  }
  return capacity;
}

export type PrerequisiteFailure =
  | { kind: 'maxLevelReached'; buildingId: BuildingId }
  | { kind: 'missingPrerequisite'; buildingId: BuildingId; requiredLevel: number };

/**
 * Checks whether a building may be upgraded/built to `targetLevel`,
 * given current levels (including levels already promised by the
 * construction queue — the caller decides what to pass).
 */
export function checkBuildingPrerequisites(
  buildingId: BuildingId,
  targetLevel: number,
  currentLevels: ReadonlyMap<BuildingId, number>
): PrerequisiteFailure | null {
  const def = BUILDINGS[buildingId];
  if (targetLevel > def.maxLevel) {
    return { kind: 'maxLevelReached', buildingId };
  }
  for (const prereq of def.prerequisites) {
    if ((currentLevels.get(prereq.buildingId) ?? 0) < prereq.level) {
      return { kind: 'missingPrerequisite', buildingId: prereq.buildingId, requiredLevel: prereq.level };
    }
  }
  return null;
}

function assertValidLevel(def: BuildingDefinition, level: number): void {
  if (!Number.isInteger(level) || level < 1 || level > def.maxLevel) {
    throw new RangeError(`Invalid level ${level} for building ${def.id} (max ${def.maxLevel})`);
  }
}
