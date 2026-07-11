import {
  BUILDINGS,
  MAX_CONSTRUCTION_QUEUE_LENGTH,
  RESOURCE_IDS,
  STARTING_BUILDINGS,
  STARTING_RESOURCES,
  STORAGE_CAPPED_RESOURCES,
  buildingLevelCost,
  buildingLevelSeconds,
  canAfford,
  checkBuildingPrerequisites,
  cityProductionPerHour,
  cityStorageCapacity,
  currentAmount,
  emptyResourceAmounts,
  subtractCost,
  type BuildingId,
  type ResourceAmounts,
  type ResourceId
} from '@siege/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { cities, cityBuildings, cityResources, constructionOrders } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';

/** Drizzle transaction handle (structurally identical to Database for queries). */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type DbOrTx = Database | Tx;

function isBuildingId(value: string): value is BuildingId {
  return value in BUILDINGS;
}

function isResourceId(value: string): value is ResourceId {
  return (RESOURCE_IDS as readonly string[]).includes(value);
}

/** Creates the player's first city with starting buildings and resources. */
export async function foundFirstCity(tx: Tx, playerId: string, name: string, now: Date): Promise<string> {
  const [city] = await tx.insert(cities).values({ playerId, name }).returning({ id: cities.id });
  if (!city) throw new AppError('INTERNAL', 'Failed to create city');

  await tx.insert(cityBuildings).values(
    STARTING_BUILDINGS.map(({ buildingId, level }) => ({ cityId: city.id, buildingId, level }))
  );

  const rates = cityProductionPerHour([...STARTING_BUILDINGS]);
  await tx.insert(cityResources).values(
    RESOURCE_IDS.map((resource) => ({
      cityId: city.id,
      resource,
      amountAtRef: STARTING_RESOURCES[resource],
      ratePerHour: rates[resource],
      refTime: now
    }))
  );

  return city.id;
}

interface LoadedCity {
  id: string;
  name: string;
  playerId: string;
}

/** Loads and row-locks the city, verifying ownership. */
async function lockCity(tx: Tx, cityId: string, playerId: string): Promise<LoadedCity> {
  const [city] = await tx
    .select({ id: cities.id, name: cities.name, playerId: cities.playerId })
    .from(cities)
    .where(eq(cities.id, cityId))
    .for('update');
  if (!city) throw new AppError('NOT_FOUND', 'City not found');
  if (city.playerId !== playerId) throw new AppError('PERMISSION_DENIED', 'You do not own this city');
  return city;
}

async function loadBuildingLevels(tx: DbOrTx, cityId: string): Promise<Map<BuildingId, number>> {
  const rows = await tx
    .select({ buildingId: cityBuildings.buildingId, level: cityBuildings.level })
    .from(cityBuildings)
    .where(eq(cityBuildings.cityId, cityId));
  const levels = new Map<BuildingId, number>();
  for (const row of rows) {
    if (isBuildingId(row.buildingId)) levels.set(row.buildingId, row.level);
  }
  return levels;
}

interface ResourceRow {
  resource: ResourceId;
  amountAtRef: number;
  ratePerHour: number;
  refTime: Date;
}

async function loadResourceRows(tx: DbOrTx, cityId: string): Promise<ResourceRow[]> {
  const rows = await tx
    .select({
      resource: cityResources.resource,
      amountAtRef: cityResources.amountAtRef,
      ratePerHour: cityResources.ratePerHour,
      refTime: cityResources.refTime
    })
    .from(cityResources)
    .where(eq(cityResources.cityId, cityId));
  return rows.filter((row): row is ResourceRow => isResourceId(row.resource));
}

function computeAmountsAt(rows: ResourceRow[], atMs: number, capacity: number): ResourceAmounts {
  const amounts = emptyResourceAmounts();
  for (const row of rows) {
    const capped = STORAGE_CAPPED_RESOURCES.includes(row.resource);
    amounts[row.resource] = currentAmount(
      { amountAtRef: row.amountAtRef, ratePerHour: row.ratePerHour },
      row.refTime.getTime(),
      atMs,
      capped ? capacity : null
    );
  }
  return amounts;
}

/**
 * Settles every resource row at time `at`: persists the computed amounts,
 * applies `newRates`, and moves the reference timestamp forward.
 */
async function settleResources(
  tx: Tx,
  cityId: string,
  at: Date,
  newRates: ResourceAmounts,
  capacityAtSettle: number,
  adjust?: Partial<Record<ResourceId, number>>
): Promise<ResourceAmounts> {
  const rows = await loadResourceRows(tx, cityId);
  const settled = computeAmountsAt(rows, at.getTime(), capacityAtSettle);
  const adjusted = adjust ? subtractCost(settled, adjust) : settled;
  for (const resource of RESOURCE_IDS) {
    await tx
      .update(cityResources)
      .set({ amountAtRef: adjusted[resource], ratePerHour: newRates[resource], refTime: at })
      .where(and(eq(cityResources.cityId, cityId), eq(cityResources.resource, resource)));
  }
  return adjusted;
}

