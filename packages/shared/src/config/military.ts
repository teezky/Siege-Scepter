import type { ResourceId } from './resources.js';

/**
 * Minimal army + PvE configuration for MVP stage 1 (design doc sections 18,
 * 20 and 36). The slice intentionally starts with two useful unit classes and
 * two local threats; commanders, equipment and formations arrive later.
 */
export const UNIT_IDS = ['spearman', 'archer'] as const;

export type UnitId = (typeof UNIT_IDS)[number];
export type UnitCounts = Record<UnitId, number>;

export interface UnitDefinition {
  id: UnitId;
  name: string;
  description: string;
  power: number;
  populationCost: number;
  baseCost: Partial<Record<ResourceId, number>>;
  requiredBarracksLevel: number;
}

export const UNITS: Record<UnitId, UnitDefinition> = {
  spearman: {
    id: 'spearman',
    name: 'Spearman',
    description: 'Reliable and inexpensive line infantry.',
    power: 10,
    populationCost: 1,
    baseCost: { wood: 15, food: 20, iron: 5 },
    requiredBarracksLevel: 1
  },
  archer: {
    id: 'archer',
    name: 'Archer',
    description: 'Stronger ranged troops with a higher iron cost.',
    power: 16,
    populationCost: 1,
    baseCost: { wood: 20, food: 25, iron: 10 },
    requiredBarracksLevel: 1
  }
};
export function emptyUnitCounts(): UnitCounts {
  return { spearman: 0, archer: 0 };
}

export const PVE_ENCOUNTER_IDS = ['banditCamp', 'raiderOutpost'] as const;
export type PveEncounterId = (typeof PVE_ENCOUNTER_IDS)[number];

export interface PveEncounterDefinition {
  id: PveEncounterId;
  name: string;
  description: string;
  defenderPower: number;
  reward: Partial<Record<ResourceId, number>>;
  prerequisite: PveEncounterId | null;
}

export const PVE_ENCOUNTERS: Record<PveEncounterId, PveEncounterDefinition> = {
  banditCamp: {
    id: 'banditCamp',
    name: 'Bandit Camp',
    description: 'A small camp threatening the roads outside your settlement.',
    defenderPower: 60,
    reward: { wood: 180, stone: 100, coins: 60 },
    prerequisite: null
  },
  raiderOutpost: {
    id: 'raiderOutpost',
    name: 'Raider Outpost',
    description: 'A fortified outpost occupied by experienced raiders.',
    defenderPower: 140,
    reward: { wood: 250, stone: 220, iron: 80, coins: 120 },
    prerequisite: 'banditCamp'
  }
};
