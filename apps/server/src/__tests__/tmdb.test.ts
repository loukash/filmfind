import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config.js';
import { loadConfig } from '../config.js';
import { TmdbError, createTmdbClient } from '../clients/tmdb.js';

interface FetchCall {
  url: URL;
  init: RequestInit | undefined;
}

function mockFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>): {
  fetch: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const raw = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
    const url = new URL(raw);
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetch: fetchImpl as unknown as typeof fetch, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function config(apiKey?: string): AppConfig {
  return loadConfig(apiKey === undefined ? {} : { TMDB_API_KEY: apiKey });
}

describe('createTmdbClient: аутентификация', () => {
  it('v3-ключ уходит query-параметром api_key', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({ page: 1, total_pages: 1, total_results: 0, results: [] }),
    );
    const client = createTmdbClient(config('abc123'), { fetch });

    await client.searchMulti('star');

    const call = calls[0];
    expect(call?.url.searchParams.get('api_key')).toBe('abc123');
    expect(call?.url.searchParams.get('language')).toBe('ru-RU');
    expect(call?.url.searchParams.get('include_adult')).toBe('false');
    expect(call?.url.searchParams.get('page')).toBe('1');
    expect(
      (call?.init?.headers as Record<string, string> | undefined)?.authorization,
    ).toBeUndefined();
  });

  it('v4-токен (префикс eyJ) уходит заголовком Authorization: Bearer', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({ page: 1, total_pages: 1, total_results: 0, results: [] }),
    );
    const client = createTmdbClient(config('eyJhbGciOiJIUzI1NiJ9.test'), { fetch });

    await client.searchMulti('star');

    const call = calls[0];
    expect(call?.url.searchParams.get('api_key')).toBeNull();
    expect((call?.init?.headers as Record<string, string> | undefined)?.authorization).toBe(
      'Bearer eyJhbGciOiJIUzI1NiJ9.test',
    );
  });

  it('без ключа бросает TMDB_NOT_CONFIGURED, не падая при создании клиента', async () => {
    const client = createTmdbClient(config());

    await expect(client.searchMulti('star')).rejects.toMatchObject({
      code: 'TMDB_NOT_CONFIGURED',
    });
    await expect(client.getTitle('movie', 1)).rejects.toMatchObject({
      code: 'TMDB_NOT_CONFIGURED',
    });
  });
});

describe('createTmdbClient.searchMulti', () => {
  it('фильтрует person и маппит movie/tv в TitleSummaryDTO', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({
        page: 2,
        total_pages: 7,
        total_results: 130,
        results: [
          {
            id: 1,
            media_type: 'movie',
            title: 'Локализованный фильм',
            original_title: 'Original Movie',
            release_date: '2020-05-01',
            poster_path: '/poster-movie.jpg',
            vote_average: 7.45,
            genre_ids: [16, 12],
          },
          {
            id: 2,
            media_type: 'tv',
            name: 'Локализованный сериал',
            original_name: 'Original Series',
            first_air_date: '2019-09-10',
            poster_path: null,
            vote_average: 0,
            genre_ids: [18],
          },
          { id: 3, media_type: 'person', name: 'Актёр' },
        ],
      }),
    );
    const client = createTmdbClient(config('abc123'), { fetch });

    const result = await client.searchMulti('star', 2);

    expect(calls[0]?.url.pathname).toBe('/3/search/multi');
    expect(result.page).toBe(2);
    expect(result.totalPages).toBe(7);
    expect(result.totalResults).toBe(130);
    expect(result.items).toHaveLength(2);

    expect(result.items[0]).toEqual({
      id: 1,
      type: 'movie',
      title: 'Локализованный фильм',
      originalTitle: 'Original Movie',
      year: 2020,
      posterPath: '/poster-movie.jpg',
      rating: 7.5,
      isAnimation: true,
    });

    expect(result.items[1]).toEqual({
      id: 2,
      type: 'tv',
      title: 'Локализованный сериал',
      originalTitle: 'Original Series',
      year: 2019,
      posterPath: undefined,
      rating: undefined,
      isAnimation: false,
    });
  });

  it('падает на original_* при отсутствии локализованного названия и не парсит пустую дату', async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse({
        page: 1,
        total_pages: 1,
        total_results: 2,
        results: [
          {
            id: 4,
            media_type: 'movie',
            original_title: 'Fallback Movie',
            release_date: '',
            vote_average: 8,
            genre_ids: [],
          },
          {
            id: 5,
            media_type: 'tv',
            original_name: 'Fallback Series',
            first_air_date: 'не дата',
            poster_path: '',
          },
        ],
      }),
    );
    const client = createTmdbClient(config('abc123'), { fetch });

    const result = await client.searchMulti('fallback');

    expect(result.items[0]?.title).toBe('Fallback Movie');
    expect(result.items[0]?.year).toBeUndefined();
    expect(result.items[0]?.rating).toBe(8);
    expect(result.items[1]?.title).toBe('Fallback Series');
    expect(result.items[1]?.year).toBeUndefined();
    expect(result.items[1]?.posterPath).toBeUndefined();
    expect(result.items[1]?.rating).toBeUndefined();
  });
});

