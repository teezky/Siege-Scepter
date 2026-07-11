import {
  STORAGE_CAPPED_RESOURCES,
  cityProductionPerHour,
  cityStorageCapacity,
  currentAmount,
  emptyResourceAmounts,
  type CityView
} from '@siege/shared';
import type { CityState } from './service.js';

/** Maps internal city state to the public API contract. */
export function toCityView(state: CityState, now: Date): CityView {
  const capacity = cityStorageCapacity(state.buildings);
  const rates = cityProductionPerHour(state.buildings);
  const amounts = emptyResourceAmounts();
  for (const row of state.resourceRows) {
    const capped = STORAGE_CAPPED_RESOURCES.includes(row.resource);
    amounts[row.resource] = currentAmount(
      { amountAtRef: row.amountAtRef, ratePerHour: row.ratePerHour },
      row.refTime.getTime(),
      now.getTime(),
      capped ? capacity : null
    );
  }

  return {
    id: state.id,
    name: state.name,
    buildings: state.buildings.map(({ buildingId, level }) => ({ buildingId, level })),
    resources: {
      amounts,
      ratesPerHour: rates,
      storageCapacity: capacity
    },
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
