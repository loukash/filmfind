import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { SearchResultDTO, TitleDetailsDTO } from '@filmfind/shared';
import { buildBaseApp } from '../app.js';
import { loadConfig } from '../config.js';
import { titlesRoutes, type TitlesRoutesOptions } from '../routes/titles.js';

interface FetchCall {
  url: URL;
}

function mockFetch(handler: (url: URL) => Response | Promise<Response>): {
  fetch: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const raw = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
    const url = new URL(raw);
    calls.push({ url });
    return handler(url);
  };
  return { fetch: fetchImpl as unknown as typeof fetch, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function createApp(options: TitlesRoutesOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig({ TMDB_API_KEY: 'abc123' });
  const app = await buildBaseApp(config);
  app.log.level = 'silent';
  await app.register(titlesRoutes, { ...options, config });
  await app.ready();
  return app;
}

const searchFixture = {
  page: 1,
  total_pages: 3,
  total_results: 42,
  results: [
    {
      id: 603,
      media_type: 'movie',
      title: 'Матрица',
      original_title: 'The Matrix',
      release_date: '1999-03-30',
      poster_path: '/matrix.jpg',
      vote_average: 8.2,
      genre_ids: [28, 878],
    },
    { id: 9000, media_type: 'person', name: 'Не актёр' },
  ],
};

const movieDetailsFixture = {
  id: 603,
  title: 'Матрица',
  original_title: 'The Matrix',
  release_date: '1999-03-30',
  poster_path: '/matrix.jpg',
  backdrop_path: '/matrix-backdrop.jpg',
  overview: 'Хакер узнаёт правду о мире.',
  vote_average: 8.2,
  genres: [{ id: 878, name: 'Фантастика' }],
  runtime: 136,
  status: 'Released',
  external_ids: { imdb_id: 'tt0133093' },
};

describe('GET /api/titles/search', () => {
  it('возвращает SearchResultDTO и передаёт query/page в TMDB', async () => {
    const { fetch, calls } = mockFetch(() => jsonResponse(searchFixture));
    const app = await createApp({ apiKey: 'abc123', fetch });

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/titles/search?q=matrix&page=2',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<SearchResultDTO>();
      expect(body.totalResults).toBe(42);
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({ id: 603, type: 'movie', title: 'Матрица' });

      expect(calls[0]?.url.searchParams.get('query')).toBe('matrix');
      expect(calls[0]?.url.searchParams.get('page')).toBe('2');
    } finally {
      await app.close();
    }
  });

  it('подставляет page=1 по умолчанию', async () => {
    const { fetch, calls } = mockFetch(() => jsonResponse(searchFixture));
    const app = await createApp({ apiKey: 'abc123', fetch });

    try {
      const response = await app.inject({ method: 'GET', url: '/api/titles/search?q=matrix' });

      expect(response.statusCode).toBe(200);
      expect(calls[0]?.url.searchParams.get('page')).toBe('1');
    } finally {
      await app.close();
    }
  });

  it.each([
    ['пустой q', '/api/titles/search?q='],
    ['без q', '/api/titles/search'],
    ['q длиннее 200 символов', `/api/titles/search?q=${'a'.repeat(201)}`],
    ['page=0', '/api/titles/search?q=matrix&page=0'],
    ['page=501', '/api/titles/search?q=matrix&page=501'],
    ['page не число', '/api/titles/search?q=matrix&page=abc'],
  ])('400 BAD_REQUEST: %s', async (_name, url) => {
    const { fetch, calls } = mockFetch(() => jsonResponse(searchFixture));
    const app = await createApp({ apiKey: 'abc123', fetch });

    try {
      const response = await app.inject({ method: 'GET', url });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'BAD_REQUEST' });
      expect(calls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('503 TMDB_NOT_CONFIGURED без ключа', async () => {
    const { fetch, calls } = mockFetch(() => jsonResponse(searchFixture));
    const app = await createApp({ config: loadConfig({}), fetch });

    try {
      const response = await app.inject({ method: 'GET', url: '/api/titles/search?q=matrix' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ code: 'TMDB_NOT_CONFIGURED' });
      expect(calls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('кэширует повторный поиск и не ходит в сеть', async () => {
    const { fetch, calls } = mockFetch(() => jsonResponse(searchFixture));
    const app = await createApp({ apiKey: 'abc123', fetch });

    try {
      const first = await app.inject({ method: 'GET', url: '/api/titles/search?q=matrix' });
      const second = await app.inject({ method: 'GET', url: '/api/titles/search?q=matrix' });

      expect(first.statusCode).toBe(200);
      expect(second.body).toBe(first.body);
      expect(calls).toHaveLength(1);

      // Другая страница — отдельный ключ кэша.
      await app.inject({ method: 'GET', url: '/api/titles/search?q=matrix&page=2' });
      expect(calls).toHaveLength(2);
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/titles/:type/:id', () => {
  it('возвращает TitleDetailsDTO для фильма и кэширует его', async () => {
    const { fetch, calls } = mockFetch(() => jsonResponse(movieDetailsFixture));
    const app = await createApp({ apiKey: 'abc123', fetch });

    try {
      const first = await app.inject({ method: 'GET', url: '/api/titles/movie/603' });
      const second = await app.inject({ method: 'GET', url: '/api/titles/movie/603' });

      expect(first.statusCode).toBe(200);
      const body = first.json<TitleDetailsDTO>();
      expect(body).toMatchObject({
        id: 603,
        type: 'movie',
        title: 'Матрица',
        runtime: 136,
        imdbId: 'tt0133093',
      });
      expect(second.body).toBe(first.body);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url.pathname).toBe('/3/movie/603');
    } finally {
      await app.close();
    }
  });

  it('404 TMDB_NOT_FOUND, если TMDB вернул 404', async () => {
    const { fetch } = mockFetch(() => jsonResponse({ success: false }, 404));
    const app = await createApp({ apiKey: 'abc123', fetch });

    try {
      const response = await app.inject({ method: 'GET', url: '/api/titles/movie/999999' });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'TMDB_NOT_FOUND' });
    } finally {
      await app.close();
    }
  });

  it.each([
    ['неизвестный type', '/api/titles/person/1'],
    ['id не число', '/api/titles/movie/abc'],
    ['id = 0', '/api/titles/movie/0'],
    ['id отрицательный', '/api/titles/movie/-1'],
    ['id дробный', '/api/titles/movie/1.5'],
  ])('400 BAD_REQUEST: %s', async (_name, url) => {
    const { fetch, calls } = mockFetch(() => jsonResponse(movieDetailsFixture));
    const app = await createApp({ apiKey: 'abc123', fetch });

    try {
      const response = await app.inject({ method: 'GET', url });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'BAD_REQUEST' });
      expect(calls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});
