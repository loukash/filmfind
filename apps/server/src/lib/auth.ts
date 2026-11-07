import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ApiErrorDTO } from '@filmfind/shared';

/**
 * Сравнение строк за константное время.
 *
 * Обе строки конвертируются в буферы; при разной длине возвращается false сразу —
 * ранний выход есть только по длине (это осознанно: leaked длина не раскрывает
 * содержимое токена). По содержимому раннего выхода нет: при равной длине
 * вызывается `crypto.timingSafeEqual`, который всегда проходит по всем байтам.
 */
export function safeTokenEquals(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (candidateBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(candidateBuffer, expectedBuffer);
}

/**
 * Если задан `APP_ACCESS_TOKEN`, все `/api/*` требуют
 * `Authorization: Bearer <token>`.
 *
 * Исключение: `/api/health` остаётся публичным — он нужен Docker healthcheck
 * и индикатору статуса до ввода токена (осознанное отклонение от ТЗ,
 * см. notes/wave3-security.md).
 *
 * Не-`/api` пути (статика, SPA) не защищаются: там только оболочка приложения,
 * данные всё равно требуют токен через `/api`.
 */
export function registerAuthHook(app: FastifyInstance, accessToken: string | undefined): void {
  if (accessToken === undefined) return;

  app.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0] ?? request.url;
    const isApi = url === '/api' || url.startsWith('/api/');
    if (!isApi || url === '/api/health') return;

    const header = request.headers.authorization;
    const headerValue = typeof header === 'string' ? header : undefined;
    // `Bearer ` сравнивается до извлечения токена: в логах заголовок всё равно
    // маскируется pino-redact, а нефигурирующая схема просто отклоняется.
    const token =
      headerValue !== undefined && headerValue.startsWith('Bearer ')
        ? headerValue.slice('Bearer '.length)
        : '';

    if (token.length === 0 || !safeTokenEquals(token, accessToken)) {
      return reply
        .code(401)
        .header('WWW-Authenticate', 'Bearer')
        .send({ code: 'UNAUTHORIZED', message: 'Требуется токен доступа' } satisfies ApiErrorDTO);
    }
  });
}
