/**
 * Resource definitions — the authoritative list of resource types.
 *
 * Source of truth: game design document, section 9 ("Ressursside süsteem").
 * MVP slice 1 uses the five tradable base resources; `knowledge` is defined
 * in the type for forward compatibility but has no producer yet (research
 * arrives in a later slice).
 */
export const RESOURCE_IDS = ['wood', 'stone', 'food', 'iron', 'coins'] as const;

export type ResourceId = (typeof RESOURCE_IDS)[number];

export type ResourceAmounts = Record<ResourceId, number>;

export function emptyResourceAmounts(): ResourceAmounts {
  return { wood: 0, stone: 0, food: 0, iron: 0, coins: 0 };
}

/** Resources a newly founded first city starts with. */
export const STARTING_RESOURCES: ResourceAmounts = {
  wood: 300,
  stone: 200,
  food: 200,
  iron: 60,
  coins: 120
};

/**
 * Storage capacity every city has even without a warehouse.
 * Sized so the early game holds roughly 24h of production
 * (design doc section 10.2).
 */
export const BASE_STORAGE_CAPACITY = 1200;

/** Coins are not capped by warehouse storage in slice 1 (documented assumption). */
export const STORAGE_CAPPED_RESOURCES: readonly ResourceId[] = ['wood', 'stone', 'food', 'iron'];
