import {
  BUILDINGS,
  CITY_PLOTS,
  DEFAULT_PLOT_ASSIGNMENT,
  MAX_CONSTRUCTION_QUEUE_LENGTH,
  POPULATION,
  RESOURCE_IDS,
  STARTING_BUILDINGS,
  STARTING_PLOT_ASSIGNMENT,
  STARTING_RESOURCES,
  STARTING_WORKER_ALLOCATION,
  TECHS,
  TECH_IDS,
  advanceCity,
  armyPopulation,
  assignedWorkers,
  buildingLevelCost,
  buildingLevelSeconds,
  buildingWorkerSlots,
  canAfford,
  checkBuildingPrerequisites,
  checkResearch,
  cityHousingCapacity,
  emptyResourceAmounts,
  subtractCost,
  techEffects,
  type BuildingId,
  type CityBuildingState,
  type CitySimState,
  type ResourceAmounts,
  type ResourceId,
  type TechEffects,
  type TechId
} from '@siege/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  cities,
  cityBuildings,
  cityResources,
  constructionOrders,
  playerResearch
} from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { loadArmy } from '../military/repository.js';

/** Drizzle transaction handle (structurally identical to Database for queries). */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbOrTx = Database | Tx;

const ARRIVAL_INTERVAL_MS = POPULATION.arrivalIntervalMinutes * 60_000;

function isBuildingId(value: string): value is BuildingId {
  return value in BUILDINGS;
}

function isResourceId(value: string): value is ResourceId {
  return (RESOURCE_IDS as readonly string[]).includes(value);
}

function isTechId(value: string): value is TechId {
  return (TECH_IDS as readonly string[]).includes(value);
}

/** Researched techs of a player (player-global, unlike city state). */
export async function loadResearch(tx: DbOrTx, playerId: string): Promise<TechId[]> {
  const rows = await tx
    .select({ techId: playerResearch.techId })
    .from(playerResearch)
    .where(eq(playerResearch.playerId, playerId));
  return rows.map((r) => r.techId).filter(isTechId);
}

/** Creates the player's first city with starting buildings, workers and resources. */
export async function foundFirstCity(tx: Tx, playerId: string, name: string, now: Date): Promise<string> {
  const [city] = await tx
    .insert(cities)
    .values({
      playerId,
      name,
      population: POPULATION.startingPopulation,
      nextArrivalAt: new Date(now.getTime() + ARRIVAL_INTERVAL_MS)
    })
    .returning({ id: cities.id });
  if (!city) throw new AppError('INTERNAL', 'Failed to create city');

  await tx.insert(cityBuildings).values(
    STARTING_BUILDINGS.map(({ buildingId, level }) => ({
      cityId: city.id,
      buildingId,
      level,
      workers: STARTING_WORKER_ALLOCATION[buildingId] ?? 0,
      plotIndex: STARTING_PLOT_ASSIGNMENT[buildingId] ?? DEFAULT_PLOT_ASSIGNMENT[buildingId]
    }))
  );

  await tx.insert(cityResources).values(
    RESOURCE_IDS.map((resource) => ({
      cityId: city.id,
      resource,
      amountAtRef: STARTING_RESOURCES[resource],
      refTime: now
    }))
  );

  return city.id;
}

export interface LoadedCity {
  id: string;
  name: string;
  playerId: string;
  population: number;
  nextArrivalAt: Date | null;
  soldiers: number;
}

/** Loads and row-locks the city, verifying ownership. */
export async function lockCity(tx: Tx, cityId: string, playerId: string): Promise<LoadedCity> {
  const [city] = await tx
    .select({
      id: cities.id,
      name: cities.name,
      playerId: cities.playerId,
      population: cities.population,
      nextArrivalAt: cities.nextArrivalAt
    })
    .from(cities)
    .where(eq(cities.id, cityId))
    .for('update');
  if (!city) throw new AppError('NOT_FOUND', 'City not found');
  if (city.playerId !== playerId) throw new AppError('PERMISSION_DENIED', 'You do not own this city');
  const army = await loadArmy(tx, cityId);
  return { ...city, soldiers: armyPopulation(army) };
}

/** Building state plus its scene plot (the sim itself never needs the plot). */
export type CityBuildingRow = CityBuildingState & { plotIndex: number };

export async function loadBuildings(tx: DbOrTx, cityId: string): Promise<CityBuildingRow[]> {
  const rows = await tx
    .select({
      buildingId: cityBuildings.buildingId,
      level: cityBuildings.level,
      workers: cityBuildings.workers,
      plotIndex: cityBuildings.plotIndex
    })
    .from(cityBuildings)
    .where(eq(cityBuildings.cityId, cityId));
  return rows.filter((row): row is CityBuildingRow => isBuildingId(row.buildingId));
}

