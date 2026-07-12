import { describe, expect, it } from 'vitest';
import {
  BUILDINGS,
  buildingLevelCost,
  buildingLevelSeconds,
  buildingProductionPerHour,
  buildingStorageCapacity,
  buildingWorkerSlots,
  checkBuildingPrerequisites,
  cityStorageCapacity,
  BASE_STORAGE_CAPACITY
} from '../src/index.js';

describe('buildingLevelCost', () => {
  it('returns base cost at level 1', () => {
    expect(buildingLevelCost(BUILDINGS.sawmill, 1)).toEqual({ wood: 60, stone: 30 });
  });

  it('scales exponentially and rounds to integers', () => {
    const cost = buildingLevelCost(BUILDINGS.sawmill, 3);
    // 60 * 1.45^2 = 126.15 → 126 ; 30 * 1.45^2 = 63.075 → 63
    expect(cost).toEqual({ wood: 126, stone: 63 });
    for (const value of Object.values(cost)) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('rejects levels outside 1..maxLevel', () => {
    expect(() => buildingLevelCost(BUILDINGS.sawmill, 0)).toThrow(RangeError);
    expect(() => buildingLevelCost(BUILDINGS.sawmill, 21)).toThrow(RangeError);
    expect(() => buildingLevelCost(BUILDINGS.sawmill, 1.5)).toThrow(RangeError);
  });
});

describe('buildingLevelSeconds', () => {
  it('returns base seconds at level 1 and grows with level', () => {
    expect(buildingLevelSeconds(BUILDINGS.sawmill, 1)).toBe(25);
    expect(buildingLevelSeconds(BUILDINGS.sawmill, 2)).toBeGreaterThan(25);
  });
});

describe('production and storage', () => {
  it('non-producing buildings produce 0 and offer no worker slots', () => {
    expect(buildingProductionPerHour(BUILDINGS.warehouse, 5)).toBe(0);
    expect(buildingWorkerSlots(BUILDINGS.warehouse, 5)).toBe(0);
  });

  it('production scales with assigned workers', () => {
    expect(buildingProductionPerHour(BUILDINGS.sawmill, 0)).toBe(0);
    expect(buildingProductionPerHour(BUILDINGS.sawmill, 4)).toBe(80);
    expect(buildingStorageCapacity(BUILDINGS.warehouse, 0)).toBe(0);
  });

  it('worker slots scale linearly with level', () => {
    expect(buildingWorkerSlots(BUILDINGS.sawmill, 1)).toBe(6);
    expect(buildingWorkerSlots(BUILDINGS.sawmill, 3)).toBe(18);
    expect(buildingWorkerSlots(BUILDINGS.sawmill, 0)).toBe(0);
  });

  it('city storage includes base capacity plus warehouses', () => {
    expect(cityStorageCapacity([])).toBe(BASE_STORAGE_CAPACITY);
    expect(cityStorageCapacity([{ buildingId: 'warehouse', level: 1 }])).toBe(
      BASE_STORAGE_CAPACITY + 1500
    );
  });
});

describe('checkBuildingPrerequisites', () => {
  it('blocks building above max level', () => {
    const failure = checkBuildingPrerequisites('sawmill', 21, new Map([['sawmill', 20]]));
    expect(failure).toEqual({ kind: 'maxLevelReached', buildingId: 'sawmill' });
  });

  it('blocks iron mine without town hall 3', () => {
    const failure = checkBuildingPrerequisites('ironMine', 1, new Map([['townHall', 2]]));
    expect(failure).toEqual({ kind: 'missingPrerequisite', buildingId: 'townHall', requiredLevel: 3 });
  });

  it('allows iron mine with town hall 3', () => {
    expect(checkBuildingPrerequisites('ironMine', 1, new Map([['townHall', 3]]))).toBeNull();
  });
});
