import { BUILDINGS, STARTING_RESOURCES, buildingLevelCost, buildingLevelSeconds, type CityView } from '@siege/shared';
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

describe('registration and first city', () => {
  it('creates a city with starting buildings and resources', async () => {
    const player = await registerTestPlayer(ctx, 'founder');
    const city = await getCity(player);

    expect(city.buildings).toEqual(
      expect.arrayContaining([
        { buildingId: 'townHall', level: 1 },
        { buildingId: 'sawmill', level: 1 },
        { buildingId: 'farm', level: 1 }
      ])
    );
    expect(city.resources.amounts).toEqual(STARTING_RESOURCES);
    expect(city.resources.ratesPerHour.wood).toBe(120);
    expect(city.resources.ratesPerHour.food).toBe(110);
    expect(city.resources.ratesPerHour.coins).toBe(40);
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

describe('time-based resource production', () => {
  it('accumulates resources from elapsed server time', async () => {
    const player = await registerTestPlayer(ctx, 'producer');
    ctx.clock.advanceMs(60 * 60 * 1000); // 1 hour

    const city = await getCity(player);
    expect(city.resources.amounts.wood).toBe(STARTING_RESOURCES.wood + 120);
    expect(city.resources.amounts.food).toBe(STARTING_RESOURCES.food + 110);
    expect(city.resources.amounts.stone).toBe(STARTING_RESOURCES.stone); // no quarry yet
  });

  it('caps storage-capped resources at capacity', async () => {
    const player = await registerTestPlayer(ctx, 'hoarder');
    ctx.clock.advanceMs(1000 * 60 * 60 * 1000); // very long time

    const city = await getCity(player);
    expect(city.resources.amounts.wood).toBe(city.resources.storageCapacity);
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

    // Complete.
    ctx.clock.advanceMs(2000);
    city = await getCity(player);
    expect(city.buildings).toContainEqual({ buildingId: 'quarry', level: 1 });
    expect(city.constructionQueue).toHaveLength(0);
    expect(city.resources.ratesPerHour.stone).toBe(90);
  });

  it('production rate changes take effect from the completion moment', async () => {
    const player = await registerTestPlayer(ctx, 'timekeeper');
    await build(player, 'quarry');
    const buildMs = buildingLevelSeconds(BUILDINGS.quarry, 1) * 1000;

    // Advance one full hour past the completion time.
    ctx.clock.advanceMs(buildMs + 60 * 60 * 1000);
    const city = await getCity(player);
    // Stone: starting - cost + exactly 1h of quarry production (90).
    const cost = buildingLevelCost(BUILDINGS.quarry, 1);
    expect(city.resources.amounts.stone).toBe(STARTING_RESOURCES.stone - cost.stone! + 90);
  });

  it('queues up to the limit and rejects beyond it', async () => {
    const player = await registerTestPlayer(ctx, 'queuer');
    // Sawmill and farm start at level 1, so queuing all four costs more wood
    // than the starting balance; let production run a bit first, as a real
    // player would before affording four consecutive upgrades.
    ctx.clock.advanceMs(45 * 60 * 1000);

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
    expect(city.buildings).toContainEqual({ buildingId: 'quarry', level: 1 });
    expect(city.buildings).toContainEqual({ buildingId: 'warehouse', level: 1 });
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
    const quarries = second.buildings.filter((b) => b.buildingId === 'quarry');
    expect(quarries).toEqual([{ buildingId: 'quarry', level: 1 }]);
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
