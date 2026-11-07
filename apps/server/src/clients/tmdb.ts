import type {
  SearchResultDTO,
  ServiceStatus,
  TitleDetailsDTO,
  TitleSummaryDTO,
  TitleType,
} from '@filmfind/shared';
import type { AppConfig as Config } from '../config.js';
import { fetchJson } from '../lib/http.js';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const REQUEST_TIMEOUT_MS = 8000;
const ANIMATION_GENRE_ID = 16;

export type TmdbErrorCode =
  | 'TMDB_NOT_CONFIGURED'
  | 'TMDB_NOT_FOUND'
  | 'TMDB_UNAUTHORIZED'
  | 'TMDB_UNAVAILABLE';

/** Типизированная ошибка клиента TMDB: код понятен роутам и health-проверке. */
export class TmdbError extends Error {
  override name = 'TmdbError';

  constructor(
    readonly code: TmdbErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface TmdbClient {
  searchMulti(query: string, page?: number): Promise<SearchResultDTO>;
  getTitle(type: TitleType, id: number): Promise<TitleDetailsDTO>;
}

export interface TmdbClientDeps {
  fetch?: typeof fetch;
}

/**
 * Лёгкая проверка доступности TMDB для /api/health.
 * Полноценный клиент создаётся через createTmdbClient.
 */
export async function checkHealth(cfg: Config['tmdb']): Promise<ServiceStatus> {
  if (!cfg.apiKey) {
    return { ok: false, configured: false, message: 'TMDB_API_KEY не задан' };
  }

  const startedAt = Date.now();
  const language = encodeURIComponent(cfg.language);
  const url = cfg.bearer
    ? `https://api.themoviedb.org/3/configuration?language=${language}`
    : `https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(cfg.apiKey)}&language=${language}`;

  try {
    await fetchJson(url, {
      headers: cfg.bearer ? { authorization: `Bearer ${cfg.apiKey}` } : {},
    });
    return { ok: true, configured: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      message: error instanceof Error ? error.message : 'Неизвестная ошибка TMDB',
      latencyMs: Date.now() - startedAt,
    };
  }
}

// --- Сырые ответы TMDB v3 -------------------------------------------------
// Описаны только используемые поля. Необязательные — потому что TMDB
// возвращает null/пустые строки для отсутствующих данных.

interface TmdbSearchItem {
  id?: number;
  media_type?: string;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string | null;
  first_air_date?: string | null;
  poster_path?: string | null;
  vote_average?: number | null;
  genre_ids?: number[];
}

interface TmdbSearchResponse {
  page?: number;
  total_pages?: number;
  total_results?: number;
  results?: TmdbSearchItem[];
}

interface TmdbGenre {
  id?: number;
  name?: string;
}

interface TmdbSeason {
  season_number?: number;
  name?: string;
  episode_count?: number;
  air_date?: string | null;
}

interface TmdbExternalIds {
  imdb_id?: string | null;
}

interface TmdbDetailsResponse {
  id?: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string | null;
  first_air_date?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  vote_average?: number | null;
  genres?: TmdbGenre[];
  runtime?: number | null;
  episode_run_time?: number[];
  seasons?: TmdbSeason[];
  status?: string;
  external_ids?: TmdbExternalIds;
}

// --- Маппинг --------------------------------------------------------------

function toYear(date: string | null | undefined): number | undefined {
  if (typeof date !== 'string') return undefined;
  const match = /^(\d{4})/.exec(date);
  if (!match?.[1]) return undefined;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : undefined;
}

function toRating(vote: number | null | undefined): number | undefined {
  if (typeof vote !== 'number' || !Number.isFinite(vote) || vote <= 0) return undefined;
  return Math.round(vote * 10) / 10;
}

function toPath(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function toText(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function toRuntime(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value);
}

function mapSearchItem(item: TmdbSearchItem): TitleSummaryDTO | undefined {
  const type: TitleType | undefined =
    item.media_type === 'movie' ? 'movie' : item.media_type === 'tv' ? 'tv' : undefined;
  if (!type || typeof item.id !== 'number') return undefined;

  const localized = type === 'movie' ? item.title : item.name;
  const original = type === 'movie' ? item.original_title : item.original_name;
  const title = localized ?? original;
  if (!title) return undefined;

  return {
    id: item.id,
    type,
    title,
    originalTitle: original ?? title,
    year: toYear(type === 'movie' ? item.release_date : item.first_air_date),
    posterPath: toPath(item.poster_path),
    rating: toRating(item.vote_average),
    isAnimation: Array.isArray(item.genre_ids) && item.genre_ids.includes(ANIMATION_GENRE_ID),
  };
}

function mapGenres(genres: TmdbGenre[] | undefined): { id: number; name: string }[] {
  if (!Array.isArray(genres)) return [];
  return genres
    .filter(
      (genre): genre is { id: number; name: string } =>
        typeof genre.id === 'number' && typeof genre.name === 'string',
    )
    .map((genre) => ({ id: genre.id, name: genre.name }));
}

function mapSeasons(
  seasons: TmdbSeason[] | undefined,
): TitleDetailsDTO['seasons'] {
  if (!Array.isArray(seasons)) return undefined;
  return seasons.map((season) => ({
    seasonNumber: typeof season.season_number === 'number' ? season.season_number : 0,
    name: season.name ?? '',
    episodeCount: typeof season.episode_count === 'number' ? season.episode_count : 0,
    airDate: toPath(season.air_date),
  }));
}

function mapDetails(raw: TmdbDetailsResponse, type: TitleType, id: number): TitleDetailsDTO {
  const localized = type === 'movie' ? raw.title : raw.name;
  const original = type === 'movie' ? raw.original_title : raw.original_name;
  const title = localized ?? original ?? '';
  const genres = mapGenres(raw.genres);
  const runtime =
    type === 'movie' ? toRuntime(raw.runtime) : toRuntime(raw.episode_run_time?.[0]);

  return {
    id: typeof raw.id === 'number' ? raw.id : id,
    type,
    title,
    originalTitle: original ?? title,
    year: toYear(type === 'movie' ? raw.release_date : raw.first_air_date),
    posterPath: toPath(raw.poster_path),
    rating: toRating(raw.vote_average),
    isAnimation: genres.some((genre) => genre.id === ANIMATION_GENRE_ID),
    overview: toText(raw.overview),
    backdropPath: toPath(raw.backdrop_path),
    genres,
    runtime,
    seasons: type === 'tv' ? mapSeasons(raw.seasons) : undefined,
    imdbId: toText(raw.external_ids?.imdb_id),
    status: toText(raw.status),
  };
}

// --- Клиент ---------------------------------------------------------------

interface TmdbRequestParams {
  [key: string]: string | number | undefined;
}

export function createTmdbClient(cfg: Config, deps: TmdbClientDeps = {}): TmdbClient {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const language = cfg.tmdb.language || 'ru-RU';

  async function requestJson<T>(path: string, params: TmdbRequestParams = {}): Promise<T> {
    const apiKey = cfg.tmdb.apiKey;
    if (!apiKey) {
      throw new TmdbError('TMDB_NOT_CONFIGURED', 'TMDB_API_KEY не задан');
    }

    const url = new URL(`${TMDB_BASE_URL}${path}`);
    url.searchParams.set('language', language);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { accept: 'application/json' };
    // v4-токен уходит заголовком, v3-ключ — query-параметром.
    if (apiKey.startsWith('eyJ')) {
      headers.authorization = `Bearer ${apiKey}`;
    } else {
      url.searchParams.set('api_key', apiKey);
    }

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const reason =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
          ? 'таймаут запроса'
          : 'сетевая ошибка';
      throw new TmdbError('TMDB_UNAVAILABLE', `TMDB недоступен: ${reason}`);
    }

    if (response.status === 401) {
      throw new TmdbError('TMDB_UNAUTHORIZED', 'TMDB отклонил ключ API (401)', 401);
    }
    if (response.status === 404) {
      throw new TmdbError('TMDB_NOT_FOUND', 'Тайтл не найден в TMDB', 404);
    }
    if (!response.ok) {
      throw new TmdbError(
        'TMDB_UNAVAILABLE',
        `TMDB вернул HTTP ${response.status}`,
        response.status,
      );
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new TmdbError('TMDB_UNAVAILABLE', 'TMDB вернул некорректный JSON', response.status);
    }
  }

  return {
    async searchMulti(query: string, page = 1): Promise<SearchResultDTO> {
      const requestedPage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;
      const raw = await requestJson<TmdbSearchResponse>('/search/multi', {
        query,
        page: requestedPage,
        include_adult: 'false',
      });

      const items: TitleSummaryDTO[] = [];
      for (const item of raw.results ?? []) {
        const mapped = mapSearchItem(item);
        if (mapped) items.push(mapped);
      }

      return {
        page: typeof raw.page === 'number' ? raw.page : requestedPage,
        totalPages: typeof raw.total_pages === 'number' ? raw.total_pages : 0,
        totalResults: typeof raw.total_results === 'number' ? raw.total_results : 0,
        items,
      };
    },

    async getTitle(type: TitleType, id: number): Promise<TitleDetailsDTO> {
      const raw = await requestJson<TmdbDetailsResponse>(`/${type}/${id}`, {
        append_to_response: 'external_ids',
      });
      return mapDetails(raw, type, id);
    },
  };
}