/**
 * Finalizes every due construction chronologically and promotes queued
 * orders. Idempotent: completing is a status transition guarded by the
 * city row lock, and running it twice finds nothing left to complete.
 * Correctness does not depend on any background job (project instructions
 * sections 9–10, 24).
 */
export async function finalizeDueConstructions(tx: Tx, cityId: string, now: Date): Promise<boolean> {
  let changed = false;
  // Bounded loop: each iteration completes one order; the queue is small.
  for (;;) {
    const [due] = await tx
      .select()
      .from(constructionOrders)
      .where(and(eq(constructionOrders.cityId, cityId), eq(constructionOrders.status, 'IN_PROGRESS')))
      .orderBy(asc(constructionOrders.completesAt))
      .limit(1);

    if (!due || !due.completesAt || due.completesAt.getTime() > now.getTime()) break;

    const completedAt = due.completesAt;
    const levelsBefore = await loadBuildingLevels(tx, cityId);
    const capacityBefore = cityStorageCapacity(
      [...levelsBefore.entries()].map(([buildingId, level]) => ({ buildingId, level }))
    );

    // Apply the building level.
    if (isBuildingId(due.buildingId)) {
      if (levelsBefore.has(due.buildingId)) {
        await tx
          .update(cityBuildings)
          .set({ level: due.targetLevel })
          .where(and(eq(cityBuildings.cityId, cityId), eq(cityBuildings.buildingId, due.buildingId)));
      } else {
        await tx.insert(cityBuildings).values({ cityId, buildingId: due.buildingId, level: due.targetLevel });
      }
    }
    await tx
      .update(constructionOrders)
      .set({ status: 'COMPLETED' })
      .where(eq(constructionOrders.id, due.id));

    // Settle production at the completion moment with the OLD capacity,
    // then switch to the new rates going forward.
    const levelsAfter = await loadBuildingLevels(tx, cityId);
    const buildingsAfter = [...levelsAfter.entries()].map(([buildingId, level]) => ({ buildingId, level }));
    const newRates = cityProductionPerHour(buildingsAfter);
    await settleResources(tx, cityId, completedAt, newRates, capacityBefore);

    // Promote the next queued order; it starts when the previous one finished.
    const [next] = await tx
      .select()
      .from(constructionOrders)
      .where(and(eq(constructionOrders.cityId, cityId), eq(constructionOrders.status, 'QUEUED')))
      .orderBy(asc(constructionOrders.queuePosition))
      .limit(1);
    if (next && isBuildingId(next.buildingId)) {
      const seconds = buildingLevelSeconds(BUILDINGS[next.buildingId], next.targetLevel);
      await tx
        .update(constructionOrders)
        .set({
          status: 'IN_PROGRESS',
          startedAt: completedAt,
          completesAt: new Date(completedAt.getTime() + seconds * 1000)
        })
        .where(eq(constructionOrders.id, next.id));
    }
    changed = true;
  }
  return changed;
}

export interface CityState {
  id: string;
  name: string;
  buildings: { buildingId: BuildingId; level: number }[];
  resourceRows: ResourceRow[];
  orders: {
    id: string;
    buildingId: BuildingId;
    targetLevel: number;
    status: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
    queuePosition: number;
    startedAt: Date | null;
    completesAt: Date | null;
  }[];
}

async function loadCityState(tx: DbOrTx, city: LoadedCity): Promise<CityState> {
  const levels = await loadBuildingLevels(tx, city.id);
  const resourceRows = await loadResourceRows(tx, city.id);
  const orderRows = await tx
    .select()
    .from(constructionOrders)
    .where(
      and(
        eq(constructionOrders.cityId, city.id),
        inArray(constructionOrders.status, ['QUEUED', 'IN_PROGRESS'])
      )
    )
    .orderBy(asc(constructionOrders.queuePosition));

  return {
    id: city.id,
    name: city.name,
    buildings: [...levels.entries()].map(([buildingId, level]) => ({ buildingId, level })),
    resourceRows,
    orders: orderRows
      .filter((row) => isBuildingId(row.buildingId))
      .map((row) => ({
        id: row.id,
        buildingId: row.buildingId as BuildingId,
        targetLevel: row.targetLevel,
        status: row.status,
        queuePosition: row.queuePosition,
        startedAt: row.startedAt,
        completesAt: row.completesAt
      }))
  };
}

