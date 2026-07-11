import { describe, expect, it } from 'vitest';
import {
  canAfford,
  currentAmount,
  currentAmounts,
  subtractCost,
  type CityResourceSnapshot
} from '../src/index.js';

const HOUR_MS = 3_600_000;

describe('currentAmount', () => {
  it('adds elapsed production to the reference amount', () => {
    const amount = currentAmount({ amountAtRef: 100, ratePerHour: 60 }, 0, HOUR_MS, null);
    expect(amount).toBe(160);
  });

  it('floors fractional production', () => {
    // 30 minutes at 25/h = 12.5 → 12
    const amount = currentAmount({ amountAtRef: 0, ratePerHour: 25 }, 0, HOUR_MS / 2, null);
    expect(amount).toBe(12);
  });

  it('caps at storage capacity', () => {
    const amount = currentAmount({ amountAtRef: 90, ratePerHour: 1000 }, 0, HOUR_MS, 100);
    expect(amount).toBe(100);
  });

  it('does not destroy existing overflow when capacity is below stored amount', () => {
    const amount = currentAmount({ amountAtRef: 150, ratePerHour: 10 }, 0, HOUR_MS, 100);
    expect(amount).toBe(150);
  });

  it('ignores clock skew (now before ref)', () => {
    const amount = currentAmount({ amountAtRef: 50, ratePerHour: 60 }, HOUR_MS, 0, null);
    expect(amount).toBe(50);
  });
});

describe('currentAmounts', () => {
  const snapshot: CityResourceSnapshot = {
    amounts: { wood: 100, stone: 50, food: 10, iron: 0, coins: 5 },
    ratesPerHour: { wood: 60, stone: 0, food: 120, iron: 0, coins: 40 },
    refTimeMs: 0,
    storageCapacity: 130
  };

  it('computes every resource and caps only storage-capped ones', () => {
    const amounts = currentAmounts(snapshot, HOUR_MS);
    expect(amounts.wood).toBe(130); // 160 capped at 130
    expect(amounts.stone).toBe(50);
    expect(amounts.food).toBe(130);
    expect(amounts.iron).toBe(0);
    expect(amounts.coins).toBe(45); // coins are not storage-capped
  });
});

describe('canAfford / subtractCost', () => {
  const amounts = { wood: 100, stone: 50, food: 0, iron: 0, coins: 10 };

  it('affirms affordable costs and rejects unaffordable ones', () => {
    expect(canAfford(amounts, { wood: 100, stone: 50 })).toBe(true);
    expect(canAfford(amounts, { wood: 101 })).toBe(false);
  });

  it('subtracts costs immutably', () => {
    const result = subtractCost(amounts, { wood: 40, coins: 10 });
    expect(result).toEqual({ wood: 60, stone: 50, food: 0, iron: 0, coins: 0 });
    expect(amounts.wood).toBe(100);
  });

  it('throws on insufficient resources', () => {
    expect(() => subtractCost(amounts, { food: 1 })).toThrow(RangeError);
  });
});
