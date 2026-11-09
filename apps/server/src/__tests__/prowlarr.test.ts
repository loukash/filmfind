import { parseRelease } from '@filmfind/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  ProwlarrError,
  createProwlarrClient,
  normalizeProwlarrRelease,
  releaseId,
  type ProwlarrReleaseResource,
} from '../clients/prowlarr.js';
import { loadConfig } from '../config.js';

const configured = loadConfig({
  PROWLARR_URL: 'http://prowlarr.local:9696/',
  PROWLARR_API_KEY: 'test-key',
}).prowlarr;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createFetch(handler: (url: URL) => Response) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    return handler(url);
  }) as unknown as typeof fetch;
}

describe('normalizeProwlarrRelease', () => {
  it('переносит все поля ответа и парсит качество', () => {
    const raw: ProwlarrReleaseResource = {
      guid: 'https://tracker/1',
      title: 'Фильм.2010.1080p.WEB-DL',
      size: 123456,
      seeders: 42,
      leechers: 7,
      indexer: 'ExampleTracker',
      indexerId: 3,
      publishDate: '2024-01-02T03:04:05Z',
      infoHash: 'ABCDEF0123',
      categories: [
        { id: 2000, name: 'Movies', subCategories: [{ id: 2040, name: 'HD' }] },
      ],
      downloadUrl: 'http://prowlarr.local/1/download?apikey=secret',
      magnetUrl: 'magnet:?xt=urn:btih:ABCDEF0123',
    };

    const release = normalizeProwlarrRelease(raw);

    expect(release).toMatchObject({
      title: 'Фильм.2010.1080p.WEB-DL',
      size: 123456,
      seeders: 42,
      leechers: 7,
      indexer: 'ExampleTracker',
      indexerId: 3,
      publishDate: '2024-01-02T03:04:05Z',
      infoHash: 'ABCDEF0123',
      guid: 'https://tracker/1',
    });
    expect(release.id).toBe('abcdef0123');
    expect(release.categories).toEqual([2000, 2040]);
    // Качество приходит из shared-парсера; проверяем, что поле заполнено им,
    // не фиксируя конкретную реализацию (parseRelease ещё развивается).
    expect(release.quality).toEqual(parseRelease(raw.title ?? ''));
    // Внутренние поля сохраняются для волны 2.
    expect(release.magnetUrl).toBe('magnet:?xt=urn:btih:ABCDEF0123');
    expect(release.downloadUrl).toContain('apikey=secret');
  });

  it('отсутствующие поля остаются undefined', () => {
    const release = normalizeProwlarrRelease({ title: 'Что-то', size: 10 });

    expect(release.seeders).toBeUndefined();
    expect(release.leechers).toBeUndefined();
    expect(release.indexer).toBeUndefined();
    expect(release.indexerId).toBeUndefined();
    expect(release.publishDate).toBeUndefined();
    expect(release.infoHash).toBeUndefined();
    expect(release.guid).toBeUndefined();
    expect(release.magnetUrl).toBeUndefined();
    expect(release.downloadUrl).toBeUndefined();
    expect(release.categories).toEqual([]);
  });
});

describe('releaseId', () => {
  it('стабилен между вызовами', () => {
    const raw = { guid: 'abc', title: 'Раздача', size: 100 };
    expect(releaseId(raw)).toBe(releaseId(raw));
  });

  it('различается для разных раздач', () => {
    expect(releaseId({ guid: 'a' })).not.toBe(releaseId({ guid: 'b' }));
    expect(releaseId({ title: 'A', size: 1 })).not.toBe(releaseId({ title: 'A', size: 2 }));
  });

  it('предпочитает infoHash, затем guid', () => {
    expect(releaseId({ infoHash: 'HASH', guid: 'g' })).toBe('hash');
    expect(releaseId({ guid: 'g' })).not.toBe(releaseId({ guid: 'g2' }));
  });
});

