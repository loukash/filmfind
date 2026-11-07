import type { TitleDetailsDTO, TitleType } from '@filmfind/shared';
import { describe, expect, it, vi } from 'vitest';
import type {
  InternalRelease,
  ProwlarrClient,
  ProwlarrSearchParams,
} from '../clients/prowlarr.js';
import type { TmdbClient } from '../clients/tmdb.js';
import { LruCache } from '../lib/lru.js';
import {
  createReleasesService,
  dedupeReleases,
  filterReleases,
  matchesSeason,
  matchesYear,
  sortReleases,
  type ReleasesResult,
} from '../lib/releases.js';

function makeRelease(
  partial: Partial<InternalRelease> & { title: string },
): InternalRelease {
  return {
    id: partial.id ?? partial.title,
    size: 1000,
    categories: [2000],
    quality: {},
    ...partial,
  };
}

function makeProwlarr(
  handler: (params: ProwlarrSearchParams) => {
    items: InternalRelease[];
    warnings?: string[];
  },
) {
  const search = vi.fn(async (params: ProwlarrSearchParams) => {
    const result = handler(params);
    return { items: result.items, warnings: result.warnings ?? [] };
  });
  const client: ProwlarrClient = {
    search,
    getIndexers: vi.fn(async () => []),
  };
  return { client, search };
}

function makeTmdb(details: Partial<TitleDetailsDTO> = {}): TmdbClient {
  return {
    searchMulti: vi.fn(async () => ({ page: 1, totalPages: 0, totalResults: 0, items: [] })),
    getTitle: vi.fn(async (type: TitleType, id: number) => ({
      id,
      type,
      title: 'Сериал',
      originalTitle: 'The Show',
      year: 2010,
      isAnimation: false,
      genres: [],
      ...details,
    })),
  };
}

describe('dedupeReleases', () => {
  it('дедуплицирует по infoHash и оставляет запись с большими сидами', () => {
    const weak = makeRelease({ title: 'Раздача A', infoHash: 'ABCDEF', seeders: 3 });
    const strong = makeRelease({ title: 'Раздача A (копия)', infoHash: 'abcdef', seeders: 30 });

    const result = dedupeReleases([weak, strong]);

    expect(result).toHaveLength(1);
    expect(result[0]?.seeders).toBe(30);
  });

  it('дедуплицирует по нормализованному названию и размеру', () => {
    const a = makeRelease({ title: 'Фильм.2010.1080p', size: 500, seeders: 1 });
    const b = makeRelease({ title: 'фильм 2010 1080p', size: 500, seeders: 7 });

    const result = dedupeReleases([a, b]);

    expect(result).toHaveLength(1);
    expect(result[0]?.seeders).toBe(7);
  });

  it('не склеивает раздачи с разным размером', () => {
    const a = makeRelease({ title: 'Фильм 2010', size: 500 });
    const b = makeRelease({ title: 'Фильм 2010', size: 900 });

    expect(dedupeReleases([a, b])).toHaveLength(2);
  });

  it('при равных сидах оставляет более позднюю по дате', () => {
    const older = makeRelease({
      title: 'Фильм',
      infoHash: 'h',
      seeders: 5,
      publishDate: '2024-01-01T00:00:00Z',
    });
    const newer = makeRelease({
      title: 'Фильм',
      infoHash: 'h',
      seeders: 5,
      publishDate: '2024-06-01T00:00:00Z',
    });

    expect(dedupeReleases([older, newer])[0]?.publishDate).toBe('2024-06-01T00:00:00Z');
  });
});

