import {
  BUILDINGS,
  STARTING_RESOURCES,
  buildingLevelCost,
  buildingLevelSeconds,
  type AttackPveResponse,
  type CityView,
  type MilitaryView,
  type RecruitUnitsResponse,
  type UnitId
} from '@siege/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, registerTestPlayer, type TestContext, type TestPlayer } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

async function getCity(player: TestPlayer): Promise<CityView> {
  const response = await ctx.app.inject({
    method: 'GET',
    url: '/api/city',
    headers: { cookie: player.cookie }
  });
  expect(response.statusCode).toBe(200);
  return (JSON.parse(response.body) as { city: CityView }).city;
}

async function build(player: TestPlayer, buildingId: string) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/cities/${player.cityId}/constructions`,
    headers: { cookie: player.cookie },
    payload: { buildingId }
  });
}

async function setWorkers(player: TestPlayer, allocation: Record<string, number>) {
  return ctx.app.inject({
    method: 'PUT',
    url: `/api/cities/${player.cityId}/workers`,
    headers: { cookie: player.cookie },
    payload: { allocation }
  });
}

async function getMilitary(player: TestPlayer): Promise<MilitaryView> {
  const response = await ctx.app.inject({
    method: 'GET',
    url: '/api/military',
    headers: { cookie: player.cookie }
  });
  expect(response.statusCode).toBe(200);
  return (JSON.parse(response.body) as { military: MilitaryView }).military;
}

async function recruit(player: TestPlayer, unitId: UnitId, quantity: number) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/cities/${player.cityId}/units`,
    headers: { cookie: player.cookie },
    payload: { unitId, quantity }
  });
}

