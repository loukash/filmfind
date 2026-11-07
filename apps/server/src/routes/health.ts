import type { HealthDTO } from '@filmfind/shared';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import { checkHealth as checkProwlarr } from '../clients/prowlarr.js';
import { checkHealth as checkTmdb } from '../clients/tmdb.js';
import { checkHealth as checkTransmission } from '../clients/transmission.js';

export function registerHealthRoute(app: FastifyInstance, config: AppConfig): void {
  app.get('/api/health', async (_request, reply) => {
    const [tmdb, prowlarr, transmission] = await Promise.all([
      checkTmdb(config.tmdb),
      checkProwlarr(config.prowlarr),
      checkTransmission(config.transmission),
    ]);

    const allOk = tmdb.ok && prowlarr.ok && transmission.ok;
    const body: HealthDTO = {
      status: allOk ? 'ok' : 'degraded',
      services: { tmdb, prowlarr, transmission },
    };

    return reply.code(200).send(body);
  });
}