describe('createProwlarrClient.search', () => {
  it('передаёт параметры и нормализует ответ', async () => {
    const fetchImpl = createFetch(() =>
      jsonResponse([
        { guid: 'g1', title: 'Фильм 2010 1080p', size: 100, seeders: 5, indexerId: 1, indexer: 'A' },
      ]),
    );
    const client = createProwlarrClient(configured, { fetch: fetchImpl });

    const result = await client.search({
      query: 'Фильм',
      categories: [2000, 5070],
      indexerIds: [1, 2],
      type: 'moviesearch',
      limit: 25,
      offset: 10,
    });

    const url = new URL(vi.mocked(fetchImpl).mock.calls[0]![0]!.toString());
    expect(url.pathname).toBe('/api/v1/search');
    expect(url.searchParams.get('query')).toBe('Фильм');
    // moviesearch — наш алиас, в Prowlarr уходит документированный type=movie.
    expect(url.searchParams.get('type')).toBe('movie');
    expect(url.searchParams.getAll('categories')).toEqual(['2000', '5070']);
    expect(url.searchParams.getAll('indexerIds')).toEqual(['1', '2']);
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('offset')).toBe('10');

    const init = vi.mocked(fetchImpl).mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('test-key');

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toMatch(/^[0-9a-f]{40}$/);
    expect(result.items[0]?.indexer).toBe('A');
    expect(result.warnings).toEqual([]);
  });

  it('по умолчанию запрашивает 100 записей и type=search', async () => {
    const fetchImpl = createFetch(() => jsonResponse([]));
    const client = createProwlarrClient(configured, { fetch: fetchImpl });

    await client.search({ query: 'x' });

    const url = new URL(vi.mocked(fetchImpl).mock.calls[0]![0]!.toString());
    expect(url.searchParams.get('limit')).toBe('100');
    expect(url.searchParams.get('offset')).toBe('0');
    expect(url.searchParams.get('type')).toBe('search');
  });

  it('частичный сбой индексатора не теряет остальные результаты', async () => {
    const fetchImpl = createFetch(() =>
      jsonResponse([
        { guid: 'ok-1', title: 'Хорошая раздача', size: 10, indexerId: 1, indexer: 'Good' },
        { guid: null, title: null, indexerId: 2, indexer: 'Broken' },
        { guid: '', title: '', indexerId: 2, indexer: 'Broken' },
      ]),
    );
    const client = createProwlarrClient(configured, { fetch: fetchImpl });

    const result = await client.search({ query: 'x' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe('Хорошая раздача');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Broken');
  });

  it('401 → PROWLARR_UNAUTHORIZED', async () => {
    const fetchImpl = createFetch(() => new Response('unauthorized', { status: 401 }));
    const client = createProwlarrClient(configured, { fetch: fetchImpl });

    await expect(client.search({ query: 'x' })).rejects.toMatchObject({
      name: 'ProwlarrError',
      code: 'PROWLARR_UNAUTHORIZED',
    });
  });

  it('403 → PROWLARR_UNAUTHORIZED', async () => {
    const fetchImpl = createFetch(() => new Response('forbidden', { status: 403 }));
    const client = createProwlarrClient(configured, { fetch: fetchImpl });

    await expect(client.search({ query: 'x' })).rejects.toBeInstanceOf(ProwlarrError);
    await expect(client.search({ query: 'x' })).rejects.toMatchObject({
      code: 'PROWLARR_UNAUTHORIZED',
    });
  });

  it('не задан URL или ключ → PROWLARR_NOT_CONFIGURED', async () => {
    const client = createProwlarrClient(loadConfig({}).prowlarr, {
      fetch: createFetch(() => jsonResponse([])),
    });

    await expect(client.search({ query: 'x' })).rejects.toMatchObject({
      code: 'PROWLARR_NOT_CONFIGURED',
    });
  });

  it('сетевая ошибка → PROWLARR_UNAVAILABLE', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const client = createProwlarrClient(configured, { fetch: fetchImpl });

    await expect(client.search({ query: 'x' })).rejects.toMatchObject({
      code: 'PROWLARR_UNAVAILABLE',
    });
  });
});

describe('createProwlarrClient.getIndexers', () => {
  it('маппит список индексаторов', async () => {
    const fetchImpl = createFetch(() =>
      jsonResponse([
        { id: 1, name: 'ExampleTracker', enable: true, protocol: 'torrent' },
        { id: 2, name: 'NZBgeek', enable: false, protocol: 'usenet' },
        { name: 'без id' },
      ]),
    );
    const client = createProwlarrClient(configured, { fetch: fetchImpl });

    const indexers = await client.getIndexers();

    expect(indexers).toEqual([
      { id: 1, name: 'ExampleTracker', enable: true, protocol: 'torrent' },
      { id: 2, name: 'NZBgeek', enable: false, protocol: 'usenet' },
    ]);
  });
});
