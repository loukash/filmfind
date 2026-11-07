import type { ServiceStatus, TorrentDTO } from '@filmfind/shared';
import type { AppConfig } from '../config.js';

const REQUEST_TIMEOUT_MS = 15_000;
const SESSION_HEADER = 'x-transmission-session-id';

/**
 * Приводит базовый URL к RPC-эндпоинту Transmission.
 * Поддерживает как `http://host:9091`, так и полный `.../transmission/rpc`.
 */
function toRpcUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return trimmed.endsWith('/rpc') ? trimmed : `${trimmed}/transmission/rpc`;
}

/** Коды ошибок клиента Transmission. Роуты превращают их в HTTP-статусы. */
export type TransmissionErrorCode =
  | 'TRANSMISSION_NOT_CONFIGURED'
  | 'TRANSMISSION_UNAUTHORIZED'
  | 'TRANSMISSION_UNAVAILABLE'
  | 'TRANSMISSION_RPC_ERROR'
  | 'TRANSMISSION_SESSION_FAILED';

export class TransmissionError extends Error {
  override name = 'TransmissionError';

  constructor(
    readonly code: TransmissionErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface TransmissionAddArgs {
  /** Ссылка-магнит, уходит в RPC как `filename`. */
  magnet?: string;
  /** Содержимое .torrent в base64, уходит как `metainfo`. */
  metainfoBase64?: string;
  /** Каталог загрузки, уходит как `download-dir`. */
  downloadDir?: string;
  /** Добавить на паузе, уходит как `paused`. */
  paused?: boolean;
}

export interface TransmissionAddResult {
  result: 'added' | 'duplicate';
  id?: number;
  name?: string;
}

export interface TransmissionSessionInfo {
  version: string;
  downloadDir: string;
}

export interface TransmissionClient {
  add(args: TransmissionAddArgs): Promise<TransmissionAddResult>;
  getTorrents(ids?: number[]): Promise<TorrentDTO[]>;
  sessionGet(): Promise<TransmissionSessionInfo>;
}

export interface TransmissionClientDeps {
  fetch?: typeof fetch;
}

// --- Классический RPC-протокол Transmission (не JSON-RPC) -------------------
// Запрос:  { method, arguments?, tag? }
// Ответ:   { result: 'success' | строка ошибки, arguments?, tag? }

interface RpcRequest {
  method: string;
  arguments?: Record<string, unknown>;
  tag?: number;
}

interface RpcResponse<TArguments> {
  result: string;
  arguments?: TArguments;
  tag?: number;
}

interface TorrentAddedPayload {
  'torrent-added'?: { id?: unknown; name?: unknown };
  'torrent-duplicate'?: { id?: unknown; name?: unknown };
}

interface TorrentGetPayload {
  torrents?: Array<Record<string, unknown>>;
}

interface SessionGetPayload {
  version?: unknown;
  'download-dir'?: unknown;
}

/** Поля torrent-get: ровно то, что нужно для TorrentDTO. */
const TORRENT_FIELDS = [
  'id',
  'name',
  'percentDone',
  'status',
  'rateDownload',
  'rateUpload',
  'eta',
  'totalSize',
  'downloadDir',
] as const;

function unauthenticated(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Тела нет или оно уже закрыто — не важно.
  }
}

/** Лёгкая проверка доступности Transmission (session-get). Полноценный клиент — createTransmissionClient. */
export async function checkHealth(cfg: AppConfig['transmission']): Promise<ServiceStatus> {
  if (!cfg.url) {
    return { ok: false, configured: false, message: 'TRANSMISSION_URL не задан' };
  }

  const startedAt = Date.now();
  const url = toRpcUrl(cfg.url);
  const payload = { method: 'session-get' };

  const headers: Record<string, string> = {};
  if (cfg.user) {
    const credentials = `${cfg.user}:${cfg.password ?? ''}`;
    headers.authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  try {
    let response: Response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    // Transmission отвечает 409 и выдаёт session-id, с которым нужно повторить запрос.
    if (response.status === 409) {
      const sessionId = response.headers.get(SESSION_HEADER);
      if (!sessionId) {
        return {
          ok: false,
          configured: true,
          message: 'Transmission вернул 409 без заголовка X-Transmission-Session-Id',
          latencyMs: Date.now() - startedAt,
        };
      }
      await discardBody(response);
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers, [SESSION_HEADER]: sessionId },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    }

    if (response.ok) {
      return { ok: true, configured: true, latencyMs: Date.now() - startedAt };
    }
    return {
      ok: false,
      configured: true,
      message: `Transmission вернул HTTP ${response.status}`,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      configured: true,
      message: timedOut
        ? `Таймаут запроса к Transmission (${REQUEST_TIMEOUT_MS} мс)`
        : error instanceof Error
          ? error.message
          : 'Неизвестная ошибка Transmission',
      latencyMs: Date.now() - startedAt,
    };
  }
}

// --- Клиент ----------------------------------------------------------------

/**
 * Тонкий клиент классического RPC Transmission 3.x.
 * Session id кэшируется в замыкании: 409-хендшейк выполняется один раз,
 * а не на каждый вызов.
 */
export function createTransmissionClient(
  cfg: AppConfig,
  deps: TransmissionClientDeps = {},
): TransmissionClient {
  const fetchImpl = deps.fetch ?? globalThis.fetch;

  let sessionId: string | undefined;
  let nextTag = 1;

  function requireRpcUrl(): string {
    const raw = cfg.transmission.url;
    if (!raw) {
      throw new TransmissionError('TRANSMISSION_NOT_CONFIGURED', 'TRANSMISSION_URL не задан');
    }
    return toRpcUrl(raw);
  }

  function baseHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const { user, password } = cfg.transmission;
    if (user) {
      const credentials = `${user}:${password ?? ''}`;
      headers.authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
    }
    return headers;
  }