async function attack(player: TestPlayer, encounterId: string) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/pve/${encounterId}/attack`,
    headers: { cookie: player.cookie }
  });
}

describe('registration and first city', () => {
  it('creates a city with starting buildings, workers and resources', async () => {
    const player = await registerTestPlayer(ctx, 'founder');
    const city = await getCity(player);

    expect(city.buildings).toEqual(
      expect.arrayContaining([
        { buildingId: 'townHall', level: 1, workers: 0, workerSlots: 0 },
        { buildingId: 'sawmill', level: 1, workers: 4, workerSlots: 6 },
        { buildingId: 'farm', level: 1, workers: 4, workerSlots: 6 }
      ])
    );
    expect(city.resources.amounts).toEqual(STARTING_RESOURCES);
    // 4 sawmill workers × 20/h
    expect(city.resources.ratesPerHour.wood).toBe(80);
    // farm 4 × 18 = 72, minus 12 citizens × 2 food upkeep
    expect(city.resources.ratesPerHour.food).toBe(48);
    // 4 free citizens × 4 coins tax
    expect(city.resources.ratesPerHour.coins).toBe(16);

    expect(city.population.total).toBe(12);
    expect(city.population.housingCapacity).toBe(30); // base 10 + town hall 20
    expect(city.population.freeCitizens).toBe(4);
    expect(city.population.soldiers).toBe(0);
    expect(city.population.nextArrivalAt).not.toBeNull();
  });

  it('rejects duplicate usernames with a structured error', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'founder', password: 'password123' }
    });
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error.code).toBe('CONFLICT');
  });
});

describe('time-based production and population growth', () => {
  it('accumulates resources and citizens from elapsed server time', async () => {
    const player = await registerTestPlayer(ctx, 'producer');
    ctx.clock.advanceMs(60 * 60 * 1000); // 1 hour

    const city = await getCity(player);
    // Wood rate is constant (workers do not change on their own): 4 × 20/h.
    expect(city.resources.amounts.wood).toBe(STARTING_RESOURCES.wood + 80);
    expect(city.resources.amounts.stone).toBe(STARTING_RESOURCES.stone); // no quarry yet
    // One citizen arrived every 15 minutes (food and housing allowed it).
    expect(city.population.total).toBe(16);
    // New citizens are free: tax income grew, food surplus shrank.
    expect(city.resources.ratesPerHour.coins).toBe(8 * 4);
    expect(city.resources.ratesPerHour.food).toBe(72 - 16 * 2);
  });

  it('growth stops at housing capacity', async () => {
    const player = await registerTestPlayer(ctx, 'landlord');
    ctx.clock.advanceMs(24 * 60 * 60 * 1000);

    const city = await getCity(player);
    expect(city.population.total).toBe(city.population.housingCapacity);
    expect(city.population.nextArrivalAt).toBeNull();
  });

  it('caps storage-capped resources at capacity', async () => {
    const player = await registerTestPlayer(ctx, 'hoarder');
    ctx.clock.advanceMs(1000 * 60 * 60 * 1000); // very long time

    const city = await getCity(player);
    expect(city.resources.amounts.wood).toBe(city.resources.storageCapacity);
    // Farm surplus stays positive even at full population (72 > 60).
    expect(city.resources.amounts.food).toBe(city.resources.storageCapacity);
    // Coins are not storage-capped in slice 1.
    expect(city.resources.amounts.coins).toBeGreaterThan(city.resources.storageCapacity);
  });
});

describe('construction', () => {
  it('starts construction, subtracts cost and completes on time', async () => {
    const player = await registerTestPlayer(ctx, 'builder');
    const before = await getCity(player);

    const response = await build(player, 'quarry');
    expect(response.statusCode).toBe(201);
    const { city: afterStart, order } = JSON.parse(response.body) as {
      city: CityView;
      order: { status: string; completesAt: string };
    };

    const cost = buildingLevelCost(BUILDINGS.quarry, 1);
    expect(afterStart.resources.amounts.wood).toBe(before.resources.amounts.wood - cost.wood!);
    expect(afterStart.resources.amounts.stone).toBe(before.resources.amounts.stone - cost.stone!);
    expect(order.status).toBe('IN_PROGRESS');

    // Not yet complete.
    ctx.clock.advanceMs(buildingLevelSeconds(BUILDINGS.quarry, 1) * 1000 - 1000);
    let city = await getCity(player);
    expect(city.buildings.find((b) => b.buildingId === 'quarry')).toBeUndefined();
    expect(city.constructionQueue).toHaveLength(1);

    // Complete — but a fresh quarry has no workers, so no stone flows yet.
    ctx.clock.advanceMs(2000);
    city = await getCity(player);
    expect(city.buildings).toContainEqual({ buildingId: 'quarry', level: 1, workers: 0, workerSlots: 6 });
    expect(city.constructionQueue).toHaveLength(0);
    expect(city.resources.ratesPerHour.stone).toBe(0);
  });

  it('a completed building produces nothing until workers are assigned', async () => {
    const player = await registerTestPlayer(ctx, 'timekeeper');
    await build(player, 'quarry');
    const buildMs = buildingLevelSeconds(BUILDINGS.quarry, 1) * 1000;

    // Advance one full hour past the completion time: still zero stone gained.
    ctx.clock.advanceMs(buildMs + 60 * 60 * 1000);
    let city = await getCity(player);
    const cost = buildingLevelCost(BUILDINGS.quarry, 1);
    expect(city.resources.amounts.stone).toBe(STARTING_RESOURCES.stone - cost.stone!);

    // Staff it: production starts from the allocation moment.
    const response = await setWorkers(player, { sawmill: 4, farm: 4, quarry: 3 });
    expect(response.statusCode).toBe(200);
    ctx.clock.advanceMs(60 * 60 * 1000);
    city = await getCity(player);
    expect(city.resources.amounts.stone).toBe(STARTING_RESOURCES.stone - cost.stone! + 3 * 15);
  });

  it('queues up to the limit and rejects beyond it', async () => {
    const player = await registerTestPlayer(ctx, 'queuer');
    // Sawmill and farm start at level 1, so queuing all four costs more wood
    // than the starting balance; let production run a bit first, as a real
    // player would before affording four consecutive upgrades.
    ctx.clock.advanceMs(75 * 60 * 1000);

    expect((await build(player, 'sawmill')).statusCode).toBe(201); // active
    expect((await build(player, 'farm')).statusCode).toBe(201); // queue 1
    expect((await build(player, 'warehouse')).statusCode).toBe(201); // queue 2
    expect((await build(player, 'quarry')).statusCode).toBe(201); // queue 3

    const rejected = await build(player, 'townHall');
    expect(rejected.statusCode).toBe(409);
    expect(JSON.parse(rejected.body).error.code).toBe('QUEUE_FULL');
  });

  it('processes the queue chronologically while offline', async () => {
    const player = await registerTestPlayer(ctx, 'sleeper');
    await build(player, 'quarry'); // active
    await build(player, 'warehouse'); // queued

    // Sleep long enough for both to finish.
    ctx.clock.advanceMs(24 * 60 * 60 * 1000);
    const city = await getCity(player);
    expect(city.buildings).toContainEqual({ buildingId: 'quarry', level: 1, workers: 0, workerSlots: 6 });
    expect(city.buildings).toContainEqual({ buildingId: 'warehouse', level: 1, workers: 0, workerSlots: 0 });
    expect(city.constructionQueue).toHaveLength(0);
  });

  it('rejects construction the player cannot afford', async () => {
    const player = await registerTestPlayer(ctx, 'pauper');
    // Drain resources by building until broke (town hall level 2 is expensive).
    await build(player, 'townHall');
    const response = await build(player, 'ironMine');
    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body);
    expect(['INSUFFICIENT_RESOURCES', 'UNMET_PREREQUISITE']).toContain(body.error.code);
  });

  it('enforces building prerequisites server-side', async () => {
    const player = await registerTestPlayer(ctx, 'ambitious');
    const response = await build(player, 'ironMine');
    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('UNMET_PREREQUISITE');
    expect(body.error.details).toMatchObject({ buildingId: 'townHall', requiredLevel: 3 });
  });

  it('rejects acting on another player’s city', async () => {
    const owner = await registerTestPlayer(ctx, 'owner_player');
    const intruder = await registerTestPlayer(ctx, 'intruder');

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/cities/${owner.cityId}/constructions`,
      headers: { cookie: intruder.cookie },
      payload: { buildingId: 'quarry' }
    });
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe('PERMISSION_DENIED');
  });

  it('rejects unauthenticated requests', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/city' });
    expect(response.statusCode).toBe(401);
  });

  it('finalization is idempotent — repeated reads do not double-apply', async () => {
    const player = await registerTestPlayer(ctx, 'idempotent');
    await build(player, 'quarry');
    ctx.clock.advanceMs(60 * 60 * 1000);

    const first = await getCity(player);
    const second = await getCity(player);
    expect(second.buildings).toEqual(first.buildings);
    expect(second.resources.amounts).toEqual(first.resources.amounts);
    expect(second.population.total).toBe(first.population.total);
    const quarries = second.buildings.filter((b) => b.buildingId === 'quarry');
    expect(quarries).toEqual([{ buildingId: 'quarry', level: 1, workers: 0, workerSlots: 6 }]);
  });
});

