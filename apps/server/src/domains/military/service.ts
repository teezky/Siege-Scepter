import {
  PVE_ENCOUNTERS,
  PVE_ENCOUNTER_IDS,
  STORAGE_CAPPED_RESOURCES,
  UNIT_IDS,
  UNITS,
  armyPopulation,
  assignedWorkers,
  cityHousingCapacity,
  cityStorageCapacity,
  resolvePveBattle,
  techEffects,
  unitRecruitmentCost,
  type PveEncounterId,
  type ResourceAmounts,
  type UnitCounts,
  type UnitId
} from '@siege/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  cities,
  cityResources,
  playerPveCompletions,
  pveBattleReports
} from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import {
  finalizeDueConstructions,
  loadBuildings,
  loadCityState,
  loadResearch,
  lockCity,
  settleCity,
  type CityState,
  type DbOrTx,
  type Tx
} from '../cities/service.js';
import { loadArmy, setUnitCount } from './repository.js';

function isEncounterId(value: string): value is PveEncounterId {
  return (PVE_ENCOUNTER_IDS as readonly string[]).includes(value);
}

export interface BattleReportState {
  id: string;
  encounterId: PveEncounterId;
  victory: boolean;
  attackerPower: number;
  defenderPower: number;
  unitsSent: UnitCounts;
  unitsLost: UnitCounts;
  reward: Partial<ResourceAmounts>;
  foughtAt: Date;
}

export interface MilitaryState {
  army: UnitCounts;
  completedEncounters: PveEncounterId[];
  reports: BattleReportState[];
}

export async function loadMilitaryState(
  tx: DbOrTx,
  playerId: string,
  cityId: string
): Promise<MilitaryState> {
  const [army, completionRows, reportRows] = await Promise.all([
    loadArmy(tx, cityId),
    tx
      .select({ encounterId: playerPveCompletions.encounterId })
      .from(playerPveCompletions)
      .where(eq(playerPveCompletions.playerId, playerId)),
    tx
      .select()
      .from(pveBattleReports)
      .where(eq(pveBattleReports.playerId, playerId))
      .orderBy(desc(pveBattleReports.foughtAt))
      .limit(5)
  ]);

  return {
    army,
    completedEncounters: completionRows.map((row) => row.encounterId).filter(isEncounterId),
    reports: reportRows
      .filter((row): row is typeof row & { encounterId: PveEncounterId } =>
        isEncounterId(row.encounterId)
      )
      .map((row) => ({
        id: row.id,
        encounterId: row.encounterId,
        victory: row.victory,
        attackerPower: row.attackerPower,
        defenderPower: row.defenderPower,
        unitsSent: row.unitsSent,
        unitsLost: row.unitsLost,
        reward: row.reward,
        foughtAt: row.foughtAt
      }))
  };
}

async function playerCityId(tx: DbOrTx, playerId: string): Promise<string> {
  const [row] = await tx
    .select({ id: cities.id })
    .from(cities)
    .where(eq(cities.playerId, playerId))
    .limit(1);
  if (!row) throw new AppError('NOT_FOUND', 'Player has no city');
  return row.id;
}

export async function getMilitaryState(db: Database, playerId: string): Promise<MilitaryState> {
  return db.transaction(async (tx) => {
    const cityId = await playerCityId(tx, playerId);
    return loadMilitaryState(tx, playerId, cityId);
  });
}

export async function recruitUnits(
  db: Database,
  playerId: string,
  cityId: string,
  unitId: UnitId,
  quantity: number,
  clock: Clock
): Promise<{ city: CityState; military: MilitaryState }> {
  return db.transaction(async (tx) => {
    const now = clock.now();
    const city = await lockCity(tx, cityId, playerId);
    const researched = await loadResearch(tx, playerId);
    const effects = techEffects(researched);
    await finalizeDueConstructions(tx, city, now, effects);

    const buildings = await loadBuildings(tx, city.id);
    const barracksLevel = buildings.find((building) => building.buildingId === 'barracks')?.level ?? 0;
    const unit = UNITS[unitId];
    if (barracksLevel < unit.requiredBarracksLevel) {
      throw new AppError(
        'UNMET_PREREQUISITE',
        `Requires barracks level ${unit.requiredBarracksLevel}`,
        { unitId, requiredBarracksLevel: unit.requiredBarracksLevel }
      );
    }

    // Settle and pay first; any later validation error rolls the transaction back.
    await settleCity(tx, city, buildings, now, effects, unitRecruitmentCost(unitId, quantity));
    const freeCitizens = city.population - assignedWorkers(buildings) - city.soldiers;
    const populationNeeded = unit.populationCost * quantity;
    if (populationNeeded > freeCitizens) {
      throw new AppError('INSUFFICIENT_RESOURCES', 'Not enough free citizens to recruit units', {
        freeCitizens,
        populationNeeded
      });
    }

    const army = await loadArmy(tx, city.id);
    await setUnitCount(tx, city.id, unitId, army[unitId] + quantity);
    city.soldiers += populationNeeded;

    return {
      city: await loadCityState(tx, city, researched),
      military: await loadMilitaryState(tx, playerId, city.id)
    };
  });
}

