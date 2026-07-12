import { describe, expect, it } from 'vitest';
import {
  POPULATION,
  advanceCity,
  assignedWorkers,
  cityHousingCapacity,
  cityRatesPerHour,
  emptyResourceAmounts,
  type CityBuildingState,
  type CitySimState
} from '../src/index.js';

const HOUR = 3_600_000;
const ARRIVAL_MS = POPULATION.arrivalIntervalMinutes * 60_000;

/** townHall 1 (20 housing) + base 10 = 30 housing. */
function startingBuildings(): CityBuildingState[] {
  return [
    { buildingId: 'townHall', level: 1, workers: 0 },
    { buildingId: 'sawmill', level: 1, workers: 4 },
    { buildingId: 'farm', level: 1, workers: 4 }
  ];
}

function state(overrides: Partial<CitySimState> = {}): CitySimState {
  return {
    amounts: { ...emptyResourceAmounts(), wood: 300, stone: 200, food: 200, iron: 60, coins: 120 },
    population: 12,
    nextArrivalAtMs: ARRIVAL_MS,
    refTimeMs: 0,
    ...overrides
  };
}

describe('cityHousingCapacity', () => {
  it('sums base, town hall and houses', () => {
    expect(cityHousingCapacity(startingBuildings())).toBe(30);
    expect(
      cityHousingCapacity([...startingBuildings(), { buildingId: 'house', level: 2, workers: 0 }])
    ).toBe(58);
  });
});

describe('cityRatesPerHour', () => {
  it('produces from workers, feeds everyone, taxes free citizens', () => {
    const rates = cityRatesPerHour(startingBuildings(), 12);
    expect(rates.wood).toBe(80); // 4 × 20
    // farm 4 × 18 = 72 minus 12 × 2 = 24 upkeep
    expect(rates.food).toBe(48);
    // 12 − 8 workers = 4 free × 4 coins
    expect(rates.coins).toBe(16);
    expect(rates.stone).toBe(0);
  });

  it('unstaffed production buildings produce nothing', () => {
    const buildings: CityBuildingState[] = [
      { buildingId: 'townHall', level: 1, workers: 0 },
      { buildingId: 'sawmill', level: 3, workers: 0 }
    ];
    expect(cityRatesPerHour(buildings, 10).wood).toBe(0);
  });

  it('food rate can be negative when upkeep exceeds farming', () => {
    const buildings: CityBuildingState[] = [{ buildingId: 'townHall', level: 1, workers: 0 }];
    expect(cityRatesPerHour(buildings, 10).food).toBe(-20);
  });
});

