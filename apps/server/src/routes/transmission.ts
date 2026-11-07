import type { ApiErrorDTO } from '@filmfind/shared';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  TransmissionError,
  createTransmissionClient,
  type TransmissionAddArgs,
  type TransmissionClient,
} from '../clients/transmission.js';
import type { AppConfig } from '../config.js';
import { getReleaseById } from '../lib/release-store.js';

const TORRENT_MAX_BYTES = 10 * 1024 * 1024;
const TORRENT_TIMEOUT_MS = 15_000;

export interface TransmissionRoutesOptions {
  config: AppConfig;
  /** Внедряется в тестах; в проде создаётся из config. */
  transmission?: TransmissionClient;
  /** Подмена fetch для скачивания .torrent в тестах. */
  fetch?: typeof fetch;
}

/** Ошибка уровня роута: код и статус известны заранее. */
class AddError extends Error {
  override name = 'AddError';

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Ровно одно из трёх полей: zod-union со strict не пропустит лишние ключи. */
const addBodySchema = z.union([
  z.strictObject({ releaseId: z.string().trim().min(1).max(200) }),
  z.strictObject({ magnet: z.string().trim().min(1).max(4096) }),
  z.strictObject({ downloadUrl: z.string().trim().min(1).max(2048) }),
]);

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ code: 'BAD_REQUEST', message } satisfies ApiErrorDTO);
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function sendTransmissionError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof TransmissionError) {
    // Не задан URL — конфигурационная проблема (503); остальное — сбой апстрима.
    const status = error.code === 'TRANSMISSION_NOT_CONFIGURED' ? 503 : 502;
    return reply.code(status).send({
      code: error.code,
      message: error.message,
    } satisfies ApiErrorDTO);
  }
  // Неизвестная ошибка — пусть её обработает общий error handler приложения.
  throw error;
}

/**
 * Роуты Transmission: добавление раздачи и список загрузок.
 * Пути полные (с /api), потому что плагин регистрируется в корне приложения.
 */
export const transmissionRoutes: FastifyPluginAsync<TransmissionRoutesOptions> = async (
  app,
  options,
) => {
  // Клиент создаётся eagerly, но URL проверяется лениво: сервер должен
  // стартовать и без TRANSMISSION_URL, ошибка уйдёт 503 на конкретном запросе.
  const client = options.transmission ?? createTransmissionClient(options.config);
  const fetchImpl = options.fetch ?? globalThis.fetch;

  // Скачивать .torrent разрешаем только с origin Prowlarr: в ссылках Prowlarr
  // зашит API-ключ, и передавать их дальше другим хостам небезопасно.
  const prowlarrOrigin = originOf(options.config.prowlarr.url);

  /**
   * Скачивает .torrent и возвращает содержимое в base64 (для RPC-поля metainfo).
   * Бросает AddError с готовым HTTP-статусом и кодом ошибки.
   */
  const downloadTorrent = async (downloadUrl: string): Promise<string> => {
    let parsed: URL;
    try {
      parsed = new URL(downloadUrl);
    } catch {
      throw new AddError(400, 'BAD_REQUEST', 'downloadUrl не является корректным URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new AddError(400, 'BAD_REQUEST', 'downloadUrl должен быть http(s)-ссылкой');
    }
    if (prowlarrOrigin === undefined || parsed.origin !== prowlarrOrigin) {
      throw new AddError(
        400,
        'UNSAFE_URL',
        'Скачивание .torrent разрешено только с сервера Prowlarr',
      );
    }

    let response: Response;
    try {
      response = await fetchImpl(parsed.toString(), {
        method: 'GET',
        headers: { accept: 'application/x-bittorrent, application/octet-stream' },
        signal: AbortSignal.timeout(TORRENT_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      const reason = timedOut ? `таймаут (${TORRENT_TIMEOUT_MS} мс)` : 'сетевая ошибка';
      throw new AddError(502, 'TORRENT_DOWNLOAD_FAILED', `Не удалось скачать .torrent: ${reason}`);
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new AddError(
        502,
        'TORRENT_DOWNLOAD_FAILED',
        `Скачивание .torrent: HTTP ${response.status}`,
      );
    }

    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > TORRENT_MAX_BYTES) {
      await response.body?.cancel().catch(() => {});
      throw new AddError(502, 'TORRENT_DOWNLOAD_FAILED', '.torrent превышает лимит 10 МБ');
    }

    const data = await response.arrayBuffer();
    if (data.byteLength > TORRENT_MAX_BYTES) {
      throw new AddError(502, 'TORRENT_DOWNLOAD_FAILED', '.torrent превышает лимит 10 МБ');
    }
    if (data.byteLength === 0) {
      throw new AddError(502, 'TORRENT_DOWNLOAD_FAILED', 'Prowlarr вернул пустой .torrent');
    }

    return Buffer.from(data).toString('base64');
  };

  app.post('/api/transmission/add', async (request, reply) => {
    const parsed = addBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return badRequest(reply, 'Ожидается ровно одно поле: releaseId, magnet или downloadUrl');
    }
    const body = parsed.data;

    // Для логов доступен только releaseId: магнит и downloadUrl содержат ключи.
    const releaseId = 'releaseId' in body ? body.releaseId : null;

    let addArgs: TransmissionAddArgs;
    try {
      if ('magnet' in body) {
        if (!body.magnet.startsWith('magnet:')) {
          return badRequest(reply, 'magnet должен начинаться с magnet:');
        }
        addArgs = { magnet: body.magnet };
      } else if ('downloadUrl' in body) {
        addArgs = { metainfoBase64: await downloadTorrent(body.downloadUrl) };
      } else {
        const release = getReleaseById(body.releaseId);
        if (!release) {
          return reply.code(404).send({
            code: 'RELEASE_NOT_FOUND',
            message: 'Раздача не найдена в индексе: поиск не выполнялся или запись истекла',
          } satisfies ApiErrorDTO);
        }
        if (release.magnetUrl) {
          addArgs = { magnet: release.magnetUrl };
        } else if (release.downloadUrl) {
          addArgs = { metainfoBase64: await downloadTorrent(release.downloadUrl) };
        } else {
          return badRequest(reply, 'У раздачи нет ни магнита, ни ссылки на .torrent');
        }
      }

      request.log.info({ releaseId }, 'Добавление раздачи в Transmission');

      const result = await client.add({
        ...addArgs,
        downloadDir: options.config.transmission.downloadDir,
      });

      request.log.info({ releaseId, torrentId: result.id ?? null }, `Раздача ${result.result}`);
      return reply.code(200).send({
        result: result.result,
        ...(result.id !== undefined ? { id: result.id } : {}),
        ...(result.name !== undefined ? { name: result.name } : {}),
      });
    } catch (error) {
      if (error instanceof AddError) {
        return reply
          .code(error.status)
          .send({ code: error.code, message: error.message } satisfies ApiErrorDTO);
      }
      return sendTransmissionError(reply, error);
    }
  });

  app.get('/api/transmission/torrents', async (_request, reply) => {
    try {
      const items = await client.getTorrents();
      return reply.code(200).send({ items });
    } catch (error) {
      return sendTransmissionError(reply, error);
    }
  });
};
