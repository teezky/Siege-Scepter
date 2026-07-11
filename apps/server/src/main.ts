import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createDatabase } from './db/client.js';
import { systemClock } from './lib/clock.js';

const env = loadEnv();
const { db } = createDatabase(env.DATABASE_URL);

const app = await buildApp({
  db,
  clock: systemClock,
  cookieSecure: env.COOKIE_SECURE
});

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
