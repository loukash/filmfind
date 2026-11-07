import type {
  AddTorrentResultDTO,
  ApiErrorDTO,
  HealthDTO,
  ReleasesResponseDTO,
  SearchResultDTO,
  TitleDetailsDTO,
  TitleType,
  TorrentDTO,
} from '@filmfind/shared';

/**
 * Тонкая обёртка над fetch. Никаких прямых обращений к TMDB/Prowlarr:
 * браузер знает только про свой origin, всё остальное проксирует сервер.
 */

/** Ключ в localStorage с опциональным пользовательским токеном доступа. */
export const TOKEN_STORAGE_KEY = 'filmfind.token';

const REQUEST_TIMEOUT_MS = 15_000;

/** Размеры постера из белого списка серверного прокси `/api/img/:size/:file`. */
export type PosterSize = 'w92' | 'w154' | 'w185' | 'w342' | 'w500' | 'w780' | 'original';

/**
 * Ошибка API. Сервер отвечает `{ code, message }`, поэтому `code` — стабильный
 * машинный признак (например, `TMDB_NOT_CONFIGURED`), а `message` — текст для
 * человека.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Пользовательский токен читается на каждый запрос: он может появиться без перезагрузки. */
function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    // Приватный режим или запрет storage — работаем без токена.
    return null;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
}

async function readErrorPayload(response: Response): Promise<ApiErrorDTO> {
  try {
    const data: unknown = await response.json();
    if (typeof data === 'object' && data !== null) {
      const record = data as Record<string, unknown>;
      const code = typeof record.code === 'string' ? record.code : undefined;
      const message = typeof record.message === 'string' ? record.message : undefined;
      if (code !== undefined && message !== undefined) {
        return { code, message, details: record.details };
      }
    }
  } catch {
    // Тело не JSON или уже прочитано — ниже вернём общий текст.
  }

  return {
    code: `HTTP_${response.status}`,
    message: `Сервер вернул HTTP ${response.status}`,
  };
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };

  const token = readToken();
  if (token !== null && token.length > 0) {
    headers.authorization = `Bearer ${token}`;
  }

  let body: string | undefined;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]);

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      ...(body === undefined ? {} : { body }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ApiError(
        'TIMEOUT',
        `Сервер не ответил за ${REQUEST_TIMEOUT_MS / 1000} секунд`,
        0,
      );
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('ABORTED', 'Запрос отменён', 0);
    }
    throw new ApiError('NETWORK_ERROR', 'Не удалось связаться с сервером', 0);
  }

  if (!response.ok) {
    const payload = await readErrorPayload(response);
    throw new ApiError(payload.code, payload.message, response.status, payload.details);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError('BAD_RESPONSE', 'Сервер вернул некорректный ответ', response.status);
  }
}

/** `GET /api/health` — состояние трёх внешних сервисов. */
export function getHealth(signal?: AbortSignal): Promise<HealthDTO> {
  return request<HealthDTO>('/api/health', { signal });
}

/** `GET /api/titles/search` — мультипоиск TMDB (фильмы и сериалы одной выдачей). */
export function searchTitles(q: string, page = 1, signal?: AbortSignal): Promise<SearchResultDTO> {
  const params = new URLSearchParams({ q, page: String(page) });
  return request<SearchResultDTO>(`/api/titles/search?${params.toString()}`, { signal });
}

/** `GET /api/titles/:type/:id` — подробности тайтла. */
export function getTitle(
  type: TitleType,
  id: number,
  signal?: AbortSignal,
): Promise<TitleDetailsDTO> {
  return request<TitleDetailsDTO>(`/api/titles/${type}/${id}`, { signal });
}

export interface ReleasesParams {
  type: TitleType;
  titleId?: number;
  season?: number;
  q?: string;
  indexerIds?: number[];
  limit?: number;
}

/** `GET /api/releases` — раздачи из Prowlarr. Ссылки на скачивание остаются на сервере. */
export function getReleases(
  params: ReleasesParams,
  signal?: AbortSignal,
): Promise<ReleasesResponseDTO> {
  const search = new URLSearchParams({ type: params.type });

  if (params.titleId !== undefined) search.set('titleId', String(params.titleId));
  if (params.season !== undefined) search.set('season', String(params.season));
  if (params.q !== undefined && params.q.trim().length > 0) search.set('q', params.q.trim());
  if (params.indexerIds !== undefined && params.indexerIds.length > 0) {
    search.set('indexerIds', params.indexerIds.join(','));
  }
  if (params.limit !== undefined) search.set('limit', String(params.limit));

  return request<ReleasesResponseDTO>(`/api/releases?${search.toString()}`, { signal });
}

/**
 * Тело запроса на добавление раздачи в Transmission.
 *
 * Контракт предварительный: серверный роут `/api/transmission/add` появится в
 * волне 3. Магнит-ссылки наружу не отдаются, поэтому клиент передаёт только
 * идентификатор раздачи, а ссылку сервер восстанавливает сам.
 */
/**
 * Тело `POST /api/transmission/add`: ровно одно из полей.
 *
 * Клиент обычно отправляет `releaseId` — сервер сам достаёт магнит или
 * скачивает `.torrent` с Prowlarr. Прямые `magnet`/`downloadUrl` нужны для
 * ручных сценариев и отладки.
 */
export type AddTorrentBody =
  | { releaseId: string }
  | { magnet: string }
  | { downloadUrl: string };

/** `POST /api/transmission/add` — поставить раздачу на скачивание. */
export function addTorrent(
  body: AddTorrentBody,
  signal?: AbortSignal,
): Promise<AddTorrentResultDTO> {
  return request<AddTorrentResultDTO>('/api/transmission/add', { method: 'POST', body, signal });
}

/** `GET /api/transmission/torrents` — текущие загрузки. */
export async function getTorrents(signal?: AbortSignal): Promise<TorrentDTO[]> {
  const response = await request<{ items: TorrentDTO[] }>('/api/transmission/torrents', { signal });
  return response.items;
}

/**
 * Ссылка на постер через серверный прокси.
 *
 * `path` — сырой путь TMDB (`/abc123.jpg`). Без пути возвращаем `undefined`,
 * чтобы `Poster` показал заглушку, а не битую картинку.
 */
export function posterUrl(path?: string, size: PosterSize = 'w342'): string | undefined {
  if (path === undefined) return undefined;

  const file = path.replace(/^\/+/, '');
  if (file.length === 0) return undefined;

  return `/api/img/${size}/${encodeURIComponent(file)}`;
}
