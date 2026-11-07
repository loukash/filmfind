import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { imgRoutes } from '../routes/img.js';

interface FetchCall {
  url: string;
}

function mockFetch(handler: (url: URL) => Response | Promise<Response>): {
  fetch: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const raw = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
    calls.push({ url: raw });
    return handler(new URL(raw));
  };
  return { fetch: fetchImpl as unknown as typeof fetch, calls };
}

function imageResponse(
  bytes: Buffer,
  contentType = 'image/jpeg',
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(bytes, {
    status: init.status ?? 200,
    headers: {
      'content-type': contentType,
      'content-length': String(bytes.byteLength),
      ...init.headers,
    },
  });
}

async function createApp(fetchImpl: typeof fetch): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(imgRoutes, { fetch: fetchImpl });
  await app.ready();
  return app;
}

const IMAGE_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

describe('GET /api/img/:size/:file', () => {
  it('отдаёт изображение с image.tmdb.org и нужными заголовками', async () => {
    const { fetch, calls } = mockFetch(() => imageResponse(IMAGE_BYTES));
    const app = await createApp(fetch);

    try {
      const response = await app.inject({ method: 'GET', url: '/api/img/w500/AbC123.jpg' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('image/jpeg');
      expect(response.headers['cache-control']).toBe('public, max-age=86400, immutable');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.from(response.rawPayload).equals(IMAGE_BYTES)).toBe(true);
      expect(calls).toEqual([{ url: 'https://image.tmdb.org/t/p/w500/AbC123.jpg' }]);
    } finally {
      await app.close();
    }
  });

  it.each([
    ['w92', '/api/img/w92/abc_DEF-123.webp'],
    ['original', '/api/img/original/poster.png'],
  ])('принимает валидный размер %s', async (_size, url) => {
    const { fetch } = mockFetch(() => imageResponse(IMAGE_BYTES, 'image/png'));
    const app = await createApp(fetch);

    try {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it.each([
    ['неизвестный размер', '/api/img/w999/AbC123.jpg'],
    ['нет расширения', '/api/img/w500/AbC123'],
    ['недопустимое расширение', '/api/img/w500/poster.svg'],
    ['недопустимые символы', '/api/img/w500/poster%20file.jpg'],
    ['path traversal с ../', '/api/img/w500/..%2F..%2Fetc%2Fpasswd'],
    ['path traversal с encoded dots', '/api/img/w500/%2e%2e%2fsecret.jpg'],
    ['вложенный путь', '/api/img/w500/sub%2Fposter.jpg'],
  ])('400 BAD_REQUEST: %s', async (_name, url) => {
    const { fetch, calls } = mockFetch(() => imageResponse(IMAGE_BYTES));
    const app = await createApp(fetch);

    try {
      const response = await app.inject({ method: 'GET', url });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'BAD_REQUEST' });
      expect(calls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('502 IMG_UPSTREAM_ERROR при не-2xx ответе TMDB', async () => {
    const { fetch } = mockFetch(() => new Response('not found', { status: 404 }));
    const app = await createApp(fetch);

    try {
      const response = await app.inject({ method: 'GET', url: '/api/img/w500/missing.jpg' });

      expect(response.statusCode).toBe(502);
      expect(response.json()).toMatchObject({ code: 'IMG_UPSTREAM_ERROR' });
    } finally {
      await app.close();
    }
  });

  it('502, если upstream вернул HTML вместо изображения', async () => {
    const { fetch } = mockFetch(() =>
      new Response('<html>error</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const app = await createApp(fetch);

    try {
      const response = await app.inject({ method: 'GET', url: '/api/img/w500/fake.jpg' });

      expect(response.statusCode).toBe(502);
      expect(response.json()).toMatchObject({ code: 'IMG_UPSTREAM_ERROR' });
    } finally {
      await app.close();
    }
  });

  it('502, если сетевая ошибка или таймаут', async () => {
    const { fetch } = mockFetch(() => {
      throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    });
    const app = await createApp(fetch);

    try {
      const response = await app.inject({ method: 'GET', url: '/api/img/w500/AbC123.jpg' });

      expect(response.statusCode).toBe(502);
      expect(response.json()).toMatchObject({ code: 'IMG_UPSTREAM_ERROR' });
    } finally {
      await app.close();
    }
  });

  it('502, если изображение больше лимита', async () => {
    const { fetch } = mockFetch(() =>
      imageResponse(Buffer.from('small'), 'image/jpeg', {
        headers: { 'content-length': String(6 * 1024 * 1024) },
      }),
    );
    const app = await createApp(fetch);

    try {
      const response = await app.inject({ method: 'GET', url: '/api/img/w780/huge.jpg' });

      expect(response.statusCode).toBe(502);
      expect(response.json()).toMatchObject({ code: 'IMG_UPSTREAM_ERROR' });
    } finally {
      await app.close();
    }
  });

  it('кэширует байты: повторный запрос не ходит в сеть', async () => {
    const { fetch, calls } = mockFetch(() => imageResponse(IMAGE_BYTES));
    const app = await createApp(fetch);

    try {
      const first = await app.inject({ method: 'GET', url: '/api/img/w342/AbC123.jpg' });
      const second = await app.inject({ method: 'GET', url: '/api/img/w342/AbC123.jpg' });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(Buffer.from(second.rawPayload).equals(IMAGE_BYTES)).toBe(true);
      expect(calls).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});
