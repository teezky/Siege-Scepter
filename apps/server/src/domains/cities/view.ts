import {
  BUILDINGS,
  advanceCity,
  assignedWorkers,
  buildingWorkerSlots,
  cityHousingCapacity,
  cityStorageCapacity,
  emptyResourceAmounts,
  techEffects,
  type CityView
} from '@siege/shared';
import type { CityState } from './service.js';

/** Maps internal city state to the public API contract. */
export function toCityView(state: CityState, now: Date): CityView {
  const effects = techEffects(state.researchedTechs);
  // Advance in memory (never persisted here — GET stays cheap); the same
  // shared function runs client-side, so both always agree.
  const sim = advanceCity(
    {
      amounts: state.resourceRows.reduce((acc, row) => {
        acc[row.resource] = row.amountAtRef;
        return acc;
      }, emptyResourceAmounts()),
      population: state.population,
      nextArrivalAtMs: state.nextArrivalAt ? state.nextArrivalAt.getTime() : null,
      refTimeMs: state.resourceRows.reduce((max, row) => Math.max(max, row.refTime.getTime()), 0),
    },
    state.buildings,
    now.getTime(),
    effects
  );

  return {
    id: state.id,
    name: state.name,
    buildings: state.buildings.map(({ buildingId, level, workers }) => ({
      buildingId,
      level,
      workers,
      workerSlots: buildingWorkerSlots(BUILDINGS[buildingId], level, effects)
    })),
    resources: {
      amounts: sim.amounts,
      ratesPerHour: sim.ratesPerHour,
      storageCapacity: cityStorageCapacity(state.buildings)
    },
    population: {
      total: sim.population,
      housingCapacity: cityHousingCapacity(state.buildings, effects),
      freeCitizens: Math.max(0, sim.population - assignedWorkers(state.buildings)),
      nextArrivalAt: sim.nextArrivalAtMs === null ? null : new Date(sim.nextArrivalAtMs).toISOString()
    },
    researchedTechs: state.researchedTechs,
    constructionQueue: state.orders
      .filter((o) => o.status === 'QUEUED' || o.status === 'IN_PROGRESS')
      .map((o) => ({
        id: o.id,
        buildingId: o.buildingId,
        targetLevel: o.targetLevel,
        status: o.status,
        queuePosition: o.queuePosition,
        startedAt: o.startedAt ? o.startedAt.toISOString() : null,
        completesAt: o.completesAt ? o.completesAt.toISOString() : null
      })),
    serverTime: now.toISOString()
  };
}