describe('фильтрация шума', () => {
  it('допускает год в пределах ±1', () => {
    expect(matchesYear('Фильм 2010 1080p', 2010)).toBe(true);
    expect(matchesYear('Фильм 2011 1080p', 2010)).toBe(true);
    expect(matchesYear('Фильм 2009 1080p', 2010)).toBe(true);
    expect(matchesYear('Фильм 2012 1080p', 2010)).toBe(false);
    expect(matchesYear('Фильм 1080p', 2010)).toBe(true);
  });

  it('не путает год с числом в названии', () => {
    // «1917» — часть названия, а не год; настоящий год 2019 в названии есть.
    expect(matchesYear('1917.2019.1080p', 2019)).toBe(true);
  });

  it('отбрасывает фильмы с чужим годом', () => {
    const releases = [
      makeRelease({ title: 'Фильм 2010' }),
      makeRelease({ title: 'Фильм 2015' }),
    ];

    const result = filterReleases(releases, { type: 'movie' }, { year: 2010 });

    expect(result.map((release) => release.title)).toEqual(['Фильм 2010']);
  });

  it('отбрасывает сериалы с другим сезоном', () => {
    expect(matchesSeason('Сериал S02 1080p', 1)).toBe(false);
    expect(matchesSeason('Сериал S01 1080p', 1)).toBe(true);
    expect(matchesSeason('Сериал 2 сезон', 2)).toBe(true);
    expect(matchesSeason('Сериал / Season 3', 3)).toBe(true);
    // Сезон не указан — оставляем, не все трекеры его пишут.
    expect(matchesSeason('Сериал 1080p', 1)).toBe(true);
  });

  it('учитывает сезон из parseRelease', () => {
    expect(matchesSeason('Сериал', 2, 2)).toBe(true);
    expect(matchesSeason('Сериал', 2, 1)).toBe(false);
  });
});

describe('sortReleases', () => {
  it('сортирует по сидам, затем по разрешению, затем по размеру', () => {
    const low = makeRelease({
      title: 'Фильм 1080p',
      seeders: 1,
      quality: { resolution: '1080p' },
      size: 10_000,
    });
    const high = makeRelease({
      title: 'Фильм 720p',
      seeders: 100,
      quality: { resolution: '720p' },
      size: 1000,
    });
    const sameSeedersFhd = makeRelease({
      title: 'Фильм 1080p',
      seeders: 1,
      quality: { resolution: '1080p' },
      size: 1000,
    });
    const sameSeedersUhd = makeRelease({
      title: 'Фильм 2160p',
      seeders: 1,
      quality: { resolution: '2160p' },
      size: 500,
    });

    const result = sortReleases([low, high, sameSeedersFhd, sameSeedersUhd]);

    expect(result.map((release) => release.title)).toEqual([
      'Фильм 720p',
      'Фильм 2160p',
      'Фильм 1080p',
      'Фильм 1080p',
    ]);
    expect(result[2]?.size).toBe(10_000);
  });
});

