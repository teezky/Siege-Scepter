import { BUILDING_IDS } from '@siege/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { getPlayerCityState, startConstruction } from './service.js';
import { toCityView } from './view.js';

const startConstructionBody = z.object({
  buildingId: z.enum(BUILDING_IDS)
});

const cityParams = z.object({
  cityId: z.string().uuid()
});

export function registerCityRoutes(app: FastifyInstance): void {
  app.get('/api/city', async (request) => {
    const player = request.requirePlayer();
    const state = await getPlayerCityState(app.db, player.playerId, app.clock);
    return { city: toCityView(state, app.clock.now()) };
  });

  app.post('/api/cities/:cityId/constructions', async (request, reply) => {
    const player = request.requirePlayer();
    const params = cityParams.safeParse(request.params);
    if (!params.success) throw new AppError('VALIDATION_FAILED', 'Invalid city id');
    const body = startConstructionBody.safeParse(request.body);
    if (!body.success) throw new AppError('VALIDATION_FAILED', 'Invalid or unknown buildingId');

    const { state, orderId } = await startConstruction(
      app.db,
      player.playerId,
      params.data.cityId,
      body.data.buildingId,
      app.clock
    );
    const city = toCityView(state, app.clock.now());
    const order = city.constructionQueue.find((o) => o.id === orderId) ?? null;
    reply.code(201);
    return { city, order };
  });
}