/** Returns the player's (single, in slice 1) city after finalizing due work. */
export async function getPlayerCityState(db: Database, playerId: string, clock: Clock): Promise<CityState> {
  return db.transaction(async (tx) => {
    const [cityRow] = await tx
      .select({ id: cities.id })
      .from(cities)
      .where(eq(cities.playerId, playerId))
      .limit(1);
    if (!cityRow) throw new AppError('NOT_FOUND', 'Player has no city');
    const city = await lockCity(tx, cityRow.id, playerId);
    await finalizeDueConstructions(tx, city.id, clock.now());
    return loadCityState(tx, city);
  });
}

/**
 * Starts (or queues) a construction order for the next level of a building.
 * Server-authoritative: validates ownership, prerequisites, queue capacity
 * and cost inside one transaction guarded by the city row lock.
 */
export async function startConstruction(
  db: Database,
  playerId: string,
  cityId: string,
  buildingId: BuildingId,
  clock: Clock
): Promise<{ state: CityState; orderId: string }> {
  const def = BUILDINGS[buildingId];

  return db.transaction(async (tx) => {
    const now = clock.now();
    const city = await lockCity(tx, cityId, playerId);
    await finalizeDueConstructions(tx, city.id, now);

    const levels = await loadBuildingLevels(tx, city.id);
    const activeOrders = await tx
      .select()
      .from(constructionOrders)
      .where(
        and(
          eq(constructionOrders.cityId, city.id),
          inArray(constructionOrders.status, ['QUEUED', 'IN_PROGRESS'])
        )
      )
      .orderBy(asc(constructionOrders.queuePosition));

    if (activeOrders.length >= 1 + MAX_CONSTRUCTION_QUEUE_LENGTH) {
      throw new AppError('QUEUE_FULL', 'Construction queue is full', {
        limit: 1 + MAX_CONSTRUCTION_QUEUE_LENGTH
      });
    }

    // Effective levels = built levels plus levels already promised in the queue.
    const effectiveLevels = new Map(levels);
    for (const order of activeOrders) {
      if (isBuildingId(order.buildingId)) {
        effectiveLevels.set(
          order.buildingId,
          Math.max(effectiveLevels.get(order.buildingId) ?? 0, order.targetLevel)
        );
      }
    }

    const targetLevel = (effectiveLevels.get(buildingId) ?? 0) + 1;
    const prereqFailure = checkBuildingPrerequisites(buildingId, targetLevel, effectiveLevels);
    if (prereqFailure) {
      if (prereqFailure.kind === 'maxLevelReached') {
        throw new AppError('UNMET_PREREQUISITE', `${buildingId} is already at maximum level`, {
          buildingId
        });
      }
      throw new AppError(
        'UNMET_PREREQUISITE',
        `Requires ${prereqFailure.buildingId} level ${prereqFailure.requiredLevel}`,
        { buildingId: prereqFailure.buildingId, requiredLevel: prereqFailure.requiredLevel }
      );
    }

    const cost = buildingLevelCost(def, targetLevel);
    const buildingsNow = [...levels.entries()].map(([id, level]) => ({ buildingId: id, level }));
    const capacity = cityStorageCapacity(buildingsNow);
    const rates = cityProductionPerHour(buildingsNow);
    const resourceRows = await loadResourceRows(tx, city.id);
    const amountsNow = computeAmountsAt(resourceRows, now.getTime(), capacity);

    if (!canAfford(amountsNow, cost)) {
      throw new AppError('INSUFFICIENT_RESOURCES', 'Not enough resources', { cost, amounts: amountsNow });
    }

    // Pay: settle at `now`, subtract the cost, keep current rates.
    await settleResources(tx, city.id, now, rates, capacity, cost);

    const hasInProgress = activeOrders.some((o) => o.status === 'IN_PROGRESS');
    const maxPosition = activeOrders.reduce((max, o) => Math.max(max, o.queuePosition), 0);
    const seconds = buildingLevelSeconds(def, targetLevel);

    const [order] = await tx
      .insert(constructionOrders)
      .values({
        cityId: city.id,
        buildingId,
        targetLevel,
        status: hasInProgress ? 'QUEUED' : 'IN_PROGRESS',
        queuePosition: maxPosition + 1,
        startedAt: hasInProgress ? null : now,
        completesAt: hasInProgress ? null : new Date(now.getTime() + seconds * 1000)
      })
      .returning({ id: constructionOrders.id });
    if (!order) throw new AppError('INTERNAL', 'Failed to create construction order');

    const state = await loadCityState(tx, city);
    return { state, orderId: order.id };
  });
}