interface ResourceRow {
  resource: ResourceId;
  amountAtRef: number;
  refTime: Date;
}

async function loadResourceRows(tx: DbOrTx, cityId: string): Promise<ResourceRow[]> {
  const rows = await tx
    .select({
      resource: cityResources.resource,
      amountAtRef: cityResources.amountAtRef,
      refTime: cityResources.refTime
    })
    .from(cityResources)
    .where(eq(cityResources.cityId, cityId));
  return rows.filter((row): row is ResourceRow => isResourceId(row.resource));
}

/** Sim state at the rows' shared reference time (settles always write one refTime). */
function toSimState(city: LoadedCity, rows: ResourceRow[]): CitySimState {
  const amounts = emptyResourceAmounts();
  let refTimeMs = 0;
  for (const row of rows) {
    amounts[row.resource] = row.amountAtRef;
    refTimeMs = Math.max(refTimeMs, row.refTime.getTime());
  }
  return {
    amounts,
    population: city.population,
    reservedPopulation: city.soldiers,
    nextArrivalAtMs: city.nextArrivalAt ? city.nextArrivalAt.getTime() : null,
    refTimeMs
  };
}

/**
 * Settles the city at time `at`: advances population and resources with the
 * shared simulation, optionally subtracts a cost, and persists everything
 * with `at` as the new reference time. Returns the settled amounts.
 * Throws INSUFFICIENT_RESOURCES if `adjust` cannot be paid.
 */
export async function settleCity(
  tx: Tx,
  city: LoadedCity,
  buildings: CityBuildingState[],
  at: Date,
  effects: TechEffects,
  adjust?: Partial<Record<ResourceId, number>>
): Promise<ResourceAmounts> {
  const rows = await loadResourceRows(tx, city.id);
  const result = advanceCity(toSimState(city, rows), buildings, at.getTime(), effects);

  if (adjust && !canAfford(result.amounts, adjust)) {
    throw new AppError('INSUFFICIENT_RESOURCES', 'Not enough resources', {
      cost: adjust,
      amounts: result.amounts
    });
  }
  const amounts = adjust ? subtractCost(result.amounts, adjust) : result.amounts;

  for (const resource of RESOURCE_IDS) {
    await tx
      .update(cityResources)
      .set({ amountAtRef: amounts[resource], refTime: at })
      .where(and(eq(cityResources.cityId, city.id), eq(cityResources.resource, resource)));
  }
  await tx
    .update(cities)
    .set({
      population: result.population,
      nextArrivalAt: result.nextArrivalAtMs === null ? null : new Date(result.nextArrivalAtMs)
    })
    .where(eq(cities.id, city.id));

  // Keep the in-memory city consistent for subsequent settles in the same tx.
  city.population = result.population;
  city.nextArrivalAt = result.nextArrivalAtMs === null ? null : new Date(result.nextArrivalAtMs);

  return amounts;
}

/**
 * Finalizes every due construction chronologically and promotes queued
 * orders. Idempotent: completing is a status transition guarded by the
 * city row lock, and running it twice finds nothing left to complete.
 * Correctness does not depend on any background job (project instructions
 * sections 9–10, 24).
 */
