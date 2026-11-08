import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransmissionClient } from '../clients/transmission.js';
import type { InternalRelease } from '../clients/prowlarr.js';
import { loadConfig } from '../config.js';
import { getReleaseById, rememberReleases } from '../lib/release-store.js';
import { transmissionRoutes } from '../routes/transmission.js';

// --- Вспомогательный «фейковый Transmission + Prowlarr» на одном порту ------

interface RequestRecord {
  path: string | undefined;
  sessionId: string | undefined;
  body: Buffer;
}

/** URL без query: сравнение путей идёт по pathname. */
function pathnameOf(path: string | undefined): string {
  return path?.split('?')[0] ?? '';
}

interface TestServer {
  origin: string;
  requests: RequestRecord[];
  close(): Promise<void>;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

/** Корректное начало bencode-словаря .torrent. */
const TORRENT_BYTES = Buffer.from([0x64, 0x38, 0x3a, 0x61, 0x6e, 0x6e, 0x6f, 0x75, 0x6e, 0x63, 0x65]);

interface CannedResponse {
  status: number;
  headers?: Record<string, string>;
  body: Buffer;
}

/** rpc — хендшейк + success; /download — отдаёт .torrent. */
function defaultScript(): (record: RequestRecord) => CannedResponse {
  return (record) => {
    if (pathnameOf(record.path) === '/download') {
      return {
        status: 200,
        headers: { 'content-type': 'application/x-bittorrent' },
        body: TORRENT_BYTES,
      };
    }
    if (record.sessionId === undefined) {
      return { status: 409, headers: { 'x-transmission-session-id': 'sess-fixed' }, body: Buffer.from('') };
    }

    const rpc = JSON.parse(record.body.toString('utf8')) as { method: string };
    const args =
      rpc.method === 'torrent-add' ? { 'torrent-added': { id: 42, name: 'Фильм' } } : {};
    const torrents =
      rpc.method === 'torrent-get'
        ? [
            {
              id: 1,
              name: 'Раздача',
              percentDone: 0.25,
              status: 4,
              rateDownload: 2048,
              rateUpload: 1024,
              eta: 600,
              totalSize: 4096,
              downloadDir: '/data',
            },
          ]
        : undefined;

    return {
      status: 200,
      body: Buffer.from(
        JSON.stringify(torrents ? { result: 'success', arguments: { torrents } } : { result: 'success', arguments: args }),
      ),
    };
  };
}

async function startServer(
  script: (record: RequestRecord) => CannedResponse = defaultScript(),
): Promise<TestServer> {
  const requests: RequestRecord[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const record: RequestRecord = {
        path: req.url,
        sessionId: req.headers['x-transmission-session-id'] as string | undefined,
        body: Buffer.concat(chunks),
      };
      requests.push(record);

      const canned = script(record);
      res.writeHead(canned.status, canned.headers ?? { 'content-type': 'application/json' });
      res.end(canned.body);
    })().catch(() => {
      res.writeHead(500);
      res.end();
    });
  });

  await listen(server);
  const address = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

// --- Сборка приложения -----------------------------------------------------

function makeRelease(partial: Partial<InternalRelease> & { id: string; title: string }): InternalRelease {
  return {
    size: 1000,
    categories: [2000],
    quality: {},
    ...partial,
  };
}

async function buildApp(options: {
  env: Record<string, string>;
  fetch?: typeof fetch;
  transmission?: TransmissionClient;
}) {
  const app = Fastify({ logger: false });
  const config = loadConfig(options.env);
  await app.register(transmissionRoutes, {
    config,
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    ...(options.transmission !== undefined ? { transmission: options.transmission } : {}),
  });
  await app.ready();
  return app;
}

const openServers: TestServer[] = [];

beforeEach(() => {
  openServers.length = 0;
});

afterEach(async () => {
  await Promise.all(openServers.map((server) => server.close()));
});

function trackServer(server: TestServer): TestServer {
  openServers.push(server);
  return server;
}

