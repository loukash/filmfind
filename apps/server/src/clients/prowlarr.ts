import { createHash } from 'node:crypto';
import {
  normalizeReleaseTitle,
  parseRelease,
  type ReleaseDTO,
  type ServiceStatus,
} from '@filmfind/shared';
import type { AppConfig } from '../config.js';
import { fetchJson } from '../lib/http.js';

const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_LIMIT = 100;

/** Коды ошибок клиента Prowlarr. Роуты превращают их в HTTP-статусы. */
export type ProwlarrErrorCode =
  | 'PROWLARR_NOT_CONFIGURED'
  | 'PROWLARR_UNAUTHORIZED'
  | 'PROWLARR_UNAVAILABLE';

export class ProwlarrError extends Error {
  override name = 'ProwlarrError';

  constructor(
    readonly code: ProwlarrErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Тип поиска Newznab/Prowlarr. `moviesearch` — удобный алиас, уходит как `movie`. */
export type ProwlarrSearchType = 'search' | 'tvsearch' | 'moviesearch';

export interface ProwlarrSearchParams {
  query: string;
  /** Категории Newznab: 2000 — фильмы, 5000 — сериалы, 5070 — аниме. */
  categories?: number[];
  indexerIds?: number[];
  /** По умолчанию 100. */
  limit?: number;
  offset?: number;
  type?: ProwlarrSearchType;
}

export interface ProwlarrIndexer {
  id: number;
  name: string;
  enable: boolean;
  protocol?: string;
}

/**
 * Раздача Prowlarr после нормализации.
 * Содержит `magnetUrl`/`downloadUrl` — это внутренние поля, наружу их отдавать нельзя:
 * в ссылках зашит API-ключ Prowlarr.
 */
export interface InternalRelease extends ReleaseDTO {
  magnetUrl?: string;
  downloadUrl?: string;
}

/** Нормализованная раздача — то, что возвращает `ProwlarrClient.search`. */
export type ProwlarrRelease = InternalRelease;

export interface ProwlarrSearchResult {
  items: ProwlarrRelease[];
  warnings: string[];
}

export interface ProwlarrClient {
  search(params: ProwlarrSearchParams): Promise<ProwlarrSearchResult>;
  getIndexers(): Promise<ProwlarrIndexer[]>;
}

export interface ProwlarrClientDeps {
  fetch?: typeof fetch;
}

// --- Сырой ответ Prowlarr (ReleaseResource из API v1) ---------------------
// Поля описаны по официальному openapi.json Prowlarr. Почти всё nullable,
// поэтому отсутствие значения — нормальный случай, а не ошибка.

interface ProwlarrCategoryResource {
  id?: number | null;
  name?: string | null;
  subCategories?: ProwlarrCategoryResource[] | null;
}

export interface ProwlarrReleaseResource {
  guid?: string | null;
  title?: string | null;
  size?: number | null;
  indexer?: string | null;
  indexerId?: number | null;
  publishDate?: string | null;
  infoHash?: string | null;
  seeders?: number | null;
  leechers?: number | null;
  categories?: ProwlarrCategoryResource[] | null;
  downloadUrl?: string | null;
  magnetUrl?: string | null;
  protocol?: string | null;
  /** Не документировано: некоторые сборки/форки кладут сюда текст ошибки индексатора. */
  error?: string | null;
  message?: string | null;
}

interface ProwlarrIndexerResource {
  id?: number | null;
  name?: string | null;
  enable?: boolean | null;
  protocol?: string | null;
}

// --- Нормализация ---------------------------------------------------------

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

/**
 * Стабильный идентификатор раздачи: infoHash → sha1(guid) → sha1(название + размер).
 * Одинаков на всех вызовах, поэтому годится как React-ключ и для дедупликации.
 */
export function releaseId(raw: {
  infoHash?: string | null;
  guid?: string | null;
  title?: string | null;
  size?: number | null;
}): string {
  const infoHash = optionalString(raw.infoHash);
  if (infoHash) return infoHash.toLowerCase();

  const guid = optionalString(raw.guid);
  if (guid) return sha1(guid);

  const title = normalizeReleaseTitle(raw.title ?? '');
  return sha1(`${title}:${optionalNumber(raw.size) ?? 0}`);
}

/** Плоский список id категорий: верхний уровень + вложенные подкатегории. */
export function flattenCategories(
  categories: ProwlarrCategoryResource[] | null | undefined,
): number[] {
  const ids = new Set<number>();
  const walk = (list: ProwlarrCategoryResource[] | null | undefined): void => {
    if (!Array.isArray(list)) return;
    for (const category of list) {
      if (typeof category?.id === 'number' && Number.isFinite(category.id)) ids.add(category.id);
      walk(category?.subCategories);
    }
  };
  walk(categories);
  return [...ids];
}

/**
 * Приводит запись Prowlarr к внутреннему DTO.
 * `parseRelease` пока заглушка из @filmfind/shared — качество заполнится,
 * когда его реализуют в пакете.
 */
export function normalizeProwlarrRelease(raw: ProwlarrReleaseResource): InternalRelease {
  const title = optionalString(raw.title) ?? '';
  const size = optionalNumber(raw.size) ?? 0;

  const release: InternalRelease = {
    id: releaseId({ infoHash: raw.infoHash, guid: raw.guid, title, size }),
    title,
    size,
    categories: flattenCategories(raw.categories),
    quality: parseRelease(title),
  };

  const seeders = optionalNumber(raw.seeders);
  if (seeders !== undefined) release.seeders = seeders;
  const leechers = optionalNumber(raw.leechers);
  if (leechers !== undefined) release.leechers = leechers;
  const indexer = optionalString(raw.indexer);
  if (indexer !== undefined) release.indexer = indexer;
  const indexerId = optionalNumber(raw.indexerId);
  if (indexerId !== undefined) release.indexerId = indexerId;
  const publishDate = optionalString(raw.publishDate);
  if (publishDate !== undefined) release.publishDate = publishDate;
  const infoHash = optionalString(raw.infoHash);
  if (infoHash !== undefined) release.infoHash = infoHash;
  const guid = optionalString(raw.guid);
  if (guid !== undefined) release.guid = guid;
  // Внутренние поля: нужны волне 2 для скачивания, наружу не отдаются.
  const magnetUrl = optionalString(raw.magnetUrl);
  if (magnetUrl !== undefined) release.magnetUrl = magnetUrl;
  const downloadUrl = optionalString(raw.downloadUrl);
  if (downloadUrl !== undefined) release.downloadUrl = downloadUrl;

  return release;
}

/**
 * Запись-заглушка вместо результата упавшего индексатора.
 * Prowlarr 2.x обычно просто логирует сбой и не кладёт его в ответ 200,
 * но защищаемся от записей без названия/guid и от поля `error`.
 */
function isErrorStub(raw: ProwlarrReleaseResource): boolean {
  if (optionalString(raw.error) || optionalString(raw.message)) return true;
  return optionalString(raw.title) === undefined && optionalString(raw.guid) === undefined;
}

function stubLabel(raw: ProwlarrReleaseResource): string {
  return optionalString(raw.indexer) ?? `#${optionalNumber(raw.indexerId) ?? '?'}`;
}

// --- HTTP -----------------------------------------------------------------

interface ProwlarrConnection {
  base: string;
  apiKey: string;
}

function requireConnection(cfg: AppConfig['prowlarr']): ProwlarrConnection {
  if (!cfg.url) {
    throw new ProwlarrError('PROWLARR_NOT_CONFIGURED', 'PROWLARR_URL не задан');
  }
  if (!cfg.apiKey) {
    throw new ProwlarrError('PROWLARR_NOT_CONFIGURED', 'PROWLARR_API_KEY не задан');
  }
  return { base: cfg.url.replace(/\/+$/, ''), apiKey: cfg.apiKey };
}

async function requestJson<T>(
  url: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json', 'x-api-key': apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const reason =
      error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
        ? `таймаут запроса (${REQUEST_TIMEOUT_MS} мс)`
        : 'сетевая ошибка';
    throw new ProwlarrError('PROWLARR_UNAVAILABLE', `Prowlarr недоступен: ${reason}`);
  }

  const text = await response.text();

  if (response.status === 401 || response.status === 403) {
    throw new ProwlarrError(
      'PROWLARR_UNAUTHORIZED',
      'Prowlarr отклонил API-ключ (401/403)',
      response.status,
    );
  }

  if (!response.ok) {
    const detail = text.slice(0, 300).trim();
    throw new ProwlarrError(
      'PROWLARR_UNAVAILABLE',
      `Prowlarr вернул HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
      response.status,
    );
  }

  if (text.trim().length === 0) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProwlarrError('PROWLARR_UNAVAILABLE', 'Prowlarr вернул некорректный JSON');
  }
}

/** Newznab-тип запроса. `moviesearch` в API Prowlarr называется `movie`. */
function toApiType(type: ProwlarrSearchType | undefined): string {
  if (type === 'moviesearch') return 'movie';
  return type ?? 'search';
}

function extractItems(payload: unknown): ProwlarrReleaseResource[] | undefined {
  if (Array.isArray(payload)) return payload as ProwlarrReleaseResource[];
  // Защита от обёртки вида { releases: [...] } — в API v1 её нет, но форма дешёвая.
  if (payload && typeof payload === 'object') {
    const releases = (payload as { releases?: unknown }).releases;
    if (Array.isArray(releases)) return releases as ProwlarrReleaseResource[];
  }
  return undefined;
}

// --- Клиент ---------------------------------------------------------------

export function createProwlarrClient(
  cfg: AppConfig['prowlarr'],
  deps: ProwlarrClientDeps = {},
): ProwlarrClient {
  const fetchImpl = deps.fetch ?? globalThis.fetch;

  return {
    async search(params: ProwlarrSearchParams): Promise<ProwlarrSearchResult> {
      const { base, apiKey } = requireConnection(cfg);

      const url = new URL(`${base}/api/v1/search`);
      url.searchParams.set('query', params.query);
      url.searchParams.set('type', toApiType(params.type));
      url.searchParams.set('limit', String(params.limit ?? DEFAULT_LIMIT));
      url.searchParams.set('offset', String(params.offset ?? 0));
      // Повторяющиеся ключи — самый совместимый способ передать List<int>
      // в ASP.NET Core model binding.
      for (const indexerId of params.indexerIds ?? []) {
        url.searchParams.append('indexerIds', String(indexerId));
      }
      for (const category of params.categories ?? []) {
        url.searchParams.append('categories', String(category));
      }

      const payload = await requestJson<unknown>(url.toString(), apiKey, fetchImpl);
      const rawItems = extractItems(payload);
      if (rawItems === undefined) {
        throw new ProwlarrError(
          'PROWLARR_UNAVAILABLE',
          'Prowlarr вернул неожиданный формат ответа',
        );
      }

      const items: InternalRelease[] = [];
      const warnings: string[] = [];
      const warnedIndexers = new Set<string>();

      for (const raw of rawItems) {
        if (isErrorStub(raw)) {
          const label = stubLabel(raw);
          if (!warnedIndexers.has(label)) {
            warnedIndexers.add(label);
            const detail = optionalString(raw.error) ?? optionalString(raw.message);
            warnings.push(
              detail
                ? `Индексатор ${label}: ${detail}`
                : `Индексатор ${label} не вернул результатов (ошибка поиска)`,
            );
          }
          continue;
        }
        items.push(normalizeProwlarrRelease(raw));
      }

      return { items, warnings };
    },

    async getIndexers(): Promise<ProwlarrIndexer[]> {
      const { base, apiKey } = requireConnection(cfg);
      const payload = await requestJson<unknown>(`${base}/api/v1/indexer`, apiKey, fetchImpl);

      if (!Array.isArray(payload)) {
        throw new ProwlarrError('PROWLARR_UNAVAILABLE', 'Prowlarr вернул неожиданный список индексаторов');
      }

      const indexers: ProwlarrIndexer[] = [];
      for (const raw of payload as ProwlarrIndexerResource[]) {
        const id = optionalNumber(raw.id);
        const name = optionalString(raw.name);
        if (id === undefined || name === undefined) continue;
        indexers.push({
          id,
          name,
          enable: raw.enable !== false,
          protocol: optionalString(raw.protocol),
        });
      }
      return indexers;
    },
  };
}

/** Лёгкая проверка доступности Prowlarr. Полноценный клиент — createProwlarrClient. */
export async function checkHealth(cfg: AppConfig['prowlarr']): Promise<ServiceStatus> {
  if (!cfg.url || !cfg.apiKey) {
    const missing = !cfg.url ? 'PROWLARR_URL' : 'PROWLARR_API_KEY';
    return { ok: false, configured: false, message: `${missing} не задан` };
  }

  const startedAt = Date.now();
  const base = cfg.url.replace(/\/+$/, '');

  try {
    await fetchJson(`${base}/api/v1/system/status`, {
      headers: { 'x-api-key': cfg.apiKey },
    });
    return { ok: true, configured: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      message: error instanceof Error ? error.message : 'Неизвестная ошибка Prowlarr',
      latencyMs: Date.now() - startedAt,
    };
  }
}
