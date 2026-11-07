import type { ApiErrorDTO } from '@filmfind/shared';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createProwlarrClient, type ProwlarrClient } from '../clients/prowlarr.js';
import { createTmdbClient, type TmdbClient } from '../clients/tmdb.js';
import type { AppConfig } from '../config.js';
import type { LruCache } from '../lib/lru.js';
import {
  ReleasesError,
  createReleasesService,
  type ReleasesResult,
  type ReleasesService,
} from '../lib/releases.js';

export interface ReleasesRoutesOptions {
  config: AppConfig;
  /** Внедряются в тестах; в проде создаются из config. */
  tmdb?: TmdbClient;
  prowlarr?: ProwlarrClient;
  cache?: LruCache<string, ReleasesResult>;
}

const MAX_LIMIT = 300;

const emptyToUndefined = (value: unknown): unknown =>
  value === '' || value === null ? undefined : value;

const optionalInt = (min: number, max: number) =>
  z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(min).max(max).optional(),
  );

const querySchema = z.object({
  type: z.enum(['movie', 'tv']),
  titleId: optionalInt(1, Number.MAX_SAFE_INTEGER),
  season: optionalInt(0, 100),
  q: z.preprocess(
    emptyToUndefined,
    z.string().trim().min(1).max(200).optional(),
  ),
  indexerIds: z.union([z.string(), z.array(z.string())]).optional(),
  limit: optionalInt(1, MAX_LIMIT),
});

type ParsedQuery = z.infer<typeof querySchema>;

function sendValidationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.code(400).send({
    code: 'VALIDATION_ERROR',
    message: 'Некорректные параметры запроса',
    details,
  } satisfies ApiErrorDTO);
}

/** `indexerIds=1,2` и `indexerIds=1&indexerIds=2` — оба варианта валидны. */
function parseIndexerIds(value: string | string[] | undefined): number[] | null | undefined {
  if (value === undefined) return undefined;

  const parts = (Array.isArray(value) ? value : [value])
    .flatMap((chunk) => chunk.split(','))
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  // Пустое значение равнозначно отсутствию параметра.
  if (parts.length === 0) return undefined;

  const ids = new Set<number>();
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    ids.add(Number(part));
  }
  return [...ids];
}

function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function sendUpstreamError(reply: FastifyReply, error: unknown): FastifyReply {
  const code = errorCodeOf(error);
  const message = error instanceof Error ? error.message : 'Внешний сервис недоступен';

  // Не задан ключ/URL — это конфигурационная проблема, а не сбой апстрима.
  if (code === 'PROWLARR_NOT_CONFIGURED' || code === 'TMDB_NOT_CONFIGURED') {
    return reply.code(503).send({ code, message } satisfies ApiErrorDTO);
  }

  if (code === 'PROWLARR_UNAUTHORIZED') {
    return reply
      .code(502)
      .send({ code, message: 'Prowlarr отклонил API-ключ' } satisfies ApiErrorDTO);
  }

  if (code === 'BAD_REQUEST') {
    return reply.code(400).send({ code, message } satisfies ApiErrorDTO);
  }

  if (code?.startsWith('TMDB_')) {
    const status = code === 'TMDB_NOT_FOUND' ? 404 : 502;
    return reply.code(status).send({ code, message } satisfies ApiErrorDTO);
  }

  if (code?.startsWith('PROWLARR_')) {
    return reply.code(502).send({ code, message } satisfies ApiErrorDTO);
  }

  // Неизвестная ошибка — пусть её обработает общий error handler приложения.
  throw error;
}

/**
 * GET /api/releases — поиск раздач через Prowlarr.
 * Отдаёт только публичные поля: magnetUrl/downloadUrl остаются на сервере.
 */
export const releasesRoutes: FastifyPluginAsync<ReleasesRoutesOptions> = async (app, options) => {
  // Клиент TMDB создаётся лениво: сервер должен стартовать и без TMDB_API_KEY,
  // а ошибка конфигурации всплывает только на запросе, которому нужен TMDB.
  let tmdbClient: TmdbClient | undefined = options.tmdb;

  const resolveTmdb = (): TmdbClient => {
    if (tmdbClient) return tmdbClient;
    try {
      tmdbClient = createTmdbClient(options.config);
      return tmdbClient;
    } catch (error) {
      throw new ReleasesError(
        'TMDB_NOT_CONFIGURED',
        error instanceof Error ? error.message : 'TMDB_API_KEY не задан',
      );
    }
  };

  const tmdb: TmdbClient = {
    searchMulti: (query, page) => resolveTmdb().searchMulti(query, page),
    getTitle: (type, id) => resolveTmdb().getTitle(type, id),
  };

  const prowlarr = options.prowlarr ?? createProwlarrClient(options.config.prowlarr);
  // Сервис создаётся один раз, иначе кэш ответов не переживёт запрос.
  const service: ReleasesService = createReleasesService({
    tmdb,
    prowlarr,
    cache: options.cache,
  });

  app.get('/api/releases', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.issues);
    }

    const query: ParsedQuery = parsed.data;

    if (!query.q && query.titleId === undefined) {
      return sendValidationError(reply, [
        { path: ['titleId'], message: 'Укажите q или titleId' },
      ]);
    }

    const indexerIds = parseIndexerIds(query.indexerIds);
    if (indexerIds === null) {
      return sendValidationError(reply, [
        { path: ['indexerIds'], message: 'Ожидается список числовых id через запятую' },
      ]);
    }

    try {
      const result = await service.find({
        type: query.type,
        titleId: query.titleId,
        season: query.season,
        q: query.q,
        indexerIds,
        limit: query.limit,
      });

      // Только публичные поля — internal (магнит, downloadUrl) не покидает сервер.
      return reply.code(200).send({ items: result.items, warnings: result.warnings });
    } catch (error) {
      return sendUpstreamError(reply, error);
    }
  });
};
