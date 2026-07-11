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
  'sawmill',
  'quarry',
  'farm',
  'ironMine'
] as const;

export type BuildingId = (typeof BUILDING_IDS)[number];

export type BuildingCategory = 'core' | 'storage' | 'production';

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
  /** Resource production, if this is a production building. */
  production?: {
    resource: ResourceId;
    /** Production per hour at level 1. */
    basePerHour: number;
    /** Multiplier applied per level above 1. */
    growthFactor: number;
  };
  /** Storage capacity contribution, if this is a storage building. */
  storage?: {
    baseCapacity: number;
    growthFactor: number;
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
    // Documented assumption for slice 1: the town hall produces a small coin
    // income representing taxes, until the population system arrives.
    production: { resource: 'coins', basePerHour: 40, growthFactor: 1.25 },
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
  sawmill: {
    id: 'sawmill',
    category: 'production',
    maxLevel: 20,
    baseCost: { wood: 60, stone: 30 },
    costGrowthFactor: 1.45,
    baseBuildSeconds: 25,
    buildTimeGrowthFactor: 1.5,
    production: { resource: 'wood', basePerHour: 120, growthFactor: 1.22 },
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
    production: { resource: 'stone', basePerHour: 90, growthFactor: 1.22 },
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
    production: { resource: 'food', basePerHour: 110, growthFactor: 1.22 },
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
    production: { resource: 'iron', basePerHour: 60, growthFactor: 1.22 },
    prerequisites: [{ buildingId: 'townHall', level: 3 }]
  }
};

/** Buildings every new city starts with (design doc: playable from minute one). */
export const STARTING_BUILDINGS: ReadonlyArray<{ buildingId: BuildingId; level: number }> = [
  { buildingId: 'townHall', level: 1 },
  { buildingId: 'sawmill', level: 1 },
  { buildingId: 'farm', level: 1 }
];

/** One active construction plus this many queued (design doc section 12.4). */
export const MAX_CONSTRUCTION_QUEUE_LENGTH = 3;
