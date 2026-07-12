import { describe, expect, it } from 'vitest';
import {
  BUILDINGS,
  NO_TECH_EFFECTS,
  POPULATION,
  advanceCity,
  buildingProductionPerHour,
  buildingWorkerSlots,
  checkResearch,
  cityHousingCapacity,
  cityRatesPerHour,
  emptyResourceAmounts,
  techEffects,
  type CityBuildingState
} from '../src/index.js';

describe('techEffects', () => {
  it('returns baseline effects for no research', () => {
    const effects = techEffects([]);
    expect(effects).toEqual(NO_TECH_EFFECTS);
    expect(effects.arrivalIntervalMinutes).toBe(POPULATION.arrivalIntervalMinutes);
  });

  it('folds researched techs additively', () => {
    const effects = techEffects(['cropRotation', 'stoneTools', 'sanitation']);
    expect(effects.farmExtraSlotsPerLevel).toBe(2);
    expect(effects.woodStonePerWorkerBonus).toBe(5);
    expect(effects.arrivalIntervalMinutes).toBe(10);
    expect(effects.extraQueueSlots).toBe(0);
  });
});

describe('checkResearch', () => {
  it('rejects an already researched tech', () => {
    expect(checkResearch('cropRotation', ['cropRotation'], 1000)).toEqual({
      kind: 'alreadyResearched'
    });
  });

  it('enforces the prerequisite chain', () => {
    expect(checkResearch('bookkeeping', [], 1000)).toEqual({
      kind: 'missingPrerequisite',
      prerequisite: 'cropRotation'
    });
    expect(checkResearch('bookkeeping', ['cropRotation'], 1000)).toBeNull();
  });

  it('rejects insufficient knowledge', () => {
    expect(checkResearch('stoneTools', [], 100)).toEqual({
      kind: 'insufficientKnowledge',
      cost: 120,
      available: 100
    });
    expect(checkResearch('stoneTools', [], 120)).toBeNull();
  });
});

describe('tech effects on domain math', () => {
  const farm = BUILDINGS.farm;
  const sawmill = BUILDINGS.sawmill;
  const academy = BUILDINGS.academy;

  it('crop rotation adds farm slots, not sawmill slots', () => {
    const effects = techEffects(['cropRotation']);
    expect(buildingWorkerSlots(farm, 2, effects)).toBe(16); // (6+2)×2
    expect(buildingWorkerSlots(sawmill, 2, effects)).toBe(12);
  });

  it('stone tools boost sawmill/quarry per-worker output only', () => {
    const effects = techEffects(['stoneTools']);
    expect(buildingProductionPerHour(sawmill, 4, effects)).toBe(100); // (20+5)×4
    expect(buildingProductionPerHour(farm, 4, effects)).toBe(72);
    expect(buildingProductionPerHour(academy, 4, effects)).toBe(24);
  });

  it('bookkeeping raises the tax rate of free citizens', () => {
    const buildings: CityBuildingState[] = [{ buildingId: 'townHall', level: 1, workers: 0 }];
    const effects = techEffects(['cropRotation', 'bookkeeping']);
    // 10 free citizens × (4+1)
    expect(cityRatesPerHour(buildings, 10, effects).coins).toBe(50);
  });

  it('urban planning enlarges houses only', () => {
    const buildings: CityBuildingState[] = [
      { buildingId: 'townHall', level: 1, workers: 0 },
      { buildingId: 'house', level: 2, workers: 0 }
    ];
    expect(cityHousingCapacity(buildings)).toBe(58); // 10 + 20 + 28
    const effects = techEffects(['sanitation', 'urbanPlanning']);
    expect(cityHousingCapacity(buildings, effects)).toBe(70); // houses (14+6)×2
  });

  it('sanitation speeds up arrivals in the simulation', () => {
    const buildings: CityBuildingState[] = [
      { buildingId: 'townHall', level: 1, workers: 0 },
      { buildingId: 'farm', level: 1, workers: 4 }
    ];
    const state = {
      amounts: { ...emptyResourceAmounts(), food: 500 },
      population: 12,
      nextArrivalAtMs: 10 * 60_000,
      refTimeMs: 0
    };
    const hour = 3_600_000;
    const baseline = advanceCity(state, buildings, hour);
    const faster = advanceCity(state, buildings, hour, techEffects(['sanitation']));
    // Baseline: arrivals at 10,25,40,55 → +4. Sanitation: 10,20,30,40,50,60 → +6.
    expect(baseline.population).toBe(16);
    expect(faster.population).toBe(18);
  });

  it('academy scientists produce knowledge, uncapped by storage', () => {
    const buildings: CityBuildingState[] = [
      { buildingId: 'townHall', level: 1, workers: 0 },
      { buildingId: 'farm', level: 1, workers: 6 },
      { buildingId: 'academy', level: 1, workers: 4 }
    ];
    const rates = cityRatesPerHour(buildings, 12);
    expect(rates.knowledge).toBe(24); // 4 × 6
    const result = advanceCity(
      {
        amounts: emptyResourceAmounts(),
        population: 30,
        nextArrivalAtMs: null,
        refTimeMs: 0
      },
      buildings,
      1000 * 3_600_000
    );
    // 24/h × 1000h, far beyond storage capacity 1200 — knowledge is uncapped.
    expect(result.amounts.knowledge).toBe(24_000);
  });
});
