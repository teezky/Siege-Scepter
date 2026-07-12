import { PVE_ENCOUNTER_IDS, UNIT_IDS } from '@siege/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { toCityView } from '../cities/view.js';
import { attackPveEncounter, getMilitaryState, recruitUnits } from './service.js';
import { toBattleReportView, toMilitaryView } from './view.js';

const cityParams = z.object({ cityId: z.string().uuid() });
const encounterParams = z.object({ encounterId: z.enum(PVE_ENCOUNTER_IDS) });
const recruitBody = z.object({
  unitId: z.enum(UNIT_IDS),
  quantity: z.number().int().min(1).max(1000)
});

export function registerMilitaryRoutes(app: FastifyInstance): void {
  app.get('/api/military', async (request) => {
    const player = request.requirePlayer();
    return { military: toMilitaryView(await getMilitaryState(app.db, player.playerId)) };
  });

  app.post('/api/cities/:cityId/units', async (request, reply) => {
    const player = request.requirePlayer();
    const params = cityParams.safeParse(request.params);
    if (!params.success) throw new AppError('VALIDATION_FAILED', 'Invalid city id');
    const body = recruitBody.safeParse(request.body);
    if (!body.success) throw new AppError('VALIDATION_FAILED', 'Invalid unit or quantity');

    const result = await recruitUnits(
      app.db,
      player.playerId,
      params.data.cityId,
      body.data.unitId,
      body.data.quantity,
      app.clock
    );
    reply.code(201);
    return {
      city: toCityView(result.city, app.clock.now()),
      military: toMilitaryView(result.military)
    };
  });

  app.post('/api/pve/:encounterId/attack', async (request, reply) => {
    const player = request.requirePlayer();
    const params = encounterParams.safeParse(request.params);
    if (!params.success) throw new AppError('VALIDATION_FAILED', 'Invalid encounter id');

    const result = await attackPveEncounter(
      app.db,
      player.playerId,
      params.data.encounterId,
      app.clock
    );
    reply.code(201);
    return {
      city: toCityView(result.city, app.clock.now()),
      military: toMilitaryView(result.military),
      report: toBattleReportView(result.report)
    };
  });
}
