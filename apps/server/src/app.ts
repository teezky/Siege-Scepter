import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Database } from './db/client.js';
import { SESSION_COOKIE, registerAuthRoutes } from './domains/auth/routes.js';
import { resolveSession, type SessionPlayer } from './domains/auth/service.js';
import { registerCityRoutes } from './domains/cities/routes.js';
import { registerMilitaryRoutes } from './domains/military/routes.js';
import type { Env } from './config/env.js';
import type { Clock } from './lib/clock.js';
import { AppError } from './lib/errors.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    clock: Clock;
    env: Pick<Env, 'COOKIE_SECURE'>;
  }
  interface FastifyRequest {
    sessionPlayer: SessionPlayer | null;
    requirePlayer(): SessionPlayer;
  }
}

export interface AppDeps {
  db: Database;
  clock: Clock;
  cookieSecure: boolean;
  logger?: boolean;
  /** Overridable so integration tests can create far more accounts per minute than production allows. */
  authRateLimit?: { max: number; timeWindow: string };
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? true });

  app.decorate('db', deps.db);
  app.decorate('clock', deps.clock);
  app.decorate('env', { COOKIE_SECURE: deps.cookieSecure });

  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, {
    global: false,
    // @fastify/rate-limit throws whatever this returns as the request error, so
    // it must carry statusCode itself — our setErrorHandler reads that to decide
    // between a 429 body and a 500 (a plain {error:...} object here would silently
    // become an "Internal server error" response instead of a rate-limit one).
    errorResponseBuilder: (_req, context) => {
      const err = new Error('Too many requests, slow down') as Error & { statusCode: number };
      err.statusCode = context.statusCode;
      return err;
    }
  });

  app.decorateRequest('sessionPlayer', null);
  app.decorateRequest('requirePlayer', function (this: { sessionPlayer: SessionPlayer | null }) {
    if (!this.sessionPlayer) {
      throw new AppError('UNAUTHENTICATED', 'Login required');
    }
    return this.sessionPlayer;
  });

  app.addHook('preHandler', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    request.sessionPlayer = token ? await resolveSession(app.db, token) : null;
  });

  app.setErrorHandler((error: FastifyError | AppError, _request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: error.toApiError() });
    }
    // Fastify validation / rate-limit errors carry statusCode.
    const statusCode = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (statusCode >= 500) {
      app.log.error(error);
      return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Internal server error' } });
    }
    return reply.code(statusCode).send({
      error: { code: statusCode === 429 ? 'RATE_LIMITED' : 'VALIDATION_FAILED', message: error.message }
    });
  });

  app.get('/api/health', async () => ({ ok: true }));

  registerAuthRoutes(app, deps.authRateLimit ?? { max: 10, timeWindow: '1 minute' });
  registerCityRoutes(app);
  registerMilitaryRoutes(app);

  return app;
}
