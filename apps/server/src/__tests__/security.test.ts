import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { buildBaseApp } from '../app.js';
import { loadConfig } from '../config.js';
import { safeTokenEquals } from '../lib/auth.js';
import { registerRateLimit } from '../lib/rate-limit.js';

interface CreateAppOptions {
  token?: string;
  rateNow?: () => number;
}

/**
 * Приложение с security-хуками (как в buildApp) и заглушками роутов вместо
 * реальных клиентов: тесты не должны ходить в сеть. Каждый тест создаёт своё
 * приложение, поэтому состояние rate limit между тестами не пересекается.
 */
async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const config = loadConfig(options.token ? { APP_ACCESS_TOKEN: options.token } : {});
  const app = await buildBaseApp(config, {
    rateLimit: options.rateNow ? { now: options.rateNow } : {},
  });
  app.log.level = 'silent';

  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/titles/search', async () => ({ ok: true }));
  app.get('/api/releases', async () => ({ items: [] }));
  app.post('/api/transmission/add', async () => ({ ok: true }));
  app.get('/api/other', async () => ({ ok: true }));
  // Иконка кэша, который роут img ставит сам: onSend-хуки не должны перетирать.
  app.get('/api/img/poster.jpg', async (_request, reply) => {
    void reply.header('Cache-Control', 'public, max-age=86400, immutable');
    return { ok: true };
  });
  app.get('/some-page', async () => ({ page: true }));

  await app.ready();
  return app;
}

const afterAlls: Array<() => Promise<void>> = [];
function trackClose(app: FastifyInstance): FastifyInstance {
  afterAlls.push(() => app.close());
  return app;
}

afterAll(async () => {
  for (const close of afterAlls.splice(0)) await close();
});

describe('safeTokenEquals', () => {
  it('совпадающие токены равны, разные — нет', () => {
    expect(safeTokenEquals('correct-token', 'correct-token')).toBe(true);
    expect(safeTokenEquals('wrong-token', 'correct-token')).toBe(false);
  });

  it('разная длина — false и без Exceptions от timingSafeEqual', () => {
    expect(safeTokenEquals('short', 'a-much-longer-token')).toBe(false);
  });
});

