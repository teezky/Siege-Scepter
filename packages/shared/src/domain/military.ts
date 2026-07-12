import {
  PVE_ENCOUNTERS,
  UNIT_IDS,
  UNITS,
  emptyUnitCounts,
  type PveEncounterId,
  type UnitCounts,
  type UnitId
} from '../config/military.js';
import type { ResourceId } from '../config/resources.js';

export function unitRecruitmentCost(
  unitId: UnitId,
  quantity: number
): Partial<Record<ResourceId, number>> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError('Recruitment quantity must be a positive integer');
  }
  return Object.fromEntries(
    Object.entries(UNITS[unitId].baseCost).map(([resource, amount]) => [resource, amount * quantity])
  ) as Partial<Record<ResourceId, number>>;
}
export function armyPower(units: UnitCounts): number {
  return UNIT_IDS.reduce((sum, unitId) => sum + units[unitId] * UNITS[unitId].power, 0);
}

export function armyPopulation(units: UnitCounts): number {
  return UNIT_IDS.reduce(
    (sum, unitId) => sum + units[unitId] * UNITS[unitId].populationCost,
    0
  );
}

export interface PveBattleResult {
  encounterId: PveEncounterId;
  victory: boolean;
  attackerPower: number;
  defenderPower: number;
  unitsSent: UnitCounts;
  unitsLost: UnitCounts;
  survivors: UnitCounts;
  reward: Partial<Record<ResourceId, number>>;
}

/**
 * Deterministic MVP battle resolution. Losses are meaningful but bounded:
 * a victory loses at most 25% (before integer rounding), while a defeat loses
 * at most 65%. The same input always produces the same auditable report.
 */
export function resolvePveBattle(
  units: UnitCounts,
  encounterId: PveEncounterId
): PveBattleResult {
  const encounter = PVE_ENCOUNTERS[encounterId];
  const attackerPower = armyPower(units);
  const victory = attackerPower >= encounter.defenderPower;
  const pressure = encounter.defenderPower / Math.max(1, attackerPower);
  const lossRate = victory
    ? Math.min(0.25, 0.1 + pressure * 0.15)
    : Math.min(0.65, 0.35 + pressure * 0.2);

  const unitsLost = emptyUnitCounts();
  const survivors = emptyUnitCounts();
  for (const unitId of UNIT_IDS) {
    const count = units[unitId];
    const lost = count === 0 ? 0 : Math.min(count, Math.ceil(count * lossRate));
    unitsLost[unitId] = lost;
    survivors[unitId] = count - lost;
  }

  return {
    encounterId,
    victory,
    attackerPower,
    defenderPower: encounter.defenderPower,
    unitsSent: { ...units },
    unitsLost,
    survivors,
    reward: victory ? { ...encounter.reward } : {}
  };
}
