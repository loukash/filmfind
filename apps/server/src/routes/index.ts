import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import { registerHealthRoute } from './health.js';

export async function registerRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  registerHealthRoute(app, config);

  // Волны 1–2 добавят здесь:
  //   /api/titles/search, /api/titles/:type/:id  — TMDB
  //   /api/releases                               — Prowlarr
  //   /api/transmission/torrents, /api/transmission/add — Transmission
  //   /api/img/*                                  — прокси изображений TMDB
}