  async function send(method: string, args: Record<string, unknown>): Promise<Response> {
    const payload: RpcRequest = { method, arguments: args, tag: nextTag++ };

    const headers = baseHeaders();
    if (sessionId !== undefined) headers[SESSION_HEADER] = sessionId;

    // URL проверяется до try: TRANSMISSION_NOT_CONFIGURED не должен
    // маскироваться под сетевую ошибку.
    const rpcUrl = requireRpcUrl();

    try {
      return await fetchImpl(rpcUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      const reason = timedOut ? `таймаут запроса (${REQUEST_TIMEOUT_MS} мс)` : 'сетевая ошибка';      throw new TransmissionError('TRANSMISSION_UNAVAILABLE', `Transmission недоступен: ${reason}`);
    }
  }

  /**
   * 409-хендшейк: Transmission выдаёт новый session id в заголовке ответа.
   * Один 409 — повторяем; второй 409 подряд — обновляем id и повторяем ещё раз;
   * третий 409 — сдаёмся с TRANSMISSION_SESSION_FAILED.
   */
  async function rpc<TArguments>(method: string, args: Record<string, unknown>): Promise<TArguments> {
    let response = await send(method, args);

    for (let retry = 0; response.status === 409 && retry < 2; retry += 1) {
      const header = response.headers.get(SESSION_HEADER);
      await discardBody(response);
      if (!header) {
        throw new TransmissionError(
          'TRANSMISSION_SESSION_FAILED',
          'Transmission вернул 409 без заголовка X-Transmission-Session-Id',
        );
      }
      // Кэшируем сразу: следующий вызов пройдёт без лишнего 409.
      sessionId = header;
      response = await send(method, args);
    }

    if (response.status === 409) {
      await discardBody(response);
      throw new TransmissionError(
        'TRANSMISSION_SESSION_FAILED',
        'Не удалось установить сессию с Transmission: два 409 подряд с обновлённым session id',
      );
    }

    if (response.status === 401 || response.status === 403) {
      await discardBody(response);
      throw new TransmissionError(
        'TRANSMISSION_UNAUTHORIZED',
        `Transmission отклонил учётные данные (HTTP ${response.status})`,
        response.status,
      );
    }

    const text = await response.text();

    if (!response.ok) {
      throw new TransmissionError(
        'TRANSMISSION_UNAVAILABLE',
        `Transmission вернул HTTP ${response.status}`,
        response.status,
      );
    }

    let payload: RpcResponse<TArguments> | undefined;
    try {
      payload = JSON.parse(text) as RpcResponse<TArguments>;
    } catch {
      throw new TransmissionError('TRANSMISSION_RPC_ERROR', 'Ответ Transmission не является валидным JSON');
    }

    if (payload === undefined || typeof payload.result !== 'string') {
      throw new TransmissionError('TRANSMISSION_RPC_ERROR', 'Transmission вернул неожиданный формат ответа');
    }

    if (payload.result !== 'success') {
      throw new TransmissionError(
        'TRANSMISSION_RPC_ERROR',
        `Transmission вернул ошибку RPC: ${payload.result}`,
      );
    }

    return payload.arguments as TArguments;
  }

  return {
    async add(args: TransmissionAddArgs): Promise<TransmissionAddResult> {
      const rpcArgs: Record<string, unknown> = {};
      if (args.magnet !== undefined) rpcArgs.filename = args.magnet;
      if (args.metainfoBase64 !== undefined) rpcArgs.metainfo = args.metainfoBase64;
      if (args.downloadDir !== undefined) rpcArgs['download-dir'] = args.downloadDir;
      if (args.paused !== undefined) rpcArgs.paused = args.paused;

      const payload = await rpc<TorrentAddedPayload>('torrent-add', rpcArgs);

      if (payload['torrent-added'] !== undefined) {
        const added = payload['torrent-added'];
        return {
          result: 'added',
          id: typeof added.id === 'number' ? added.id : undefined,
          name: unauthenticated(added.name),
        };
      }
      if (payload['torrent-duplicate'] !== undefined) {
        const duplicate = payload['torrent-duplicate'];
        return {
          result: 'duplicate',
          id: typeof duplicate.id === 'number' ? duplicate.id : undefined,
          name: unauthenticated(duplicate.name),
        };
      }
      throw new TransmissionError(
        'TRANSMISSION_RPC_ERROR',
        'Transmission ответил на torrent-add без torrent-added и torrent-duplicate',
      );
    },

    async getTorrents(ids?: number[]): Promise<TorrentDTO[]> {
      const rpcArgs: Record<string, unknown> = { fields: [...TORRENT_FIELDS] };
      if (ids !== undefined) rpcArgs.ids = ids;

      const payload = await rpc<TorrentGetPayload>('torrent-get', rpcArgs);
      const torrents = payload.torrents ?? [];

      return torrents.map((raw) => {
        const dto: TorrentDTO = {
          id: numeric(raw.id),
          name: unauthenticated(raw.name) ?? '',
          percentDone: numeric(raw.percentDone),
          status: numeric(raw.status),
          rateDownload: numeric(raw.rateDownload),
          rateUpload: numeric(raw.rateUpload),
          // -1 пропускается как есть: «время до конца неизвестно».
          eta: numeric(raw.eta),
          totalSize: numeric(raw.totalSize),
        };
        const downloadDir = unauthenticated(raw.downloadDir);
        if (downloadDir !== undefined) dto.downloadDir = downloadDir;
        return dto;
      });
    },

    async sessionGet(): Promise<TransmissionSessionInfo> {
      const payload = await rpc<SessionGetPayload>('session-get', {});
      return {
        version: unauthenticated(payload.version) ?? '',
        downloadDir: unauthenticated(payload['download-dir']) ?? '',
      };
    },
  };
}