describe('createReleasesService', () => {
  it('строит варианты запросов для сериала и ищет их параллельно', async () => {
    const { client, search } = makeProwlarr(() => ({ items: [] }));
    const service = createReleasesService({ tmdb: makeTmdb(), prowlarr: client });

    await service.find({ type: 'tv', titleId: 1, season: 2 });

    const queries = search.mock.calls.map(([params]) => params.query);
    expect(queries).toEqual(['Сериал', 'The Show', 'Сериал S02', 'Сериал 2 сезон']);
    expect(search.mock.calls.every(([params]) => params.type === 'search')).toBe(true);
    expect(search.mock.calls[0]?.[0]?.categories).toEqual([5000]);
  });

  it('добавляет аниме-категорию к категории типа', async () => {
    const { client, search } = makeProwlarr(() => ({ items: [] }));
    const service = createReleasesService({
      tmdb: makeTmdb({ isAnimation: true }),
      prowlarr: client,
    });

    await service.find({ type: 'tv', titleId: 1, season: 1 });

    expect(search.mock.calls[0]?.[0]?.categories).toEqual([5000, 5070]);
  });

  it('для фильма добавляет вариант с годом', async () => {
    const { client, search } = makeProwlarr(() => ({ items: [] }));
    const service = createReleasesService({
      tmdb: makeTmdb({ title: 'Фильм', originalTitle: 'Movie', year: 2010 }),
      prowlarr: client,
    });

    await service.find({ type: 'movie', titleId: 1 });

    expect(search.mock.calls.map(([params]) => params.query)).toEqual([
      'Фильм',
      'Movie',
      'Фильм 2010',
    ]);
    expect(search.mock.calls[0]?.[0]?.categories).toEqual([2000]);
  });

  it('не обращается к TMDB при свободном запросе', async () => {
    const tmdb = makeTmdb();
    const { client, search } = makeProwlarr(() => ({ items: [] }));
    const service = createReleasesService({ tmdb, prowlarr: client });

    await service.find({ type: 'movie', q: 'матрица' });

    expect(tmdb.getTitle).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]?.[0]?.query).toBe('матрица');
  });

  it('дедуплицирует, фильтрует, сортирует и не отдаёт magnet наружу', async () => {
    const items = [
      makeRelease({
        title: 'Фильм.2015.1080p',
        infoHash: 'old',
        seeders: 50,
        magnetUrl: 'magnet:?xt=old',
      }),
      makeRelease({
        title: 'Фильм 2010 720p',
        infoHash: 'good',
        seeders: 10,
        magnetUrl: 'magnet:?xt=good',
        downloadUrl: 'http://prowlarr/download?apikey=secret',
      }),
      makeRelease({ title: 'Фильм 2010 1080p', infoHash: 'dup', seeders: 1 }),
      makeRelease({ title: 'Фильм 2010 1080p', infoHash: 'dup', seeders: 99 }),
    ];
    const { client } = makeProwlarr(() => ({ items, warnings: ['Индексатор X: сбой'] }));
    const service = createReleasesService({
      tmdb: makeTmdb({ title: 'Фильм', originalTitle: 'Фильм', year: 2010 }),
      prowlarr: client,
    });

    const result = await service.find({ type: 'movie', titleId: 1, limit: 10 });

    expect(result.items.map((release) => release.infoHash)).toEqual(['dup', 'good']);
    expect(result.warnings).toContain('Индексатор X: сбой');

    // Публичный DTO не содержит внутренних ссылок.
    for (const item of result.items) {
      expect(item).not.toHaveProperty('magnetUrl');
      expect(item).not.toHaveProperty('downloadUrl');
    }
    expect(JSON.stringify(result.items)).not.toContain('apikey=secret');

    // Внутренний список нужен волне 2 и магнит сохраняет.
    const withMagnet = result.internal.find((release) => release.infoHash === 'good');
    expect(withMagnet?.magnetUrl).toBe('magnet:?xt=good');
  });

  it('кэширует результат на 3 минуты по ключу запроса', async () => {
    const { client, search } = makeProwlarr(() => ({ items: [] }));
    const service = createReleasesService({ tmdb: makeTmdb(), prowlarr: client });

    // Сезон 1: «Сериал», «The Show», «Сериал S01», «Сериал 1 сезон».
    await service.find({ type: 'tv', titleId: 1, season: 1 });
    expect(search).toHaveBeenCalledTimes(4);
    await service.find({ type: 'tv', titleId: 1, season: 1 });
    expect(search).toHaveBeenCalledTimes(4); // второй раз — из кэша

    await service.find({ type: 'tv', titleId: 1, season: 2 });
    expect(search).toHaveBeenCalledTimes(8);
  });

  it('использует переданный кэш', async () => {
    const cache = new LruCache<string, ReleasesResult>({ max: 10, ttlMs: 60_000 });
    const { client, search } = makeProwlarr(() => ({ items: [] }));
    const service = createReleasesService({ tmdb: makeTmdb(), prowlarr: client, cache });

    await service.find({ type: 'tv', titleId: 1, season: 1 });
    await service.find({ type: 'tv', titleId: 1, season: 1 });

    expect(search).toHaveBeenCalledTimes(4);
    expect(cache.size).toBe(1);
  });

  it('частичный сбой варианта не роняет поиск', async () => {
    const search = vi.fn(async (params: ProwlarrSearchParams) => {
      if (params.query === 'The Show') throw new Error('таймаут');
      return { items: [makeRelease({ title: 'Сериал S01 1080p' })], warnings: [] };
    });
    const client: ProwlarrClient = { search, getIndexers: vi.fn(async () => []) };
    const service = createReleasesService({ tmdb: makeTmdb(), prowlarr: client });

    const result = await service.find({ type: 'tv', titleId: 1, season: 1 });

    expect(result.items).toHaveLength(1);
    expect(result.warnings.join(' ')).toContain('The Show');
  });

  it('если упали все варианты — пробрасывает ошибку', async () => {
    const client: ProwlarrClient = {
      search: vi.fn(async () => {
        throw new Error('Prowlarr недоступен');
      }),
      getIndexers: vi.fn(async () => []),
    };
    const service = createReleasesService({ tmdb: makeTmdb(), prowlarr: client });

    await expect(service.find({ type: 'tv', titleId: 1 })).rejects.toThrow('Prowlarr недоступен');
  });

  it('без q и titleId бросает BAD_REQUEST', async () => {
    const { client } = makeProwlarr(() => ({ items: [] }));
    const service = createReleasesService({ tmdb: makeTmdb(), prowlarr: client });

    await expect(service.find({ type: 'movie' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