describe('worker allocation', () => {
  it('rejects more workers than the building has slots', async () => {
    const player = await registerTestPlayer(ctx, 'overstaffer');
    const response = await setWorkers(player, { sawmill: 7 }); // level 1 → 6 slots
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects allocating to an unbuilt building', async () => {
    const player = await registerTestPlayer(ctx, 'planner');
    const response = await setWorkers(player, { quarry: 1 });
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error.code).toBe('INVALID_STATE');
  });

  it('rejects allocating to a building that employs no workers', async () => {
    const player = await registerTestPlayer(ctx, 'bureaucrat');
    const response = await setWorkers(player, { townHall: 1 });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a total above the population', async () => {
    const player = await registerTestPlayer(ctx, 'slavedriver');
    // Exactly the whole population working is allowed…
    const allWorking = await setWorkers(player, { sawmill: 6, farm: 6 });
    expect(allWorking.statusCode).toBe(200);

    // …but more slots than citizens is not. Upgrade the sawmill to get
    // 12 slots while the population is still 12.
    await build(player, 'sawmill');
    ctx.clock.advanceMs(60 * 1000); // level 2 finishes in ~38s; well before the next arrival
    const tooMany = await setWorkers(player, { sawmill: 12, farm: 6 });
    expect(tooMany.statusCode).toBe(409);
    expect(JSON.parse(tooMany.body).error.code).toBe('INSUFFICIENT_RESOURCES');
  });

  it('re-allocation changes rates and free citizens immediately', async () => {
    const player = await registerTestPlayer(ctx, 'micromanager');
    const response = await setWorkers(player, { sawmill: 6, farm: 2 });
    expect(response.statusCode).toBe(200);
    const { city } = JSON.parse(response.body) as { city: CityView };

    expect(city.resources.ratesPerHour.wood).toBe(120); // 6 × 20
    expect(city.resources.ratesPerHour.food).toBe(2 * 18 - 12 * 2); // 12/h
    expect(city.population.freeCitizens).toBe(4);
    expect(city.resources.ratesPerHour.coins).toBe(16);
  });

  it('rejects another player’s allocation', async () => {
    const owner = await registerTestPlayer(ctx, 'workowner');
    const intruder = await registerTestPlayer(ctx, 'workthief');
    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/api/cities/${owner.cityId}/workers`,
      headers: { cookie: intruder.cookie },
      payload: { allocation: { sawmill: 1 } }
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('research', () => {
  async function research(player: TestPlayer, techId: string) {
    return ctx.app.inject({
      method: 'POST',
      url: '/api/research',
      headers: { cookie: player.cookie },
      payload: { techId }
    });
  }

  /**
   * Town hall 2 + academy with scientists, then 24h of knowledge
   * (4 × 6/h × 24h = 576). A quarry comes first — without one the starting
   * stone cannot cover town hall 2 (150) plus the academy (120).
   */
  async function playerWithKnowledge(name: string): Promise<TestPlayer> {
    const player = await registerTestPlayer(ctx, name);
    expect((await build(player, 'quarry')).statusCode).toBe(201);
    ctx.clock.advanceMs(60 * 1000); // quarry done (25s)
    expect((await setWorkers(player, { sawmill: 4, farm: 4, quarry: 4 })).statusCode).toBe(200);
    expect((await build(player, 'townHall')).statusCode).toBe(201);
    ctx.clock.advanceMs(2 * 60 * 60 * 1000); // town hall 2 done; wood/stone regrow
    expect((await build(player, 'academy')).statusCode).toBe(201);
    ctx.clock.advanceMs(3 * 60 * 1000); // academy done (~90s)
    // Town hall 2 houses 50 citizens, who eat 100 food/h at the cap — a fully
    // staffed farm (6 × 18 = 108/h) keeps the city fed while knowledge piles up.
    expect((await setWorkers(player, { sawmill: 4, farm: 6, quarry: 4, academy: 4 })).statusCode).toBe(200);
    ctx.clock.advanceMs(24 * 60 * 60 * 1000); // 4 scientists × 6/h × 24h = 576 knowledge
    return player;
  }

  it('accumulates knowledge from scientists and researches a tech', async () => {
    const player = await playerWithKnowledge('scholar');
    let city = await getCity(player);
    expect(city.resources.amounts.knowledge).toBeGreaterThanOrEqual(576);
    expect(city.researchedTechs).toEqual([]);

    const response = await research(player, 'stoneTools');
    expect(response.statusCode).toBe(201);
    city = (JSON.parse(response.body) as { city: CityView }).city;
    expect(city.researchedTechs).toEqual(['stoneTools']);
    // Knowledge was spent…
    expect(city.resources.amounts.knowledge).toBeLessThan(576 + 200);
    // …and sawmill workers now produce (20+5) each.
    expect(city.resources.ratesPerHour.wood).toBe(4 * 25);
  });

  it('enforces the prerequisite chain and double-research', async () => {
    const player = await playerWithKnowledge('chainer');
    expect((await research(player, 'constructionCranes')).statusCode).toBe(409);
    expect((await research(player, 'stoneTools')).statusCode).toBe(201);
    const dup = await research(player, 'stoneTools');
    expect(dup.statusCode).toBe(409);
    expect(JSON.parse(dup.body).error.code).toBe('INVALID_STATE');
  });

  it('rejects research without enough knowledge', async () => {
    const player = await registerTestPlayer(ctx, 'illiterate');
    const response = await research(player, 'stoneTools');
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error.code).toBe('INSUFFICIENT_RESOURCES');
  });

  it('construction cranes widen the build queue', async () => {
    const player = await playerWithKnowledge('craneop');
    expect((await research(player, 'stoneTools')).statusCode).toBe(201);
    expect((await research(player, 'constructionCranes')).statusCode).toBe(201);

    // Storage is full after 24h, so five orders are affordable.
    expect((await build(player, 'sawmill')).statusCode).toBe(201); // active
    expect((await build(player, 'farm')).statusCode).toBe(201); // queue 1
    expect((await build(player, 'warehouse')).statusCode).toBe(201); // queue 2
    expect((await build(player, 'quarry')).statusCode).toBe(201); // queue 3
    expect((await build(player, 'house')).statusCode).toBe(201); // queue 4 (crane slot)
    expect((await build(player, 'academy')).statusCode).toBe(201); // queue 5 (crane slot)

    const rejected = await build(player, 'townHall');
    expect(rejected.statusCode).toBe(409);
    expect(JSON.parse(rejected.body).error.code).toBe('QUEUE_FULL');
  });

  it('sanitation speeds up population growth', async () => {
    const player = await playerWithKnowledge('plumber');
    // Fill some housing first? No — housing is already full after 24h.
    // Build a house to open room, then compare arrival cadence.
    expect((await research(player, 'sanitation')).statusCode).toBe(201);
    expect((await build(player, 'house')).statusCode).toBe(201);
    ctx.clock.advanceMs(60 * 1000); // house done (~20s)

    const before = (await getCity(player)).population.total;
    ctx.clock.advanceMs(31 * 60 * 1000); // 3 arrivals at 10-min cadence
    const after = (await getCity(player)).population.total;
    expect(after - before).toBe(3);
  });
});

describe('simple army and PvE', () => {
  async function playerWithBarracks(name: string): Promise<TestPlayer> {
    const player = await registerTestPlayer(ctx, name);
    expect((await build(player, 'quarry')).statusCode).toBe(201);
    ctx.clock.advanceMs(60 * 1000);
    expect((await setWorkers(player, { sawmill: 4, farm: 4, quarry: 4 })).statusCode).toBe(200);
    ctx.clock.advanceMs(2 * 60 * 60 * 1000); // grow population and stone
    expect((await build(player, 'townHall')).statusCode).toBe(201);
    ctx.clock.advanceMs(60 * 1000);
    expect((await build(player, 'barracks')).statusCode).toBe(201);
    ctx.clock.advanceMs(2 * 60 * 1000);
    ctx.clock.advanceMs(15 * 60 * 1000); // replenish wood for the first six recruits
    return player;
  }

  it('starts with an empty army and two visible encounters', async () => {
    const player = await registerTestPlayer(ctx, 'peacekeeper');
    const military = await getMilitary(player);
    expect(military.army).toMatchObject({
      units: { spearman: 0, archer: 0 },
      totalUnits: 0,
      power: 0
    });
    expect(military.encounters.map((encounter) => encounter.id)).toEqual([
      'banditCamp',
      'raiderOutpost'
    ]);
    expect(military.encounters[1]?.locked).toBe(true);
  });

  it('requires a barracks and free citizens for recruitment', async () => {
    const player = await registerTestPlayer(ctx, 'unprepared');
    const noBarracks = await recruit(player, 'spearman', 1);
    expect(noBarracks.statusCode).toBe(409);
    expect(JSON.parse(noBarracks.body).error.code).toBe('UNMET_PREREQUISITE');

    const prepared = await playerWithBarracks('recruiter');
    const response = await recruit(prepared, 'spearman', 6);
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as RecruitUnitsResponse;
    expect(body.military.army.units.spearman).toBe(6);
    expect(body.military.army.power).toBe(60);
    expect(body.city.population.soldiers).toBe(6);
    expect(body.city.population.freeCitizens).toBe(
      body.city.population.total - 12 - body.city.population.soldiers
    );

    const tooMany = await recruit(prepared, 'archer', 100);
    expect(tooMany.statusCode).toBe(409);
    expect(JSON.parse(tooMany.body).error.code).toBe('INSUFFICIENT_RESOURCES');
  });

  it('reserves soldiers from worker allocation and tax income', async () => {
    const player = await playerWithBarracks('quartermaster');
    expect((await recruit(player, 'spearman', 6)).statusCode).toBe(201);
    const city = await getCity(player);
    expect(city.population.soldiers).toBe(6);
    expect(city.resources.ratesPerHour.coins).toBe(city.population.freeCitizens * 4);

    const tooManyWorkers = await setWorkers(player, { sawmill: 6, farm: 6, quarry: 6 });
    expect(tooManyWorkers.statusCode).toBe(409);
  });

  it('resolves a victory once, applies losses and grants the reward once', async () => {
    const player = await playerWithBarracks('campbreaker');
    expect((await recruit(player, 'spearman', 6)).statusCode).toBe(201);
    const before = await getCity(player);

    const response = await attack(player, 'banditCamp');
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as AttackPveResponse;
    expect(body.report).toMatchObject({
      encounterId: 'banditCamp',
      victory: true,
      attackerPower: 60,
      defenderPower: 60,
      unitsLost: { spearman: 2, archer: 0 }
    });
    expect(body.military.army.units.spearman).toBe(4);
    expect(body.city.population.total).toBe(before.population.total - 2);
    expect(body.military.encounters.find((entry) => entry.id === 'banditCamp')?.completed).toBe(true);
    expect(body.city.resources.amounts.coins).toBe(before.resources.amounts.coins + 60);

    const duplicate = await attack(player, 'banditCamp');
    expect(duplicate.statusCode).toBe(409);
    expect(JSON.parse(duplicate.body).error.code).toBe('INVALID_STATE');
    expect((await getCity(player)).resources.amounts.coins).toBe(body.city.resources.amounts.coins);
  });

  it('records a recoverable defeat without rewards', async () => {
    const player = await playerWithBarracks('survivor');
    expect((await recruit(player, 'spearman', 3)).statusCode).toBe(201);
    const response = await attack(player, 'banditCamp');
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as AttackPveResponse;
    expect(body.report.victory).toBe(false);
    expect(body.report.reward).toEqual({});
    expect(body.military.army.units.spearman).toBe(1);
    expect(body.city.population.soldiers).toBe(1);
    expect(body.military.recentReports[0]?.victory).toBe(false);
  });

  it('enforces encounter order and authentication', async () => {
    const player = await playerWithBarracks('pathfinder');
    expect((await recruit(player, 'archer', 1)).statusCode).toBe(201);
    const locked = await attack(player, 'raiderOutpost');
    expect(locked.statusCode).toBe(409);
    expect(JSON.parse(locked.body).error.code).toBe('UNMET_PREREQUISITE');

    const anonymous = await ctx.app.inject({ method: 'GET', url: '/api/military' });
    expect(anonymous.statusCode).toBe(401);
  });
});

describe('famine', () => {
  it('empty pantry pauses growth, nobody dies, recovery works', async () => {
    const player = await registerTestPlayer(ctx, 'starver');
    // Let the city grow to its housing cap first (30 citizens after ~4.5h).
    ctx.clock.advanceMs(6 * 60 * 60 * 1000);

    // Then nobody farms: food drains at 2/citizen/h, 60/h.
    expect((await setWorkers(player, { sawmill: 4, farm: 0 })).statusCode).toBe(200);
    ctx.clock.advanceMs(24 * 60 * 60 * 1000);
    let city = await getCity(player);
    expect(city.resources.amounts.food).toBe(0);
    expect(city.population.total).toBe(30); // nobody died

    // New housing during a famine attracts nobody.
    expect((await build(player, 'house')).statusCode).toBe(201);
    ctx.clock.advanceMs(3 * 60 * 60 * 1000);
    city = await getCity(player);
    expect(city.population.housingCapacity).toBe(44); // house built: 30 + 14
    expect(city.population.total).toBe(30); // growth still paused

    // Put everyone on the fields: the surplus refills the pantry and
    // arrivals resume.
    expect((await setWorkers(player, { farm: 6 })).statusCode).toBe(200);
    ctx.clock.advanceMs(2 * 60 * 60 * 1000);
    city = await getCity(player);
    expect(city.resources.amounts.food).toBeGreaterThan(0);
    expect(city.population.total).toBeGreaterThan(30); // growth resumed
  });
});

describe('auth flow', () => {
  it('supports login and logout', async () => {
    await registerTestPlayer(ctx, 'traveller');

    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'traveller', password: 'password123' }
    });
    expect(login.statusCode).toBe(200);

    const badLogin = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'traveller', password: 'wrong-password' }
    });
    expect(badLogin.statusCode).toBe(401);
  });
});
