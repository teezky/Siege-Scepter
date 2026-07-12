import { POPULATION } from '../config/population.js';
import { TECHS, type TechId } from '../config/research.js';

/**
 * Folded research modifiers, threaded through the domain math as an
 * optional parameter. `NO_TECH_EFFECTS` keeps every existing call site
 * and formula unchanged when nothing is researched.
 */
export interface TechEffects {
  farmExtraSlotsPerLevel: number;
  woodStonePerWorkerBonus: number;
  taxBonusPerFreeCitizen: number;
  extraQueueSlots: number;
  arrivalIntervalMinutes: number;
  houseExtraHousingPerLevel: number;
}

export const NO_TECH_EFFECTS: TechEffects = {
  farmExtraSlotsPerLevel: 0,
  woodStonePerWorkerBonus: 0,
  taxBonusPerFreeCitizen: 0,
  extraQueueSlots: 0,
  arrivalIntervalMinutes: POPULATION.arrivalIntervalMinutes,
  houseExtraHousingPerLevel: 0
};

/** Folds the researched techs into one effects struct (pure, additive). */
export function techEffects(researched: readonly TechId[]): TechEffects {
  const effects = { ...NO_TECH_EFFECTS };
  for (const techId of researched) {
    const spec = TECHS[techId].effects;
    effects.farmExtraSlotsPerLevel += spec.farmExtraSlotsPerLevel ?? 0;
    effects.woodStonePerWorkerBonus += spec.woodStonePerWorkerBonus ?? 0;
    effects.taxBonusPerFreeCitizen += spec.taxBonusPerFreeCitizen ?? 0;
    effects.extraQueueSlots += spec.extraQueueSlots ?? 0;
    effects.arrivalIntervalMinutes -= spec.arrivalIntervalReductionMinutes ?? 0;
    effects.houseExtraHousingPerLevel += spec.houseExtraHousingPerLevel ?? 0;
  }
  effects.arrivalIntervalMinutes = Math.max(1, effects.arrivalIntervalMinutes);
  return effects;
}

export type ResearchFailure =
  | { kind: 'alreadyResearched' }
  | { kind: 'missingPrerequisite'; prerequisite: TechId }
  | { kind: 'insufficientKnowledge'; cost: number; available: number };

/** Validates a research purchase; null means it may proceed. */
export function checkResearch(
  techId: TechId,
  researched: readonly TechId[],
  knowledge: number
): ResearchFailure | null {
  const def = TECHS[techId];
  if (researched.includes(techId)) return { kind: 'alreadyResearched' };
  if (def.prerequisite && !researched.includes(def.prerequisite)) {
    return { kind: 'missingPrerequisite', prerequisite: def.prerequisite };
  }
  if (knowledge < def.knowledgeCost) {
    return { kind: 'insufficientKnowledge', cost: def.knowledgeCost, available: knowledge };
  }
  return null;
}