describe('авторизация по APP_ACCESS_TOKEN', () => {
  it('без токена в конфиге запросы /api/* проходят открыто', async () => {
    const app = trackClose(await createApp());

    const response = await app.inject({ method: 'GET', url: '/api/other' });
    expect(response.statusCode).toBe(200);
  });

  it('с токеном: нет заголовка Authorization → 401, тело и WWW-Authenticate', async () => {
    const app = trackClose(await createApp({ token: 'secret-token' }));

    const response = await app.inject({ method: 'GET', url: '/api/other' });
    expect(response.statusCode).toBe(401);
    expect(response.body).toBe(
      JSON.stringify({ code: 'UNAUTHORIZED', message: 'Требуется токен доступа' }),
    );
    expect(response.headers['www-authenticate']).toBe('Bearer');
  });

  it('неверный токен → 401', async () => {
    const app = trackClose(await createApp({ token: 'secret-token' }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/other',
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
  });

  it('токен другой длины (короче/длиннее) → 401, без исключений', async () => {
    const app = trackClose(await createApp({ token: 'secret-token' }));

    for (const candidate of ['abc', 'secret-token-extra-long-value']) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/other',
        headers: { authorization: `Bearer ${candidate}` },
      });
      expect(response.statusCode).toBe(401);
    }
  });

  it('верный токен → 200', async () => {
    const app = trackClose(await createApp({ token: 'secret-token' }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/other',
      headers: { authorization: 'Bearer secret-token' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('не-Bearer схема (Basic) → 401', async () => {
    const app = trackClose(await createApp({ token: 'secret-token' }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/other',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('/api/health остаётся публичным даже с токеном', async () => {
    const app = trackClose(await createApp({ token: 'secret-token' }));

    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['www-authenticate']).toBeUndefined();
  });

  it('не-/api пути не требуют токена (SPA-оболочка)', async () => {
    const app = trackClose(await createApp({ token: 'secret-token' }));

    const response = await app.inject({ method: 'GET', url: '/some-page' });
    expect(response.statusCode).toBe(200);
  });
});

describe('rate limit', () => {
  it('61-й запрос к /api/releases за минуту → 429 с Retry-After', async () => {
    const app = trackClose(await createApp({ token: 'secret-token' }));

    const firstRequests = await Promise.all(
      Array.from({ length: 60 }, () =>
        app.inject({
          method: 'GET',
          url: '/api/releases?type=movie&q=x',
          headers: { authorization: 'Bearer secret-token' },
          remoteAddress: '10.0.0.1',
        }),
      ),
    );
    expect(firstRequests.every((response) => response.statusCode === 200)).toBe(true);

    const overflow = await app.inject({
      method: 'GET',
      url: '/api/releases?type=movie&q=x',
      headers: { authorization: 'Bearer secret-token' },
      remoteAddress: '10.0.0.1',
    });
    expect(overflow.statusCode).toBe(429);
    expect(overflow.body).toBe(
      JSON.stringify({ code: 'RATE_LIMITED', message: 'Слишком много запросов, попробуйте позже' }),
    );
    const retryAfter = Number(overflow.headers['retry-after']);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(overflow.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('другой IP не задет лимитом первого', async () => {
    const app = trackClose(await createApp({ token: 'secret-token' }));

    await Promise.all(
      Array.from({ length: 60 }, () =>
        app.inject({
          method: 'GET',
          url: '/api/releases?type=movie&q=x',
          headers: { authorization: 'Bearer secret-token' },
          remoteAddress: '10.0.0.1',
        }),
      ),
    );

    const otherIp = await app.inject({
      method: 'GET',
      url: '/api/releases?type=movie&q=x',
      headers: { authorization: 'Bearer secret-token' },
      remoteAddress: '10.0.0.2',
    });
    expect(otherIp.statusCode).toBe(200);
  });

  it('/api/transmission/add — лимит 20/мин', async () => {
    const app = trackClose(await createApp({ token: 'secret-token' }));

    const requests = await Promise.all(
      Array.from({ length: 21 }, (_value, index) =>
        app.inject({
          method: 'POST',
          url: '/api/transmission/add',
          headers: { authorization: 'Bearer secret-token' },
          remoteAddress: '10.0.0.3',
          payload: index < 20 ? { magnet: 'magnet:?xt=urn:btih:abc' } : {},
        }),
      ),
    );
    expect(requests.slice(0, 20).every((response) => response.statusCode === 200)).toBe(true);

    // 21-й запрос: тело невалидно, но rate limit срабатывает раньше валидации.
    const overflow = requests[20] ?? fail();
    expect(overflow.statusCode).toBe(429);
    expect(overflow.headers['x-ratelimit-limit']).toBe('20');
  });

  it('окно сбрасывается после минуты (подмена now)', async () => {
    let currentTime = 1_000_000;
    const app = trackClose(await createApp({ token: 'secret-token', rateNow: () => currentTime }));

    await Promise.all(
      Array.from({ length: 60 }, () =>
        app.inject({
          method: 'GET',
          url: '/api/releases?type=movie&q=x',
          headers: { authorization: 'Bearer secret-token' },
          remoteAddress: '10.0.0.4',
        }),
      ),
    );
    const blocked = await app.inject({
      method: 'GET',
      url: '/api/releases?type=movie&q=x',
      headers: { authorization: 'Bearer secret-token' },
      remoteAddress: '10.0.0.4',
    });
    expect(blocked.statusCode).toBe(429);

    currentTime += 61_000;
    const afterWindow = await app.inject({
      method: 'GET',
      url: '/api/releases?type=movie&q=x',
      headers: { authorization: 'Bearer secret-token' },
      remoteAddress: '10.0.0.4',
    });
    expect(afterWindow.statusCode).toBe(200);
  });

  it('разные buckets считаются раздельно: лимит releases не съедает health', async () => {
    const app = trackClose(await createApp({ token: 'secret-token' }));

    await Promise.all(
      Array.from({ length: 60 }, () =>
        app.inject({
          method: 'GET',
          url: '/api/releases?type=movie&q=x',
          headers: { authorization: 'Bearer secret-token' },
          remoteAddress: '10.0.0.5',
        }),
      ),
    );

    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.headers['x-ratelimit-limit']).toBe('300');
  });

  it('на успешных ответах есть X-RateLimit-Limit / X-RateLimit-Remaining', async () => {
    const app = trackClose(await createApp());

    const response = await app.inject({ method: 'GET', url: '/api/other' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-ratelimit-limit']).toBe('300');
    expect(response.headers['x-ratelimit-remaining']).toBe('299');
  });
});

describe('заголовки безопасности', () => {
  it('CSP, Permissions-Policy, COOP и X-Content-Type-Options на ответе', async () => {
    const app = trackClose(await createApp());

    const response = await app.inject({ method: 'GET', url: '/api/other' });
    expect(response.headers['content-security-policy']).toBe(
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    );
    expect(response.headers['permissions-policy']).toBe('geolocation=(), microphone=(), camera=()');
    expect(response.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    // HSTS не ставим: приложение работает по HTTP в локальной сети.
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });

  it('Cache-Control: no-store на /api/*', async () => {
    const app = trackClose(await createApp());

    const response = await app.inject({ method: 'GET', url: '/api/other' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('собственный Cache-Control роута img не перетирается', async () => {
    const app = trackClose(await createApp());

    const response = await app.inject({ method: 'GET', url: '/api/img/poster.jpg' });
    expect(response.headers['cache-control']).toBe('public, max-age=86400, immutable');
  });

  it('заголовки безопасности ставятся и на 401', async () => {
    const app = trackClose(await createApp({ token: 'secret-token' }));

    const response = await app.inject({ method: 'GET', url: '/api/other' });
    expect(response.statusCode).toBe(401);
    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.headers['cache-control']).toBe('no-store');
  });
});

describe('безопасность rate limit в изоляции', () => {
  it('не-/api пути не учитываются в счётчиках', async () => {
    const app = Fastify();
    registerRateLimit(app);
    app.get('/page', async () => ({ ok: true }));
    app.get('/api/other', async () => ({ ok: true }));
    app.log.level = 'silent';
    trackClose(app);
    await app.ready();

    for (let index = 0; index < 400; index += 1) {
      const response = await app.inject({ method: 'GET', url: '/page' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-ratelimit-limit']).toBeUndefined();
    }

    const apiResponse = await app.inject({ method: 'GET', url: '/api/other' });
    expect(apiResponse.headers['x-ratelimit-limit']).toBe('300');
  });
});
