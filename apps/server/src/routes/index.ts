import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import { registerHealthRoute } from './health.js';
import { imgRoutes } from './img.js';
import { releasesRoutes } from './releases.js';
import { titlesRoutes } from './titles.js';
import { transmissionRoutes } from './transmission.js';

export async function registerRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  registerHealthRoute(app, config);

  await app.register(titlesRoutes, { config });
  await app.register(releasesRoutes, { config });
  await app.register(imgRoutes);
  await app.register(transmissionRoutes, { config });
}
