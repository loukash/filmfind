import type { SearchResultDTO, TitleDetailsDTO } from '@filmfind/shared';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { loadConfig } from '../config.js';
import { TmdbError, createTmdbClient } from '../clients/tmdb.js';
import { LruCache } from '../lib/lru.js';

const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const DETAILS_CACHE_TTL_MS = 30 * 60 * 1000;
const SEARCH_CACHE_MAX = 500;
const DETAILS_CACHE_MAX = 1000;

export interface TitlesRoutesOptions {
  config?: AppConfig;
  /** Подмена fetch для тестов; в проде используется глобальный fetch. */
  fetch?: typeof fetch;
}

const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

const titleParamsSchema = z.object({
  type: z.enum(['movie', 'tv']),
  id: z.coerce.number().int().positive(),
});

/** 400 для невалидных query/params: app.ts превращает statusCode 400 в BAD_REQUEST. */
class BadRequestError extends Error {
  override name = 'BadRequestError';
  readonly statusCode = 400;
}

function validationMessage(path: PropertyKey | undefined): string {
  switch (path) {
    case 'q':
      return 'Параметр q должен содержать от 1 до 200 символов';
    case 'page':
      return 'Параметр page должен быть целым числом от 1 до 500';
    case 'type':
      return 'Параметр type должен быть movie или tv';
    case 'id':
      return 'Параметр id должен быть положительным целым числом';
    default:
      return 'Некорректные параметры запроса';
  }
}

function sendTmdbError(reply: FastifyReply, error: unknown): FastifyReply {
  if (!(error instanceof TmdbError)) throw error;

  const body = { code: error.code, message: error.message };
  switch (error.code) {
    case 'TMDB_NOT_CONFIGURED':
      return reply.code(503).send(body);
    case 'TMDB_NOT_FOUND':
      return reply.code(404).send(body);
    case 'TMDB_UNAUTHORIZED':
    case 'TMDB_UNAVAILABLE':
    default:
      return reply.code(502).send(body);
  }
}

export const titlesRoutes: FastifyPluginAsync<TitlesRoutesOptions> = async (app, opts) => {
  // Оркестратор передаёт config явно; fallback на env нужен, чтобы регистрация
  // без опций тоже работала (loadConfig бросает только на невалидном env).
  const config = opts.config ?? loadConfig();
  const client = createTmdbClient(config, opts.fetch ? { fetch: opts.fetch } : {});
  const language = config.tmdb.language;

  const searchCache = new LruCache<string, SearchResultDTO>({
    max: SEARCH_CACHE_MAX,
    ttlMs: SEARCH_CACHE_TTL_MS,
  });
  const detailsCache = new LruCache<string, TitleDetailsDTO>({
    max: DETAILS_CACHE_MAX,
    ttlMs: DETAILS_CACHE_TTL_MS,
  });

  app.get('/api/titles/search', async (request, reply) => {
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new BadRequestError(validationMessage(parsed.error.issues[0]?.path[0]));
    }

    const { q, page } = parsed.data;
    const cacheKey = `${language}|${q}|${page}`;
    const cached = searchCache.get(cacheKey);
    if (cached) return reply.code(200).send(cached);

    try {
      const result = await client.searchMulti(q, page);
      searchCache.set(cacheKey, result);
      return reply.code(200).send(result);
    } catch (error) {
      return sendTmdbError(reply, error);
    }
  });

  app.get('/api/titles/:type/:id', async (request, reply) => {
    const parsed = titleParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw new BadRequestError(validationMessage(parsed.error.issues[0]?.path[0]));
    }

    const { type, id } = parsed.data;
    const cacheKey = `${language}|${type}|${id}`;
    const cached = detailsCache.get(cacheKey);
    if (cached) return reply.code(200).send(cached);

    try {
      const details = await client.getTitle(type, id);
      detailsCache.set(cacheKey, details);
      return reply.code(200).send(details);
    } catch (error) {
      return sendTmdbError(reply, error);
    }
  });
};
