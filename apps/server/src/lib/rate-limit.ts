import type { FastifyInstance } from 'fastify';
import type { ApiErrorDTO } from '@filmfind/shared';

/** Окно счётчика: фиксированная минута. */
const WINDOW_MS = 60_000;
/** Ключи Record'а — пара `<ip>|<limit-name>`. */
const SWEEP_INTERVAL_MS = 60_000;

/**
 * 60 req/min — поиск и раздачи (двух кликов по ~20 карточек хватает пользователю,
 * но всплеск ограничивает нагрузку на TMDB и Prowlarr).
 * 20 req/min — add-раздача: одна кнопка на карточку, больше не нужно.
 * 300 req/min — остальное (health, детали тайтла, постеры): пачка постеров
 * с одной страницы легко набирает десятки запросов.
 */
const LIMITS = {
  search: 60,
  releases: 60,
  transmissionAdd: 20,
  rest: 300,
} as const;

/**
 * Определяет bucket для полного пути. Приоритет от самых дорогих эндпоинтов
 * к самым дешёвым; префиксы размечены так, чтобы не пересекаться.
 */
function bucketOf(pathname: string): { name: keyof typeof LIMITS; limit: number } {
  if (pathname === '/api/transmission/add') {
    return { name: 'transmissionAdd', limit: LIMITS.transmissionAdd };
  }
  if (pathname === '/api/releases' || pathname.startsWith('/api/releases/')) {
    return { name: 'releases', limit: LIMITS.releases };
  }
  if (pathname === '/api/titles/search' || pathname.startsWith('/api/titles/search/')) {
    return { name: 'search', limit: LIMITS.search };
  }
  return { name: 'rest', limit: LIMITS.rest };
}

interface Entry {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** Внедряется в тестах; в проде — Date.now(). */
  now?: () => number;
  windowMs?: number;
}

/**
 * in-memory rate limit по IP для `/api/*`.
 *
 * - Лимит считается по паре (`request.ip`, bucket пути): лимиты поиска, раздач
 *   и add — свои, остальное — общий.
 * - Фиксированное окно 1 минута: на стыке окон возможен всплеск до x2, но для
 *   self-hosted сценария с несколькими пользователями этого достаточно;
 *   скользящее окно не оправдывает сложность.
 * - Память: каждая запись удаляется лениво при разблокировке окна, а чтобы
 *   давно неактивные IP не зависали в Map навсегда — периодический sweep
 *   через `setInterval(...).unref()`.
 */
export function registerRateLimit(app: FastifyInstance, options: RateLimitOptions = {}): void {
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? WINDOW_MS;

  const buckets = new Map<string, Entry>();
  let sweepTimer: NodeJS.Timeout | undefined;

  const sweep = (): void => {
    const currentTime = now();
    for (const [key, entry] of buckets) {
      if (entry.resetAt <= currentTime) buckets.delete(key);
    }
  };

  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?')[0] ?? request.url;
    if (!(pathname === '/api' || pathname.startsWith('/api/'))) return;

    sweepTimer ??= setInterval(sweep, SWEEP_INTERVAL_MS);
    sweepTimer.unref?.();

    const bucket = bucketOf(pathname);
    const key = `${request.ip}|${bucket.name}`;
    const currentTime = now();

    let entry = buckets.get(key);
    if (entry === undefined || entry.resetAt <= currentTime) {
      // Новое окно; старую запись (если была) перезаписываем.
      entry = { count: 0, resetAt: currentTime + windowMs };
      buckets.set(key, entry);
    } else if (entry.count >= bucket.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - currentTime) / 1000));
      return reply
        .code(429)
        .header('Retry-After', String(retryAfterSeconds))
        .header('X-RateLimit-Limit', String(bucket.limit))
        .header('X-RateLimit-Remaining', '0')
        .send({
          code: 'RATE_LIMITED',
          message: 'Слишком много запросов, попробуйте позже',
        } satisfies ApiErrorDTO);
    }

    entry.count += 1;
    reply.header('X-RateLimit-Limit', String(bucket.limit));
    reply.header('X-RateLimit-Remaining', String(Math.max(0, bucket.limit - entry.count)));
  });

  // Таймер снимаем при закрытии приложения, чтобы не держать event loop
  // после app.close() и не течь между тестовыми приложениями.
  app.addHook('onClose', async () => {
    if (sweepTimer !== undefined) clearInterval(sweepTimer);
    sweepTimer = undefined;
    buckets.clear();
  });
}