describe('advanceCity', () => {
  it('accumulates resources linearly between events', () => {
    const result = advanceCity(state({ nextArrivalAtMs: null, population: 30 }), startingBuildings(), HOUR);
    // population 30 = housing cap, no arrivals; food: 72 − 60 = +12/h
    expect(result.amounts.wood).toBe(300 + 80);
    expect(result.amounts.food).toBe(200 + 12);
    expect(result.population).toBe(30);
  });

  it('grows population one arrival at a time and adjusts rates', () => {
    const result = advanceCity(state(), startingBuildings(), ARRIVAL_MS * 3);
    expect(result.population).toBe(15);
    // New citizens are free: taxes rose from 16/h (4 free) toward 28/h (7 free).
    expect(result.ratesPerHour.coins).toBe(28);
    expect(result.nextArrivalAtMs).toBe(ARRIVAL_MS * 4);
  });

  it('stops arrivals when housing is full and reports null nextArrival', () => {
    const result = advanceCity(state(), startingBuildings(), HOUR * 24);
    expect(result.population).toBe(30); // housing cap
    expect(result.nextArrivalAtMs).toBeNull();
  });

  it('re-seeds arrivals when housing expanded after the state was written', () => {
    const buildings = [...startingBuildings(), { buildingId: 'house', level: 1, workers: 0 } as CityBuildingState];
    const result = advanceCity(state({ population: 30, nextArrivalAtMs: null }), buildings, ARRIVAL_MS + 1);
    expect(result.population).toBe(31);
  });

  it('famine: food clamps at zero, growth pauses, nobody dies', () => {
    // No farm workers: food rate = −(pop × 2) = −24/h. Food 2 lasts 5 min,
    // so the pantry is empty before the first would-be arrival at minute 15.
    const buildings: CityBuildingState[] = [
      { buildingId: 'townHall', level: 1, workers: 0 },
      { buildingId: 'sawmill', level: 1, workers: 4 },
      { buildingId: 'farm', level: 1, workers: 0 }
    ];
    const result = advanceCity(
      state({ amounts: { ...emptyResourceAmounts(), food: 2 } }),
      buildings,
      HOUR * 10
    );
    expect(result.amounts.food).toBe(0);
    expect(result.population).toBe(12); // no growth, no deaths
    // Arrivals keep being postponed, never abandoned: next attempt is scheduled.
    expect(result.nextArrivalAtMs).not.toBeNull();
    expect(result.nextArrivalAtMs!).toBeGreaterThan(HOUR * 10);
    // Wood production continued during the famine.
    expect(result.amounts.wood).toBe(800);
  });

  it('growth resumes after food returns', () => {
    // Famine for ~25 min, then... still famine (no farmers). Instead: food
    // arrives with a farm worker allocation change, modeled here as a fresh
    // call with food restocked.
    const buildings = startingBuildings();
    const starving = advanceCity(
      state({ amounts: { ...emptyResourceAmounts(), food: 0 }, population: 12 }),
      [
        { buildingId: 'townHall', level: 1, workers: 0 },
        { buildingId: 'sawmill', level: 1, workers: 4 },
        { buildingId: 'farm', level: 1, workers: 0 }
      ],
      ARRIVAL_MS * 2
    );
    expect(starving.population).toBe(12);

    const fed = advanceCity(
      {
        amounts: { ...starving.amounts, food: 100 },
        population: starving.population,
        nextArrivalAtMs: starving.nextArrivalAtMs,
        refTimeMs: ARRIVAL_MS * 2
      },
      buildings,
      ARRIVAL_MS * 4
    );
    expect(fed.population).toBeGreaterThan(12);
  });

  it('respects storage capacity but never taxes coins', () => {
    const result = advanceCity(
      state({ nextArrivalAtMs: null, population: 30 }),
      startingBuildings(),
      HOUR * 24 * 30
    );
    // wood capped at base storage 1200; coins uncapped: 30 pop − 8 workers = 22 free × 4/h × 720h
    expect(result.amounts.wood).toBe(1200);
    expect(result.amounts.coins).toBe(120 + 22 * 4 * 720);
  });

  it('is deterministic: advancing in two steps equals one step', () => {
    const buildings = startingBuildings();
    const oneShot = advanceCity(state(), buildings, HOUR * 6);
    const mid = advanceCity(state(), buildings, HOUR * 2.5);
    const twoStep = advanceCity(
      {
        amounts: mid.amounts,
        population: mid.population,
        nextArrivalAtMs: mid.nextArrivalAtMs,
        refTimeMs: HOUR * 2.5
      },
      buildings,
      HOUR * 6
    );
    expect(twoStep.population).toBe(oneShot.population);
    // Amounts may differ by flooring at the intermediate settle, never more.
    for (const key of ['wood', 'stone', 'food', 'iron', 'coins'] as const) {
      expect(Math.abs(twoStep.amounts[key] - oneShot.amounts[key])).toBeLessThanOrEqual(1);
    }
  });

  it('does not advance backwards', () => {
    const result = advanceCity(state(), startingBuildings(), -HOUR);
    expect(result.amounts.wood).toBe(300);
    expect(result.population).toBe(12);
  });
});

describe('assignedWorkers', () => {
  it('sums workers across buildings', () => {
    expect(assignedWorkers(startingBuildings())).toBe(8);
  });
});
