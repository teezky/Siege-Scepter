/**
 * Research tree — slice 3 ships the MVP's "simple research tree"
 * (design doc sections 16 and 36): three branches, two technologies each.
 *
 * Design rules honoured here:
 * - A technology must change how the game plays, not only a number
 *   (16.4) — each effect below unlocks capacity, speed or a new option.
 * - Knowledge is produced by scientists in academies into the player's
 *   pool (16.1) and cannot be bought or traded (9, 33.2).
 * - Research is an instant purchase; pacing comes from how fast the
 *   player's scientists accumulate knowledge.
 */

export const TECH_IDS = [
  'cropRotation',
  'bookkeeping',
  'stoneTools',
  'constructionCranes',
  'sanitation',
  'urbanPlanning'
] as const;

export type TechId = (typeof TECH_IDS)[number];

export type TechBranch = 'economy' | 'engineering' | 'culture';

/**
 * Additive gameplay modifiers granted by researched technologies.
 * `techEffects` in the domain layer folds researched techs into one struct.
 */
export interface TechEffectSpec {
  /** Extra worker slots per farm level. */
  farmExtraSlotsPerLevel?: number;
  /** Extra output per worker/hour in sawmills and quarries. */
  woodStonePerWorkerBonus?: number;
  /** Extra tax coins per free citizen per hour. */
  taxBonusPerFreeCitizen?: number;
  /** Extra waiting slots in the construction queue. */
  extraQueueSlots?: number;
  /** Minutes shaved off the citizen arrival interval. */
  arrivalIntervalReductionMinutes?: number;
  /** Extra housing per house level. */
  houseExtraHousingPerLevel?: number;
}

export interface TechDefinition {
  id: TechId;
  branch: TechBranch;
  name: string;
  description: string;
  knowledgeCost: number;
  /** Must be researched first (same branch, linear chains in this slice). */
  prerequisite: TechId | null;
  effects: TechEffectSpec;
}

export const TECHS: Record<TechId, TechDefinition> = {
  cropRotation: {
    id: 'cropRotation',
    branch: 'economy',
    name: 'Crop Rotation',
    description: 'Farms support 2 extra workers per level.',
    knowledgeCost: 120,
    prerequisite: null,
    effects: { farmExtraSlotsPerLevel: 2 }
  },
  bookkeeping: {
    id: 'bookkeeping',
    branch: 'economy',
    name: 'Bookkeeping',
    description: 'Free citizens pay 1 extra coin per hour in taxes.',
    knowledgeCost: 320,
    prerequisite: 'cropRotation',
    effects: { taxBonusPerFreeCitizen: 1 }
  },
  stoneTools: {
    id: 'stoneTools',
    branch: 'engineering',
    name: 'Stone Tools',
    description: 'Sawmill and quarry workers produce 5 more per hour.',
    knowledgeCost: 120,
    prerequisite: null,
    effects: { woodStonePerWorkerBonus: 5 }
  },
  constructionCranes: {
    id: 'constructionCranes',
    branch: 'engineering',
    name: 'Construction Cranes',
    description: 'The construction queue holds 2 more waiting orders.',
    knowledgeCost: 320,
    prerequisite: 'stoneTools',
    effects: { extraQueueSlots: 2 }
  },
  sanitation: {
    id: 'sanitation',
    branch: 'culture',
    name: 'Sanitation',
    description: 'New citizens arrive every 10 minutes instead of 15.',
    knowledgeCost: 160,
    prerequisite: null,
    effects: { arrivalIntervalReductionMinutes: 5 }
  },
  urbanPlanning: {
    id: 'urbanPlanning',
    branch: 'culture',
    name: 'Urban Planning',
    description: 'Houses shelter 6 extra citizens per level.',
    knowledgeCost: 320,
    prerequisite: 'sanitation',
    effects: { houseExtraHousingPerLevel: 6 }
  }
};

export const TECH_BRANCH_LABELS: Record<TechBranch, string> = {
  economy: 'Economy',
  engineering: 'Engineering',
  culture: 'Culture'
};