// --- Тесты -----------------------------------------------------------------

describe('POST /api/transmission/add', () => {
  it('releaseId из индекса с магнитом → в Transmission уходит магнит', async () => {
    const server = trackServer(await startServer());
    const magnet = 'magnet:?xt=urn:btih:abcdef0123456789';
    rememberReleases([
      makeRelease({
        id: 'route-magnet-1',
        title: 'Фильм 2010 1080p',
        magnetUrl: magnet,
        downloadUrl: `${server.origin}/download?apikey=test-key`,
      }),
    ]);

    const app = await buildApp({
      env: {
        TRANSMISSION_URL: `${server.origin}/transmission/rpc`,
        PROWLARR_URL: server.origin,
        TRANSMISSION_DOWNLOAD_DIR: '/data/downloads',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/transmission/add',
      payload: { releaseId: 'route-magnet-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ result: 'added', id: 42, name: 'Фильм' });

    const rpc = server.requests.filter((request) => pathnameOf(request.path) !== '/download').at(-1);
    expect(rpc).toBeDefined();
    const parsed = JSON.parse(rpc?.body.toString('utf8') ?? '{}') as {
      method: string;
      arguments: Record<string, unknown>;
    };
    expect(parsed.method).toBe('torrent-add');
    expect(parsed.arguments.filename).toBe(magnet);
    expect(parsed.arguments['download-dir']).toBe('/data/downloads');
    expect(Object.hasOwn(parsed.arguments, 'metainfo')).toBe(false);
  });

  it('каталог выбирается по типу тайтла, а не по клиенту', async () => {
    const server = trackServer(await startServer());
    rememberReleases(
      [
        makeRelease({
          id: 'route-dir-tv-1',
          title: 'Сериал S01',
          magnetUrl: 'magnet:?xt=urn:btih:dir-tv',
        }),
      ],
      { type: 'tv', isAnimation: true },
    );

    const app = await buildApp({
      env: {
        TRANSMISSION_URL: `${server.origin}/transmission/rpc`,
        PROWLARR_URL: server.origin,
        TRANSMISSION_DOWNLOAD_DIR: '/downloads/complete',
        TRANSMISSION_DOWNLOAD_DIR_MOVIE: '/downloads/complete/film',
        TRANSMISSION_DOWNLOAD_DIR_TV: '/downloads/complete/tv',
        TRANSMISSION_DOWNLOAD_DIR_ANIMATION: '/downloads/complete/mult',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/transmission/add',
      payload: { releaseId: 'route-dir-tv-1' },
    });

    expect(response.statusCode).toBe(200);

    const rpc = server.requests.filter((request) => pathnameOf(request.path) !== '/download').at(-1);
    const parsed = JSON.parse(rpc?.body.toString('utf8') ?? '{}') as {
      arguments: Record<string, unknown>;
    };
    // Аниме-сериал идёт в каталог сериалов: тип важнее жанра.
    expect(parsed.arguments['download-dir']).toBe('/downloads/complete/tv');
  });

  it('неизвестный releaseId → 404 RELEASE_NOT_FOUND, Transmission не трогается', async () => {
    const server = trackServer(await startServer());

    const app = await buildApp({
      env: {
        TRANSMISSION_URL: `${server.origin}/transmission/rpc`,
        PROWLARR_URL: server.origin,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/transmission/add',
      payload: { releaseId: 'totally-unknown-id' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('RELEASE_NOT_FOUND');
    expect(server.requests).toHaveLength(0);
  });

  it('releaseId без магнита, но с downloadUrl → metainfo в base64', async () => {
    const server = trackServer(await startServer());
    rememberReleases([
      makeRelease({
        id: 'route-file-1',
        title: 'Сериал S01',
        downloadUrl: `${server.origin}/download?apikey=test-key`,
      }),
    ]);

    const app = await buildApp({
      env: {
        TRANSMISSION_URL: `${server.origin}/transmission/rpc`,
        PROWLARR_URL: server.origin,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/transmission/add',
      payload: { releaseId: 'route-file-1' },
    });

    expect(response.statusCode).toBe(200);
    const rpc = server.requests.filter((request) => pathnameOf(request.path) !== '/download').at(-1);
    const parsed = JSON.parse(rpc?.body.toString('utf8') ?? '{}') as {
      arguments: Record<string, unknown>;
    };
    expect(Buffer.from(String(parsed.arguments.metainfo), 'base64')).toEqual(TORRENT_BYTES);
  });

  it('downloadUrl с origin Prowlarr → .torrent уходит base64 в metainfo, декодируется в исходные байты', async () => {
    const server = trackServer(await startServer());

    const app = await buildApp({
      env: {
        TRANSMISSION_URL: `${server.origin}/transmission/rpc`,
        PROWLARR_URL: server.origin,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/transmission/add',
      payload: { downloadUrl: `${server.origin}/download?apikey=test-key` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result).toBe('added');
    // Скачивание уходит на тот же фейковый сервер отдельным запросом.
    expect(server.requests.some((request) => pathnameOf(request.path) === '/download')).toBe(true);

    const rpc = server.requests.filter((request) => pathnameOf(request.path) !== '/download').at(-1);
    const parsed = JSON.parse(rpc?.body.toString('utf8') ?? '{}') as {
      method: string;
      arguments: Record<string, unknown>;
    };
    expect(parsed.method).toBe('torrent-add');
    expect(Buffer.from(String(parsed.arguments.metainfo), 'base64')).toEqual(TORRENT_BYTES);
  });

  it('чужой origin у downloadUrl → 400 UNSAFE_URL, запрос не уходит', async () => {
    const server = trackServer(await startServer());

    const fetchSpy = vi.fn(async () => {
      throw new Error('fetch не должен вызываться');
    });
    const app = await buildApp({
      env: {
        TRANSMISSION_URL: `${server.origin}/transmission/rpc`,
        PROWLARR_URL: 'http://prowlarr.local:9696',
      },
      fetch: fetchSpy as unknown as typeof fetch,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/transmission/add',
      payload: { downloadUrl: 'http://evil.example/x.torrent?apikey=leak' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('UNSAFE_URL');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(server.requests).toHaveLength(0);
  });

  it('magnet из тела запроса уходит как filename', async () => {
    const server = trackServer(await startServer());

    const app = await buildApp({
      env: {
        TRANSMISSION_URL: `${server.origin}/transmission/rpc`,
        PROWLARR_URL: server.origin,
      },
    });

    const magnet = 'magnet:?xt=urn:btih:1234567890abcdef';
    const response = await app.inject({
      method: 'POST',
      url: '/api/transmission/add',
      payload: { magnet },
    });

    expect(response.statusCode).toBe(200);
    const rpc = server.requests.filter((request) => pathnameOf(request.path) !== '/download').at(-1);
    const parsed = JSON.parse(rpc?.body.toString('utf8') ?? '{}') as {
      arguments: Record<string, unknown>;
    };
    expect(parsed.arguments.filename).toBe(magnet);
  });

  it('невалидное тело → 400 BAD_REQUEST, Transmission не трогается', async () => {
    const server = trackServer(await startServer());

    const app = await buildApp({
      env: {
        TRANSMISSION_URL: `${server.origin}/transmission/rpc`,
        PROWLARR_URL: server.origin,
      },
    });

    const empty = await app.inject({ method: 'POST', url: '/api/transmission/add', payload: {} });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().code).toBe('BAD_REQUEST');

    const both = await app.inject({
      method: 'POST',
      url: '/api/transmission/add',
      payload: { releaseId: 'a', magnet: 'magnet:?xt=urn:btih:abc' },
    });
    expect(both.statusCode).toBe(400);

    const wrongMagnet = await app.inject({
      method: 'POST',
      url: '/api/transmission/add',
      payload: { magnet: 'http://not-a-magnet.example' },
    });
    expect(wrongMagnet.statusCode).toBe(400);

    const wrongUrl = await app.inject({
      method: 'POST',
      url: '/api/transmission/add',
      payload: { downloadUrl: 'ftp://prowlarr.local/x.torrent' },
    });
    expect(wrongUrl.statusCode).toBe(400);
    expect(wrongUrl.json().code).toBe('BAD_REQUEST');

    expect(server.requests).toHaveLength(0);
  });

  it('TRANSMISSION_URL не задан → 503 TRANSMISSION_NOT_CONFIGURED', async () => {
    const app = await buildApp({ env: {} });

    const response = await app.inject({
      method: 'POST',
      url: '/api/transmission/add',
      payload: { magnet: 'magnet:?xt=urn:btih:abc' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('TRANSMISSION_NOT_CONFIGURED');
  });

  it('401 от Transmission → 502 TRANSMISSION_UNAUTHORIZED', async () => {
    const server = trackServer(
      await startServer(() => ({
        status: 401,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(''),
      })),
    );

    const app = await buildApp({
      env: {
        TRANSMISSION_URL: `${server.origin}/transmission/rpc`,
        PROWLARR_URL: server.origin,
        TRANSMISSION_USER: 'u',
        TRANSMISSION_PASSWORD: 'p',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/transmission/add',
      payload: { magnet: 'magnet:?xt=urn:btih:abc' },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().code).toBe('TRANSMISSION_UNAUTHORIZED');
  });
});

describe('GET /api/transmission/torrents', () => {
  it('отдаёт список TorrentDTO (включая eta)', async () => {
    const server = trackServer(await startServer());

    const app = await buildApp({
      env: {
        TRANSMISSION_URL: `${server.origin}/transmission/rpc`,
        PROWLARR_URL: server.origin,
      },
    });

    const response = await app.inject({ method: 'GET', url: '/api/transmission/torrents' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          id: 1,
          name: 'Раздача',
          percentDone: 0.25,
          status: 4,
          rateDownload: 2048,
          rateUpload: 1024,
          eta: 600,
          totalSize: 4096,
          downloadDir: '/data',
        },
      ],
    });
  });

  it('Transmission недоступен → 502 TRANSMISSION_UNAVAILABLE', async () => {
    const server = trackServer(
      await startServer(() => ({
        status: 500,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(''),
      })),
    );

    const app = await buildApp({
      env: {
        TRANSMISSION_URL: `${server.origin}/transmission/rpc`,
        PROWLARR_URL: server.origin,
      },
    });

    const response = await app.inject({ method: 'GET', url: '/api/transmission/torrents' });

    expect(response.statusCode).toBe(502);
    expect(response.json().code).toBe('TRANSMISSION_UNAVAILABLE');
  });
});

// --- release-store (индекс раздач) ------------------------------------------

describe('release-store', () => {
  it('rememberReleases / getReleaseById', () => {
    const release = makeRelease({ id: 'store-id-1', title: 'Фильм' });
    rememberReleases([release]);
    expect(getReleaseById('store-id-1')).toEqual(release);
    expect(getReleaseById('missing')).toBeUndefined();
  });

  it('LRU на 2000 записей: самая старая вытесняется', () => {
    const overflow: InternalRelease[] = [];
    for (let i = 0; i < 2001; i += 1) {
      overflow.push(makeRelease({ id: `store-evict-${i}`, title: `#${i}` }));
    }
    rememberReleases(overflow);

    expect(getReleaseById('store-evict-0')).toBeUndefined();
    expect(getReleaseById('store-evict-2000')).toBeDefined();
  });

  it('TTL 30 минут: запись истекает', () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    try {
      rememberReleases([makeRelease({ id: 'store-ttl-1', title: 'Фильм' })]);
      expect(getReleaseById('store-ttl-1')).toBeDefined();
      vi.advanceTimersByTime(30 * 60 * 1000 + 1);
      expect(getReleaseById('store-ttl-1')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
