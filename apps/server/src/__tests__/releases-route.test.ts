import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type {
  InternalRelease,
  ProwlarrClient,
  ProwlarrSearchParams,
} from '../clients/prowlarr.js';
import type { TmdbClient } from '../clients/tmdb.js';
import { loadConfig } from '../config.js';
import { releasesRoutes } from '../routes/releases.js';

const ENV = {
  PROWLARR_URL: 'http://prowlarr.local:9696',
  PROWLARR_API_KEY: 'test-key',
};

function makeRelease(partial: Partial<InternalRelease> & { title: string }): InternalRelease {
  return {
    id: partial.id ?? partial.title,
    size: 1000,
    categories: [2000],
    quality: {},
    ...partial,
  };
}

function makeProwlarr(items: InternalRelease[], warnings: string[] = []) {
  const search = vi.fn(async (_params: ProwlarrSearchParams) => ({ items, warnings }));
  const client: ProwlarrClient = { search, getIndexers: vi.fn(async () => []) };
  return { client, search };
}

const tmdb: TmdbClient = {
  searchMulti: vi.fn(async () => ({ page: 1, totalPages: 0, totalResults: 0, items: [] })),
  getTitle: vi.fn(async (type, id) => ({
    id,
    type,
    title: 'Фильм',
    originalTitle: 'Movie',
    year: 2010,
    isAnimation: false,
    genres: [],
  })),
};

async function buildTestApp(options: {
  prowlarr?: ProwlarrClient;
  tmdb?: TmdbClient;
  env?: NodeJS.ProcessEnv;
} = {}) {
  const app = Fastify();
  const config = loadConfig(options.env ?? ENV);
  await app.register(releasesRoutes, {
    config,
    tmdb: options.tmdb,
    prowlarr: options.prowlarr,
  });
  await app.ready();
  return app;
}

describe('GET /api/releases', () => {
  it('отдаёт публичный DTO без magnetUrl и downloadUrl', async () => {
    const { client } = makeProwlarr([
      makeRelease({
        title: 'Фильм 2010 1080p',
        infoHash: 'abc',
        seeders: 5,
        magnetUrl: 'magnet:?xt=urn:btih:abc',
        downloadUrl: 'http://prowlarr.local/1/download?apikey=test-key',
      }),
    ]);
    const app = await buildTestApp({ prowlarr: client });

    const response = await app.inject({ method: 'GET', url: '/api/releases?type=movie&q=фильм' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      title: 'Фильм 2010 1080p',
      infoHash: 'abc',
      seeders: 5,
    });
    // Ключ Prowlarr не должен утечь в ответ ни в каком виде.
    expect(response.body).not.toContain('magnet:');
    expect(response.body).not.toContain('apikey');
    expect(body.items[0]).not.toHaveProperty('magnetUrl');
    expect(body.items[0]).not.toHaveProperty('downloadUrl');

    await app.close();
  });

  it('передаёт indexerIds и limit в клиент', async () => {
    const { client, search } = makeProwlarr([]);
    const app = await buildTestApp({ prowlarr: client });

    const response = await app.inject({
      method: 'GET',
      url: '/api/releases?type=movie&q=x&indexerIds=1,2&limit=7',
    });

    expect(response.statusCode).toBe(200);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]?.[0]).toMatchObject({
      query: 'x',
      indexerIds: [1, 2],
      limit: 7,
    });

    await app.close();
  });

  it('limit по умолчанию — 100', async () => {
    const { client, search } = makeProwlarr([]);
    const app = await buildTestApp({ prowlarr: client });

    await app.inject({ method: 'GET', url: '/api/releases?type=movie&q=x' });

    expect(search.mock.calls[0]?.[0]?.limit).toBe(100);

    await app.close();
  });

  it('отдаёт warnings от Prowlarr', async () => {
    const { client } = makeProwlarr([], ['Индексатор Broken: сбой']);
    const app = await buildTestApp({ prowlarr: client });

    const response = await app.inject({ method: 'GET', url: '/api/releases?type=movie&q=x' });

    expect(response.json().warnings).toEqual(['Индексатор Broken: сбой']);

    await app.close();
  });

  describe('валидация', () => {
    const cases: [string, string][] = [
      ['без type', '/api/releases?q=x'],
      ['неизвестный type', '/api/releases?type=anime&q=x'],
      ['limit=0', '/api/releases?type=movie&q=x&limit=0'],
      ['limit=301', '/api/releases?type=movie&q=x&limit=301'],
      ['season=101', '/api/releases?type=tv&titleId=1&season=101'],
      ['без q и titleId', '/api/releases?type=movie'],
      ['нечисловой indexerIds', '/api/releases?type=movie&q=x&indexerIds=abc'],
    ];

    for (const [name, url] of cases) {
      it(`400: ${name}`, async () => {
        const { client } = makeProwlarr([]);
        const app = await buildTestApp({ prowlarr: client });

        const response = await app.inject({ method: 'GET', url });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });

        await app.close();
      });
    }
  });

  it('503 PROWLARR_NOT_CONFIGURED, если Prowlarr не настроен', async () => {
    const app = await buildTestApp({ env: {}, tmdb });

    const response = await app.inject({ method: 'GET', url: '/api/releases?type=movie&q=x' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'PROWLARR_NOT_CONFIGURED' });

    await app.close();
  });

  it('503 TMDB_NOT_CONFIGURED, если нужен TMDB, а ключа нет', async () => {
    const { client } = makeProwlarr([]);
    // tmdb не внедряем: реальный клиент создастся без ключа и ответит TMDB_NOT_CONFIGURED.
    const app = await buildTestApp({ prowlarr: client });

    const response = await app.inject({ method: 'GET', url: '/api/releases?type=movie&titleId=1' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'TMDB_NOT_CONFIGURED' });

    await app.close();
  });

  it('ищет по titleId через TMDB', async () => {
    const { client, search } = makeProwlarr([makeRelease({ title: 'Фильм 2010 1080p' })]);
    const app = await buildTestApp({ prowlarr: client, tmdb });

    const response = await app.inject({ method: 'GET', url: '/api/releases?type=movie&titleId=42' });

    expect(response.statusCode).toBe(200);
    expect(search.mock.calls.map(([params]) => params.query)).toEqual([
      'Фильм',
      'Movie',
      'Фильм 2010',
    ]);

    await app.close();
  });
});
