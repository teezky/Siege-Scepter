import type { ResourceId } from './resources.js';

/**
 * Building definitions — centralized, typed balancing configuration.
 *
 * Source of truth: game design document, sections 12 ("Linnaehitus") and 14,
 * and project instructions section 14 ("Balancing and configuration").
 *
 * Slice 1 ships a deliberately small set: town hall, warehouse and the four
 * primary production buildings. More buildings arrive with later slices.
 */

export const BUILDING_IDS = [
  'townHall',
  'warehouse',
  'house',
  'sawmill',
  'quarry',
  'farm',
  'ironMine'
] as const;

export type BuildingId = (typeof BUILDING_IDS)[number];

export type BuildingCategory = 'core' | 'storage' | 'housing' | 'production';

export interface BuildingPrerequisite {
  buildingId: BuildingId;
  level: number;
}

export interface BuildingDefinition {
  id: BuildingId;
  category: BuildingCategory;
  maxLevel: number;
  /** Cost of level 1. Higher levels scale by costGrowthFactor^(level-1). */
  baseCost: Partial<Record<ResourceId, number>>;
  costGrowthFactor: number;
  /** Build time of level 1 in seconds. Scales by buildTimeGrowthFactor^(level-1). */
  baseBuildSeconds: number;
  buildTimeGrowthFactor: number;
  /**
   * Resource production, if this is a production building.
   * Since the population slice, output comes from assigned workers:
   * production/hour = assigned workers × perWorkerPerHour. Levels add
   * worker slots instead of raw output.
   */
  production?: {
    resource: ResourceId;
    /** Output per assigned worker per hour. */
    perWorkerPerHour: number;
    /** Worker slots added by each building level. */
    workerSlotsPerLevel: number;
  };
  /** Storage capacity contribution, if this is a storage building. */
  storage?: {
    baseCapacity: number;
    growthFactor: number;
  };
  /** Housing contribution: `perLevel × level` citizens can live here. */
  housing?: {
    perLevel: number;
  };
  prerequisites: BuildingPrerequisite[];
}

export const BUILDINGS: Record<BuildingId, BuildingDefinition> = {
  townHall: {
    id: 'townHall',
    category: 'core',
    maxLevel: 20,
    baseCost: { wood: 120, stone: 100 },
    costGrowthFactor: 1.5,
    baseBuildSeconds: 30,
    buildTimeGrowthFactor: 1.55,
    // Taxes now come from free citizens (population system); the town hall
    // contributes administrative housing instead of the old coin placeholder.
    housing: { perLevel: 20 },
    prerequisites: []
  },
  warehouse: {
    id: 'warehouse',
    category: 'storage',
    maxLevel: 20,
    baseCost: { wood: 100, stone: 60 },
    costGrowthFactor: 1.45,
    baseBuildSeconds: 40,
    buildTimeGrowthFactor: 1.5,
    storage: { baseCapacity: 1500, growthFactor: 1.35 },
    prerequisites: []
  },
  house: {
    id: 'house',
    category: 'housing',
    maxLevel: 20,
    baseCost: { wood: 50, stone: 25 },
    costGrowthFactor: 1.4,
    baseBuildSeconds: 20,
    buildTimeGrowthFactor: 1.45,
    housing: { perLevel: 14 },
    prerequisites: []
  },
  sawmill: {
    id: 'sawmill',
    category: 'production',
    maxLevel: 20,
    baseCost: { wood: 60, stone: 30 },
    costGrowthFactor: 1.45,
    baseBuildSeconds: 25,
    buildTimeGrowthFactor: 1.5,
    production: { resource: 'wood', perWorkerPerHour: 20, workerSlotsPerLevel: 6 },
    prerequisites: []
  },
  quarry: {
    id: 'quarry',
    category: 'production',
    maxLevel: 20,
    baseCost: { wood: 80, stone: 20 },
    costGrowthFactor: 1.45,
    baseBuildSeconds: 25,
    buildTimeGrowthFactor: 1.5,
    production: { resource: 'stone', perWorkerPerHour: 15, workerSlotsPerLevel: 6 },
    prerequisites: []
  },
  farm: {
    id: 'farm',
    category: 'production',
    maxLevel: 20,
    baseCost: { wood: 70, stone: 20 },
    costGrowthFactor: 1.45,
    baseBuildSeconds: 25,
    buildTimeGrowthFactor: 1.5,
    production: { resource: 'food', perWorkerPerHour: 18, workerSlotsPerLevel: 6 },
    prerequisites: []
  },
  ironMine: {
    id: 'ironMine',
    category: 'production',
    maxLevel: 20,
    baseCost: { wood: 120, stone: 80 },
    costGrowthFactor: 1.5,
    baseBuildSeconds: 60,
    buildTimeGrowthFactor: 1.5,
    production: { resource: 'iron', perWorkerPerHour: 10, workerSlotsPerLevel: 6 },
    prerequisites: [{ buildingId: 'townHall', level: 3 }]
  }
};

/** Buildings every new city starts with (design doc: playable from minute one). */
export const STARTING_BUILDINGS: ReadonlyArray<{ buildingId: BuildingId; level: number }> = [
  { buildingId: 'townHall', level: 1 },
  { buildingId: 'sawmill', level: 1 },
  { buildingId: 'farm', level: 1 }
];

/**
 * Workers a new city starts with already assigned, so production is visible
 * from minute one. The remaining citizens are free (they pay taxes).
 */
export const STARTING_WORKER_ALLOCATION: Readonly<Partial<Record<BuildingId, number>>> = {
  sawmill: 4,
  farm: 4
};

/** One active construction plus this many queued (design doc section 12.4). */
export const MAX_CONSTRUCTION_QUEUE_LENGTH = 3;
