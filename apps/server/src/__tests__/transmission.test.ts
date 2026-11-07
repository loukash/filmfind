import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TransmissionError,
  createTransmissionClient,
} from '../clients/transmission.js';
import { loadConfig } from '../config.js';

// --- Вспомогательный «фейковый Transmission» на случайном порту ------------

interface RequestRecord {
  path: string | undefined;
  sessionId: string | undefined;
  body: Record<string, unknown>;
}

interface CannedResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

interface TestServer {
  url: string;
  requests: RequestRecord[];
  close(): Promise<void>;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

async function startRpcServer(
  script: (request: RequestRecord, seen: RequestRecord[]) => CannedResponse,
): Promise<TestServer> {
  const requests: RequestRecord[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString('utf8');

      let body: unknown = {};
      try {
        body = JSON.parse(raw);
      } catch {
        // Пустое или не-JSON тело — тест сам решит, что с ним делать.
      }

      const record: RequestRecord = {
        path: req.url,
        sessionId: req.headers['x-transmission-session-id'] as string | undefined,
        body: (body ?? {}) as Record<string, unknown>,
      };
      requests.push(record);

      const canned = script(record, requests);
      res.writeHead(canned.status, canned.headers ?? { 'content-type': 'application/json' });
      res.end(typeof canned.body === 'string' ? canned.body : JSON.stringify(canned.body ?? {}));
    })().catch(() => {
      res.writeHead(500);
      res.end();
    });
  });

  await listen(server);
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}/transmission/rpc`,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function makeClient(url: string, extra: Record<string, string> = {}) {
  const cfg = loadConfig({ TRANSMISSION_URL: url, ...extra });
  return createTransmissionClient(cfg);
}

/** Стандартный скрипт: первый запрос — 409 с session id, дальше — успешный RPC. */
function handshakeScript(responses: Map<string, unknown>) {
  return (request: RequestRecord): CannedResponse => {
    if (request.sessionId === undefined) {
      return {
        status: 409,
        headers: {
          'x-transmission-session-id': 'sess-fixed',
          'content-type': 'application/json',
        },
      };
    }
    const method = typeof request.body.method === 'string' ? request.body.method : '';
    return {
      status: 200,
      body: { result: 'success', arguments: responses.get(method) ?? {} },
    };
  };
}

const openServers: TestServer[] = [];

beforeEach(() => {
  openServers.length = 0;
});

afterEach(async () => {
  await Promise.all(openServers.map((server) => server.close()));
});

async function track(server: TestServer): Promise<TestServer> {
  openServers.push(server);
  return server;
}

// --- Тесты -----------------------------------------------------------------

describe('createTransmissionClient — 409-хендшейк', () => {
  it('первый запрос 409, повтор с session id успешен; счётчик запросов = 2', async () => {
    const server = await track(
      await startRpcServer(
        handshakeScript(new Map([['session-get', { version: '3.00', 'download-dir': '/data' }]])),
      ),
    );

    const info = await makeClient(server.url, {
      TRANSMISSION_USER: 'user',
      TRANSMISSION_PASSWORD: 'pass',
    }).sessionGet();

    expect(info).toEqual({ version: '3.00', downloadDir: '/data' });
    expect(server.requests).toHaveLength(2);
    expect(server.requests[0]?.sessionId).toBeUndefined();
    expect(server.requests[1]?.sessionId).toBe('sess-fixed');
    expect(server.requests[1]?.body.method).toBe('session-get');
  });

  it('повторный вызов не делает лишний 409 — session id закэширован', async () => {
    const server = await track(await startRpcServer(handshakeScript(new Map())));

    const client = makeClient(server.url);
    await client.sessionGet();
    await client.getTorrents();
    await client.getTorrents();

    expect(server.requests).toHaveLength(4);
    expect(server.requests[0]?.sessionId).toBeUndefined();
    expect(server.requests.slice(1).map((request) => request.sessionId)).toEqual([
      'sess-fixed',
      'sess-fixed',
      'sess-fixed',
    ]);
  });

  it('два 409 подряд → TRANSMISSION_SESSION_FAILED, три попытки и стоп', async () => {
    const server = await track(
      await startRpcServer(() => ({
        status: 409,
        headers: { 'x-transmission-session-id': `sess-${Math.random()}` },
      })),
    );

    await expect(makeClient(server.url).sessionGet()).rejects.toMatchObject({
      name: 'TransmissionError',
      code: 'TRANSMISSION_SESSION_FAILED',
    });
    expect(server.requests).toHaveLength(3);
  });
});

describe('createTransmissionClient — torrent-add', () => {
  it('магнит уходит в filename, ответ torrent-added → added', async () => {
    const server = await track(
      await startRpcServer(
        handshakeScript(new Map([['torrent-add', { 'torrent-added': { id: 7, name: 'Фильм' } }]])),
      ),
    );

    const result = await makeClient(server.url).add({
      magnet: 'magnet:?xt=urn:btih:abc',
      downloadDir: '/downloads',
    });

    expect(result).toEqual({ result: 'added', id: 7, name: 'Фильм' });

    const addRequest = server.requests.at(-1);
    const args = addRequest?.body.arguments as Record<string, unknown> | undefined;
    expect(addRequest?.body.method).toBe('torrent-add');
    expect(args?.filename).toBe('magnet:?xt=urn:btih:abc');
    expect(args?.['download-dir']).toBe('/downloads');
    expect(Object.hasOwn(args ?? {}, 'metainfo')).toBe(false);
  });

  it('torrent-duplicate в ответе → result: duplicate', async () => {
    const server = await track(
      await startRpcServer(
        handshakeScript(
          new Map([['torrent-add', { 'torrent-duplicate': { id: 7, name: 'Фильм' } }]]),
        ),
      ),
    );

    const result = await makeClient(server.url).add({ magnet: 'magnet:?xt=urn:btih:abc' });

    expect(result).toEqual({ result: 'duplicate', id: 7, name: 'Фильм' });
  });

  it('ошибка RPC → TRANSMISSION_RPC_ERROR с текстом result', async () => {
    const server = await track(
      await startRpcServer(() => ({
        status: 200,
        body: { result: 'unrecognized info', arguments: {} },
      })),
    );

    await expect(
      makeClient(server.url).add({ magnet: 'magnet:?xt=urn:btih:abc' }),
    ).rejects.toMatchObject({
      code: 'TRANSMISSION_RPC_ERROR',
      message: expect.stringContaining('unrecognized info'),
    });
  });
});

describe('createTransmissionClient — torrent-get', () => {
  it('маппит ответ в TorrentDTO, включая eta=-1', async () => {
    const server = await track(
      await startRpcServer(
        handshakeScript(
          new Map([
            [
              'torrent-get',
              {
                torrents: [
                  {
                    id: 3,
                    name: 'Раздача',
                    percentDone: 0.5,
                    status: 4,
                    rateDownload: 1024,
                    rateUpload: 512,
                    eta: -1,
                    totalSize: 1_500_000,
                    downloadDir: '/data',
                  },
                ],
              },
            ],
          ]),
        ),
      ),
    );

    const torrents = await makeClient(server.url).getTorrents([3]);

    expect(torrents).toEqual([
      {
        id: 3,
        name: 'Раздача',
        percentDone: 0.5,
        status: 4,
        rateDownload: 1024,
        rateUpload: 512,
        eta: -1,
        totalSize: 1_500_000,
        downloadDir: '/data',
      },
    ]);

    const args = server.requests.at(-1)?.body.arguments as Record<string, unknown> | undefined;
    expect(args?.ids).toEqual([3]);
    expect(args?.fields).toEqual([
      'id',
      'name',
      'percentDone',
      'status',
      'rateDownload',
      'rateUpload',
      'eta',
      'totalSize',
      'downloadDir',
    ]);
  });
});

describe('createTransmissionClient — ошибки транспорта', () => {
  it('401 → TRANSMISSION_UNAUTHORIZED', async () => {
    const server = await track(
      await startRpcServer(() => ({
        status: 401,
        headers: { 'www-authenticate': 'Basic realm="Transmission"' },
      })),
    );

    await expect(
      makeClient(server.url, { TRANSMISSION_USER: 'u', TRANSMISSION_PASSWORD: 'p' }).sessionGet(),
    ).rejects.toMatchObject({ code: 'TRANSMISSION_UNAUTHORIZED' });
  });

  it('сетевая ошибка (порт не слушает) → TRANSMISSION_UNAVAILABLE', async () => {
    const server = await track(
      await startRpcServer(() => ({ status: 200, body: { result: 'success' } })),
    );
    const { url } = server;
    await server.close();

    await expect(makeClient(url).getTorrents()).rejects.toMatchObject({
      code: 'TRANSMISSION_UNAVAILABLE',
    });
  });

  it('URL не задан → TRANSMISSION_NOT_CONFIGURED', async () => {
    const client = createTransmissionClient(loadConfig({}));
    await expect(client.add({ magnet: 'magnet:?xt=urn:btih:abc' })).rejects.toMatchObject({
      code: 'TRANSMISSION_NOT_CONFIGURED',
    });
  });

  it('TransmissionError типизирован кодом', () => {
    const error = new TransmissionError('TRANSMISSION_RPC_ERROR', 'текст');
    expect(error.code).toBe('TRANSMISSION_RPC_ERROR');
    expect(error.name).toBe('TransmissionError');
  });
});
