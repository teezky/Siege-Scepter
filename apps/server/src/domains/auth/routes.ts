import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { loginPlayer, logoutSession, registerPlayer } from './service.js';

const credentialsSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(24, 'Username must be at most 24 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username may contain letters, digits and underscores'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128)
});

export const SESSION_COOKIE = 'siege_session';

export function registerAuthRoutes(
  app: FastifyInstance,
  rateLimit: { max: number; timeWindow: string }
): void {
  const authRateLimit = { rateLimit };

  app.post('/api/auth/register', { config: authRateLimit }, async (request, reply) => {
    const body = credentialsSchema.safeParse(request.body);
    if (!body.success) {
      throw new AppError('VALIDATION_FAILED', body.error.issues[0]?.message ?? 'Invalid input');
    }
    const result = await registerPlayer(app.db, app.clock, body.data.username, body.data.password);
    setSessionCookie(app, reply, result.sessionToken, result.sessionExpiresAt);
    reply.code(201);
    return { player: { id: result.playerId, username: result.username } };
  });

  app.post('/api/auth/login', { config: authRateLimit }, async (request, reply) => {
    const body = credentialsSchema.safeParse(request.body);
    if (!body.success) {
      throw new AppError('VALIDATION_FAILED', body.error.issues[0]?.message ?? 'Invalid input');
    }
    const result = await loginPlayer(app.db, body.data.username, body.data.password);
    setSessionCookie(app, reply, result.sessionToken, result.sessionExpiresAt);
    return { player: { id: result.playerId, username: result.username } };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await logoutSession(app.db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (request) => {
    const player = request.requirePlayer();
    return { player: { id: player.playerId, username: player.username } };
  });
}

function setSessionCookie(
  app: FastifyInstance,
  reply: { setCookie: (name: string, value: string, opts: object) => unknown },
  token: string,
  expiresAt: Date
): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: app.env.COOKIE_SECURE,
    expires: expiresAt
  });
}