function rewardAmount(current: number, reward: number, capacity: number, capped: boolean): number {
  if (!capped) return current + reward;
  // Rewards cannot grow a capped resource past storage, but existing overflow
  // is never destroyed if a previous system granted it.
  return Math.min(current + reward, Math.max(current, capacity));
}

async function applyReward(
  tx: Tx,
  cityId: string,
  amounts: ResourceAmounts,
  reward: Partial<ResourceAmounts>,
  capacity: number
): Promise<void> {
  for (const [resource, value] of Object.entries(reward) as [keyof ResourceAmounts, number][]) {
    const next = rewardAmount(
      amounts[resource],
      value,
      capacity,
      STORAGE_CAPPED_RESOURCES.includes(resource)
    );
    await tx
      .update(cityResources)
      .set({ amountAtRef: next })
      .where(and(eq(cityResources.cityId, cityId), eq(cityResources.resource, resource)));
  }
}

export async function attackPveEncounter(
  db: Database,
  playerId: string,
  encounterId: PveEncounterId,
  clock: Clock
): Promise<{ city: CityState; military: MilitaryState; report: BattleReportState }> {
  return db.transaction(async (tx) => {
    const now = clock.now();
    const cityId = await playerCityId(tx, playerId);
    const city = await lockCity(tx, cityId, playerId);
    const researched = await loadResearch(tx, playerId);
    const effects = techEffects(researched);
    await finalizeDueConstructions(tx, city, now, effects);

    const before = await loadMilitaryState(tx, playerId, city.id);
    const encounter = PVE_ENCOUNTERS[encounterId];
    if (before.completedEncounters.includes(encounterId)) {
      throw new AppError('INVALID_STATE', `${encounterId} is already cleared`, { encounterId });
    }
    if (encounter.prerequisite && !before.completedEncounters.includes(encounter.prerequisite)) {
      throw new AppError('UNMET_PREREQUISITE', `Requires ${encounter.prerequisite} first`, {
        encounterId,
        prerequisite: encounter.prerequisite
      });
    }
    if (armyPopulation(before.army) === 0) {
      throw new AppError('INVALID_STATE', 'Recruit an army before attacking');
    }

    const buildings = await loadBuildings(tx, city.id);
    const amounts = await settleCity(tx, city, buildings, now, effects);
    const result = resolvePveBattle(before.army, encounterId);

    for (const unitId of UNIT_IDS) {
      await setUnitCount(tx, city.id, unitId, result.survivors[unitId]);
    }
    const populationLost = armyPopulation(result.unitsLost);
    city.population -= populationLost;
    city.soldiers = armyPopulation(result.survivors);
    if (city.nextArrivalAt === null && city.population < cityHousingCapacity(buildings, effects)) {
      city.nextArrivalAt = new Date(now.getTime() + effects.arrivalIntervalMinutes * 60_000);
    }
    await tx
      .update(cities)
      .set({ population: city.population, nextArrivalAt: city.nextArrivalAt })
      .where(eq(cities.id, city.id));

    if (result.victory) {
      await applyReward(tx, city.id, amounts, result.reward, cityStorageCapacity(buildings));
      await tx.insert(playerPveCompletions).values({ playerId, encounterId, completedAt: now });
    }

    const [inserted] = await tx
      .insert(pveBattleReports)
      .values({
        playerId,
        cityId: city.id,
        encounterId,
        victory: result.victory,
        attackerPower: result.attackerPower,
        defenderPower: result.defenderPower,
        unitsSent: result.unitsSent,
        unitsLost: result.unitsLost,
        reward: result.reward,
        foughtAt: now
      })
      .returning({ id: pveBattleReports.id });
    if (!inserted) throw new AppError('INTERNAL', 'Failed to create battle report');

    const report: BattleReportState = {
      id: inserted.id,
      encounterId,
      victory: result.victory,
      attackerPower: result.attackerPower,
      defenderPower: result.defenderPower,
      unitsSent: result.unitsSent,
      unitsLost: result.unitsLost,
      reward: result.reward,
      foughtAt: now
    };

    return {
      city: await loadCityState(tx, city, researched),
      military: await loadMilitaryState(tx, playerId, city.id),
      report
    };
  });
}