describe('createTmdbClient.getTitle', () => {
  it('маппит детали фильма', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({
        id: 11,
        title: 'Звёздные войны',
        original_title: 'Star Wars',
        release_date: '1977-05-25',
        poster_path: '/poster.jpg',
        backdrop_path: '/backdrop.jpg',
        overview: 'Описание',
        vote_average: 8.21,
        genres: [
          { id: 12, name: 'Приключения' },
          { id: 16, name: 'Анимация' },
        ],
        runtime: 121,
        status: 'Released',
        external_ids: { imdb_id: 'tt0076759' },
      }),
    );
    const client = createTmdbClient(config('abc123'), { fetch });

    const details = await client.getTitle('movie', 11);

    const call = calls[0];
    expect(call?.url.pathname).toBe('/3/movie/11');
    expect(call?.url.searchParams.get('append_to_response')).toBe('external_ids');
    expect(call?.url.searchParams.get('language')).toBe('ru-RU');

    expect(details).toMatchObject({
      id: 11,
      type: 'movie',
      title: 'Звёздные войны',
      originalTitle: 'Star Wars',
      year: 1977,
      posterPath: '/poster.jpg',
      backdropPath: '/backdrop.jpg',
      overview: 'Описание',
      runtime: 121,
      imdbId: 'tt0076759',
      status: 'Released',
      isAnimation: true,
      rating: 8.2,
    });
    expect(details.genres).toEqual([
      { id: 12, name: 'Приключения' },
      { id: 16, name: 'Анимация' },
    ]);
    expect(details.seasons).toBeUndefined();
  });

  it('маппит детали сериала: сезоны, episode_run_time, imdbId', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse({
        id: 1399,
        name: 'Игра престолов',
        original_name: 'Game of Thrones',
        first_air_date: '2011-04-17',
        poster_path: '/tv-poster.jpg',
        backdrop_path: '/tv-backdrop.jpg',
        overview: 'Сериал',
        vote_average: 8.438,
        genres: [{ id: 10765, name: 'Sci-Fi & Fantasy' }],
        episode_run_time: [60],
        status: 'Ended',
        seasons: [
          {
            season_number: 0,
            name: 'Specials',
            episode_count: 272,
            air_date: '2010-12-05',
          },
          {
            season_number: 1,
            name: 'Season 1',
            episode_count: 10,
            air_date: '',
          },
        ],
        external_ids: { imdb_id: 'tt0944947' },
      }),
    );
    const client = createTmdbClient(config('abc123'), { fetch });

    const details = await client.getTitle('tv', 1399);

    expect(calls[0]?.url.pathname).toBe('/3/tv/1399');
    expect(details).toMatchObject({
      id: 1399,
      type: 'tv',
      title: 'Игра престолов',
      originalTitle: 'Game of Thrones',
      year: 2011,
      runtime: 60,
      imdbId: 'tt0944947',
      status: 'Ended',
      isAnimation: false,
    });
    expect(details.seasons).toEqual([
      { seasonNumber: 0, name: 'Specials', episodeCount: 272, airDate: '2010-12-05' },
      { seasonNumber: 1, name: 'Season 1', episodeCount: 10, airDate: undefined },
    ]);
  });

  it('не задаёт runtime, если episode_run_time пуст', async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse({
        id: 1,
        name: 'Сериал',
        original_name: 'Series',
        episode_run_time: [],
        genres: [],
      }),
    );
    const client = createTmdbClient(config('abc123'), { fetch });

    const details = await client.getTitle('tv', 1);

    expect(details.runtime).toBeUndefined();
    expect(details.seasons).toBeUndefined();
    expect(details.genres).toEqual([]);
  });
});

describe('createTmdbClient: ошибки', () => {
  it('404 → TMDB_NOT_FOUND', async () => {
    const { fetch } = mockFetch(() => jsonResponse({ success: false }, 404));
    const client = createTmdbClient(config('abc123'), { fetch });

    await expect(client.getTitle('movie', 999999)).rejects.toMatchObject({
      code: 'TMDB_NOT_FOUND',
      status: 404,
    });
  });

  it('401 → TMDB_UNAUTHORIZED', async () => {
    const { fetch } = mockFetch(() => jsonResponse({ success: false }, 401));
    const client = createTmdbClient(config('abc123'), { fetch });

    await expect(client.searchMulti('star')).rejects.toMatchObject({
      code: 'TMDB_UNAUTHORIZED',
      status: 401,
    });
  });

  it('500 → TMDB_UNAVAILABLE', async () => {
    const { fetch } = mockFetch(() => jsonResponse({ success: false }, 500));
    const client = createTmdbClient(config('abc123'), { fetch });

    await expect(client.searchMulti('star')).rejects.toMatchObject({
      code: 'TMDB_UNAVAILABLE',
      status: 500,
    });
  });

  it('таймаут → TMDB_UNAVAILABLE', async () => {
    const { fetch } = mockFetch(() => {
      throw Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      });
    });
    const client = createTmdbClient(config('abc123'), { fetch });

    await expect(client.searchMulti('star')).rejects.toBeInstanceOf(TmdbError);
    await expect(client.searchMulti('star')).rejects.toMatchObject({
      code: 'TMDB_UNAVAILABLE',
    });
  });

  it('сетевая ошибка → TMDB_UNAVAILABLE', async () => {
    const { fetch } = mockFetch(() => {
      throw new TypeError('fetch failed');
    });
    const client = createTmdbClient(config('abc123'), { fetch });

    await expect(client.searchMulti('star')).rejects.toMatchObject({
      code: 'TMDB_UNAVAILABLE',
    });
  });
});
