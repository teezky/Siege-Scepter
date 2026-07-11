import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { buildApp } from '../src/app.js';
import { createDatabase } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { FixedClock } from '../src/lib/clock.js';

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://siege:siege@localhost:5432/postgres';
const TEST_DB = 'siege_test';

export interface TestContext {
  app: FastifyInstance;
  clock: FixedClock;
  close: () => Promise<void>;
}

export async function createTestContext(): Promise<TestContext> {
  const admin = postgres(ADMIN_URL, { max: 1 });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  const testUrl = ADMIN_URL.replace(/\/[^/]*$/, `/${TEST_DB}`);
  const migrationSql = postgres(testUrl, { max: 1 });
  await migrate(drizzle(migrationSql), {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url))
  });
  await migrationSql.end();

  const { db, sql } = createDatabase(testUrl);
  const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
  const app = await buildApp({
    db,
    clock,
    cookieSecure: false,
    logger: false,
    // This file registers far more accounts per run than the production auth rate limit allows.
    authRateLimit: { max: 1000, timeWindow: '1 minute' }
  });

  return {
    app,
    clock,
    close: async () => {
      await app.close();
      await sql.end();
    }
  };
}

export { schema };

export interface TestPlayer {
  cookie: string;
  playerId: string;
  cityId: string;
}

export async function registerTestPlayer(
  ctx: TestContext,
  username: string,
  password = 'password123'
): Promise<TestPlayer> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password }
  });
  if (response.statusCode !== 201) {
    throw new Error(`Registration failed: ${response.body}`);
  }
  const setCookie = response.headers['set-cookie'];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!cookieHeader) throw new Error('No session cookie returned');
  const cookie = cookieHeader.split(';')[0]!;

  const cityResponse = await ctx.app.inject({ method: 'GET', url: '/api/city', headers: { cookie } });
  const cityBody = JSON.parse(cityResponse.body) as { city: { id: string } };

  return {
    cookie,
    playerId: (JSON.parse(response.body) as { player: { id: string } }).player.id,
    cityId: cityBody.city.id
  };
}
