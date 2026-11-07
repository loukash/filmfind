import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { ApiErrorDTO } from '@filmfind/shared';
import type { AppConfig } from './config.js';
import { registerAuthHook } from './lib/auth.js';
import { HttpError } from './lib/http.js';
import { registerRateLimit, type RateLimitOptions } from './lib/rate-limit.js';
import { registerRoutes } from './routes/index.js';

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

// HSTS сознательно не ставим: приложение ходит по HTTP в локальной сети,
// заголовок Strict-Transport-Security заставил бы браузеры ходить только по
// HTTPS и сломал доступ.
const PERMISSIONS_POLICY = 'geolocation=(), microphone=(), camera=()';

/**
 * Собирает приложение без регистрации роутов: логгер, заголовки безопасности,
 * обработчики ошибок, статика. Нужен тестам, которые регистрируют один плагин
 * изолированно.
 */
export async function buildBaseApp(
  config: AppConfig,
  options: { rateLimit?: RateLimitOptions } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    genReqId: () => randomUUID(),
    logger: {
      level: 'info',
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-api-key"]',
          'req.headers["x-app-token"]',
          'res.headers["set-cookie"]',
          'password',
          'apiKey',
          'token',
          '*.password',
          '*.apiKey',
          '*.token',
          '*.accessToken',
        ],
        censor: '[redacted]',
      },
    },
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    reply.header('Permissions-Policy', PERMISSIONS_POLICY);
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');

    // Данные API не должны кэшироваться браузером и промежуточными прокси.
    // Исключение — /api/img: роут сам ставит публичный кэш постеров
    // (public, max-age=86400), не перетираем его.
    const pathname = request.url.split('?')[0] ?? request.url;
    const isApiRoute = pathname === '/api' || pathname.startsWith('/api/');
    if (isApiRoute && reply.getHeader('cache-control') === undefined) {
      reply.header('Cache-Control', 'no-store');
    }
    return payload;
  });

  // Rate limit регистрируется до auth: тогда и запросы без токена (перебор
  // пароля) ограничиваются по IP. Лимит, авторизация — до роутов.
  registerRateLimit(app, options.rateLimit);
  registerAuthHook(app, config.accessToken);

  let staticEnabled = false;
  if (config.isProduction && existsSync(config.webDistPath)) {
    await app.register(fastifyStatic, {
      root: config.webDistPath,
      prefix: '/',
    });
    staticEnabled = true;
  } else if (config.isProduction) {
    app.log.warn(`Каталог веб-сборки не найден: ${config.webDistPath}. Статика не будет раздаваться.`);
  }

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const isApiRoute = request.url.startsWith('/api');

    if (error instanceof ZodError) {
      const body: ApiErrorDTO = {
        code: 'VALIDATION_ERROR',
        message: 'Некорректные параметры запроса',
        details: error.issues,
      };
      void reply.code(400).send(body);
      return;
    }

    if (error instanceof HttpError) {
      request.log.warn({ err: error }, 'Ошибка внешнего сервиса');
      const body: ApiErrorDTO = {
        code: 'UPSTREAM_ERROR',
        message: 'Внешний сервис недоступен',
        details: config.isProduction ? undefined : error.message,
      };
      void reply.code(502).send(body);
      return;
    }

    const statusCode = error.statusCode ?? 500;

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'Необработанная ошибка');
    }

    if (!isApiRoute) {
      void reply.code(statusCode).send({
        code: statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR',
        message: statusCode >= 500 ? 'Внутренняя ошибка сервера' : error.message,
      } satisfies ApiErrorDTO);
      return;
    }

    const body: ApiErrorDTO = {
      code: statusCode === 404 ? 'NOT_FOUND' : statusCode >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
      message:
        statusCode >= 500 && config.isProduction ? 'Внутренняя ошибка сервера' : error.message,
    };
    void reply.code(statusCode).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?')[0] ?? request.url;
    const isApiRoute = pathname === '/api' || pathname.startsWith('/api/');

    if (isApiRoute || !staticEnabled) {
      void reply.code(404).send({
        code: 'NOT_FOUND',
        message: 'Маршрут не найден',
      } satisfies ApiErrorDTO);
      return;
    }

    // SPA-fallback: любой неизвестный путь отдаёт index.html.
    // index.html нельзя кэшировать надолго: он ссылается на статику с хэшем
    // в имени, и после обновления клиент должен получить свежие ссылки.
    void reply.sendFile('index.html', { maxAge: 0, immutable: false });
  });

  return app;
}

/** Полное приложение: база плюс все API-роуты. */
export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = await buildBaseApp(config);
  await registerRoutes(app, config);
  return app;
}
