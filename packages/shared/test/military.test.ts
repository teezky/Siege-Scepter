import { describe, expect, it } from 'vitest';
import {
  armyPopulation,
  armyPower,
  resolvePveBattle,
  unitRecruitmentCost
} from '../src/index.js';

describe('military domain', () => {
  it('scales recruitment costs by quantity', () => {
    expect(unitRecruitmentCost('spearman', 3)).toEqual({ wood: 45, food: 60, iron: 15 });
    expect(() => unitRecruitmentCost('archer', 0)).toThrow(RangeError);
  });

  it('calculates army power and population', () => {
    const army = { spearman: 3, archer: 2 };
    expect(armyPower(army)).toBe(62);
    expect(armyPopulation(army)).toBe(5);
  });

  it('wins deterministically and returns a bounded loss report', () => {
    const result = resolvePveBattle({ spearman: 6, archer: 0 }, 'banditCamp');
    expect(result.victory).toBe(true);
    expect(result.attackerPower).toBe(60);
    expect(result.unitsLost).toEqual({ spearman: 2, archer: 0 });
    expect(result.survivors).toEqual({ spearman: 4, archer: 0 });
    expect(result.reward).toEqual({ wood: 180, stone: 100, coins: 60 });
  });

  it('makes defeat recoverable and grants no reward', () => {
    const result = resolvePveBattle({ spearman: 3, archer: 0 }, 'banditCamp');
    expect(result.victory).toBe(false);
    expect(result.unitsLost).toEqual({ spearman: 2, archer: 0 });
    expect(result.survivors).toEqual({ spearman: 1, archer: 0 });
    expect(result.reward).toEqual({});
  });
});