export async function finalizeDueConstructions(
  tx: Tx,
  city: LoadedCity,
  now: Date,
  effects: TechEffects
): Promise<boolean> {
  let changed = false;
  // Bounded loop: each iteration completes one order; the queue is small.
  for (;;) {
    const [due] = await tx
      .select()
      .from(constructionOrders)
      .where(and(eq(constructionOrders.cityId, city.id), eq(constructionOrders.status, 'IN_PROGRESS')))
      .orderBy(asc(constructionOrders.completesAt))
      .limit(1);

    if (!due || !due.completesAt || due.completesAt.getTime() > now.getTime()) break;

    const completedAt = due.completesAt;

    // Settle with the OLD building levels up to the completion moment —
    // rates and capacity derive from buildings, so order matters.
    const buildingsBefore = await loadBuildings(tx, city.id);
    await settleCity(tx, city, buildingsBefore, completedAt, effects);

    // Apply the building level.
    if (isBuildingId(due.buildingId)) {
      const existing = buildingsBefore.find((b) => b.buildingId === due.buildingId);
      if (existing) {
        await tx
          .update(cityBuildings)
          .set({ level: due.targetLevel })
          .where(and(eq(cityBuildings.cityId, city.id), eq(cityBuildings.buildingId, due.buildingId)));
      } else {
        await tx.insert(cityBuildings).values({
          cityId: city.id,
          buildingId: due.buildingId,
          level: due.targetLevel,
          workers: 0,
          plotIndex: due.plotIndex ?? DEFAULT_PLOT_ASSIGNMENT[due.buildingId]
        });
      }
    }
    await tx
      .update(constructionOrders)
      .set({ status: 'COMPLETED' })
      .where(eq(constructionOrders.id, due.id));

    // A housing upgrade may re-open growth: schedule the next arrival.
    const buildingsAfter = await loadBuildings(tx, city.id);
    if (city.nextArrivalAt === null && city.population < cityHousingCapacity(buildingsAfter, effects)) {
      city.nextArrivalAt = new Date(completedAt.getTime() + effects.arrivalIntervalMinutes * 60_000);
      await tx.update(cities).set({ nextArrivalAt: city.nextArrivalAt }).where(eq(cities.id, city.id));
    }

    // Promote the next queued order; it starts when the previous one finished.
    const [next] = await tx
      .select()
      .from(constructionOrders)
      .where(and(eq(constructionOrders.cityId, city.id), eq(constructionOrders.status, 'QUEUED')))
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
  population: number;
  nextArrivalAt: Date | null;
  soldiers: number;
  researchedTechs: TechId[];
  buildings: CityBuildingRow[];
  resourceRows: ResourceRow[];
  orders: {
    id: string;
    buildingId: BuildingId;
    targetLevel: number;
    status: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
    queuePosition: number;
    plotIndex: number | null;
    startedAt: Date | null;
    completesAt: Date | null;
  }[];
}

export async function loadCityState(
  tx: DbOrTx,
  city: LoadedCity,
  researchedTechs: TechId[]
): Promise<CityState> {
  const buildings = await loadBuildings(tx, city.id);
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
    population: city.population,
    nextArrivalAt: city.nextArrivalAt,
    soldiers: city.soldiers,
    researchedTechs,
    buildings,
    resourceRows,
    orders: orderRows
      .filter((row) => isBuildingId(row.buildingId))
      .map((row) => ({
        id: row.id,
        buildingId: row.buildingId as BuildingId,
        targetLevel: row.targetLevel,
        status: row.status,
        queuePosition: row.queuePosition,
        plotIndex: row.plotIndex,
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
    const researched = await loadResearch(tx, playerId);
    await finalizeDueConstructions(tx, city, clock.now(), techEffects(researched));
    return loadCityState(tx, city, researched);
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
  clock: Clock,
  requestedPlotIndex?: number
): Promise<{ state: CityState; orderId: string }> {
  const def = BUILDINGS[buildingId];

  return db.transaction(async (tx) => {
    const now = clock.now();
    const city = await lockCity(tx, cityId, playerId);
    const researched = await loadResearch(tx, playerId);
    const effects = techEffects(researched);
    await finalizeDueConstructions(tx, city, now, effects);

    const buildings = await loadBuildings(tx, city.id);
    const levels = new Map(buildings.map((b) => [b.buildingId, b.level]));
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

    const queueLimit = 1 + MAX_CONSTRUCTION_QUEUE_LENGTH + effects.extraQueueSlots;
    if (activeOrders.length >= queueLimit) {
      throw new AppError('QUEUE_FULL', 'Construction queue is full', { limit: queueLimit });
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

    // A brand-new building needs a free plot to stand on (upgrades keep theirs).
    let plotIndex: number | null = null;
    if (targetLevel === 1) {
      plotIndex = requestedPlotIndex ?? DEFAULT_PLOT_ASSIGNMENT[buildingId];
      if (!Number.isInteger(plotIndex) || plotIndex < 0 || plotIndex >= CITY_PLOTS.length) {
        throw new AppError('VALIDATION_FAILED', 'Unknown plot', { plotIndex });
      }
      const occupiedBy =
        buildings.find((b) => b.plotIndex === plotIndex) ??
        activeOrders.find((o) => o.plotIndex === plotIndex);
      if (occupiedBy) {
        throw new AppError('INVALID_STATE', 'Plot is already occupied', {
          plotIndex,
          buildingId: occupiedBy.buildingId
        });
      }
    }

    // Pay: settle at `now` and subtract the cost (throws if unaffordable).
    const cost = buildingLevelCost(def, targetLevel);
    await settleCity(tx, city, buildings, now, effects, cost);

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
        plotIndex,
        startedAt: hasInProgress ? null : now,
        completesAt: hasInProgress ? null : new Date(now.getTime() + seconds * 1000)
      })
      .returning({ id: constructionOrders.id });
    if (!order) throw new AppError('INTERNAL', 'Failed to create construction order');

    const state = await loadCityState(tx, city, researched);
    return { state, orderId: order.id };
  });
}

/**
 * Replaces the worker allocation of the city's production buildings.
 * Buildings absent from `allocation` get zero workers. Validates slots
 * (building level) and the total against the settled population.
 */
export async function setWorkerAllocation(
  db: Database,
  playerId: string,
  cityId: string,
  allocation: Partial<Record<BuildingId, number>>,
  clock: Clock
): Promise<CityState> {
  return db.transaction(async (tx) => {
    const now = clock.now();
    const city = await lockCity(tx, cityId, playerId);
    const researched = await loadResearch(tx, playerId);
    const effects = techEffects(researched);
    await finalizeDueConstructions(tx, city, now, effects);

    const buildings = await loadBuildings(tx, city.id);

    // Every allocation key must be a production building the city has built.
    const byId = new Map(buildings.map((b) => [b.buildingId, b]));
    for (const [buildingId, workers] of Object.entries(allocation) as [BuildingId, number][]) {
      const def = BUILDINGS[buildingId];
      if (!def.production) {
        throw new AppError('VALIDATION_FAILED', `${buildingId} does not employ workers`, { buildingId });
      }
      const built = byId.get(buildingId);
      if (!built || built.level <= 0) {
        throw new AppError('INVALID_STATE', `${buildingId} is not built in this city`, { buildingId });
      }
      const slots = buildingWorkerSlots(def, built.level, effects);
      if (!Number.isInteger(workers) || workers < 0 || workers > slots) {
        throw new AppError('VALIDATION_FAILED', `${buildingId} accepts 0–${slots} workers`, {
          buildingId,
          slots
        });
      }
    }

    // Settle BEFORE the change: the old allocation earned its keep until now,
    // and the settled population is what the new total is validated against.
    await settleCity(tx, city, buildings, now, effects);

    const next = buildings.map((b) => ({
      ...b,
      workers: BUILDINGS[b.buildingId].production ? (allocation[b.buildingId] ?? 0) : 0
    }));
    const total = assignedWorkers(next);
    if (total + city.soldiers > city.population) {
      throw new AppError('INSUFFICIENT_RESOURCES', 'Not enough citizens for this allocation', {
        population: city.population,
        soldiers: city.soldiers,
        requestedWorkers: total
      });
    }

    for (const building of next) {
      await tx
        .update(cityBuildings)
        .set({ workers: building.workers })
        .where(and(eq(cityBuildings.cityId, city.id), eq(cityBuildings.buildingId, building.buildingId)));
    }

    return loadCityState(tx, city, researched);
  });
}

/**
 * Researches a technology for the player: settles their city at `now`,
 * validates the tech (not researched, prerequisite met, knowledge afforded),
 * spends the knowledge and records the tech. Techs are player-global;
 * knowledge lives in the player's single city for now (documented assumption:
 * it becomes a player-level pool when multiple cities arrive).
 */
export async function researchTech(
  db: Database,
  playerId: string,
  techId: TechId,
  clock: Clock
): Promise<CityState> {
  return db.transaction(async (tx) => {
    const now = clock.now();
    const [cityRow] = await tx
      .select({ id: cities.id })
      .from(cities)
      .where(eq(cities.playerId, playerId))
      .limit(1);
    if (!cityRow) throw new AppError('NOT_FOUND', 'Player has no city');
    const city = await lockCity(tx, cityRow.id, playerId);

    const researched = await loadResearch(tx, playerId);
    const effects = techEffects(researched);
    await finalizeDueConstructions(tx, city, now, effects);

    const buildings = await loadBuildings(tx, city.id);
    // Settle first so the knowledge balance is current before checking it.
    const amounts = await settleCity(tx, city, buildings, now, effects);

    const failure = checkResearch(techId, researched, amounts.knowledge);
    if (failure) {
      if (failure.kind === 'alreadyResearched') {
        throw new AppError('INVALID_STATE', `${techId} is already researched`, { techId });
      }
      if (failure.kind === 'missingPrerequisite') {
        throw new AppError('UNMET_PREREQUISITE', `Requires ${failure.prerequisite} first`, {
          techId,
          prerequisite: failure.prerequisite
        });
      }
      throw new AppError('INSUFFICIENT_RESOURCES', 'Not enough knowledge', {
        cost: failure.cost,
        available: failure.available
      });
    }

    // Pay: subtract knowledge at the already-settled reference time.
    await tx
      .update(cityResources)
      .set({ amountAtRef: amounts.knowledge - TECHS[techId].knowledgeCost })
      .where(and(eq(cityResources.cityId, city.id), eq(cityResources.resource, 'knowledge')));
    await tx.insert(playerResearch).values({ playerId, techId, researchedAt: now });

    return loadCityState(tx, city, [...researched, techId]);
  });
}
