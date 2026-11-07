import {
  normalizeReleaseTitle,
  type ReleaseDTO,
  type ReleasesResponseDTO,
  type TitleDetailsDTO,
  type TitleType,
} from '@filmfind/shared';
import type {
  InternalRelease,
  ProwlarrClient,
  ProwlarrSearchParams,
} from '../clients/prowlarr.js';
import type { TmdbClient } from '../clients/tmdb.js';
import { LruCache } from './lru.js';
import { rememberReleases } from './release-store.js';

/** Категории Newznab, которые использует сервис. */
export const NEWZNAB_MOVIES = 2000;
export const NEWZNAB_TV = 5000;
export const NEWZNAB_ANIME = 5070;

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 300;
const CACHE_TTL_MS = 3 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

export interface ReleasesQuery {
  type: TitleType;
  titleId?: number;
  season?: number;
  /** Свободный поиск: если задан, TMDB не нужен. */
  q?: string;
  indexerIds?: number[];
  limit?: number;
}

export type ReleasesErrorCode = 'BAD_REQUEST' | 'TMDB_NOT_CONFIGURED';

export class ReleasesError extends Error {
  override name = 'ReleasesError';

  constructor(
    readonly code: ReleasesErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Результат сервиса: публичная часть плюс внутренние поля (магнит) для волны 2. */
export interface ReleasesResult extends ReleasesResponseDTO {
  internal: InternalRelease[];
}

export interface ReleasesServiceDeps {
  /** Не нужен, если поиск идёт по свободному запросу `q`. */
  tmdb?: TmdbClient;
  prowlarr: ProwlarrClient;
  cache?: LruCache<string, ReleasesResult>;
}

export interface ReleasesService {
  find(query: ReleasesQuery): Promise<ReleasesResult>;
}

// --- Варианты запроса -----------------------------------------------------

/** Собирает варианты поисковых запросов: локализованное, оригинальное, с годом/сезоном. */
export function buildSearchVariants(
  query: ReleasesQuery,
  title?: Pick<TitleDetailsDTO, 'title' | 'originalTitle' | 'year'>,
): string[] {
  const freeQuery = query.q?.trim();
  if (freeQuery) return [freeQuery];

  if (!title) {
    throw new ReleasesError('BAD_REQUEST', 'Нужен либо q, либо titleId существующего тайтла');
  }

  const variants: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | undefined): void => {
    const text = value?.trim();
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    variants.push(text);
  };

  push(title.title);
  if (normalizeReleaseTitle(title.originalTitle) !== normalizeReleaseTitle(title.title)) {
    push(title.originalTitle);
  }

  if (query.type === 'movie') {
    if (title.year !== undefined) push(`${title.title} ${title.year}`);
  } else if (query.season !== undefined) {
    const padded = String(query.season).padStart(2, '0');
    push(`${title.title} S${padded}`);
    push(`${title.title} ${query.season} сезон`);
  }

  return variants;
}

/** Категории Newznab: аниме добавляется к категории типа, а не заменяет её. */
export function resolveCategories(type: TitleType, isAnimation: boolean): number[] {
  const base = type === 'movie' ? NEWZNAB_MOVIES : NEWZNAB_TV;
  return isAnimation ? [base, NEWZNAB_ANIME] : [base];
}

// --- Дедупликация ---------------------------------------------------------

function seedersOf(release: InternalRelease): number {
  return release.seeders ?? -1;
}

function publishTimeOf(release: InternalRelease): number {
  if (!release.publishDate) return 0;
  const time = Date.parse(release.publishDate);
  return Number.isFinite(time) ? time : 0;
}

/** Ключ дедупликации: infoHash, иначе нормализованное название + размер. */
export function releaseDedupeKey(release: InternalRelease): string {
  if (release.infoHash) return `hash:${release.infoHash.toLowerCase()}`;
  return `title:${normalizeReleaseTitle(release.title)}:${release.size}`;
}

/** Из дублей остаётся запись с большим числом сидов, при равенстве — более поздняя. */
function isBetterRelease(candidate: InternalRelease, current: InternalRelease): boolean {
  const candidateSeeders = seedersOf(candidate);
  const currentSeeders = seedersOf(current);
  if (candidateSeeders !== currentSeeders) return candidateSeeders > currentSeeders;
  return publishTimeOf(candidate) > publishTimeOf(current);
}

export function dedupeReleases(releases: InternalRelease[]): InternalRelease[] {
  const byKey = new Map<string, InternalRelease>();
  for (const release of releases) {
    const key = releaseDedupeKey(release);
    const current = byKey.get(key);
    if (!current || isBetterRelease(release, current)) byKey.set(key, release);
  }
  return [...byKey.values()];
}

// --- Фильтрация шума ------------------------------------------------------

const YEAR_PATTERN = /(?:19|20)\d{2}/g;

export function extractYears(title: string): number[] {
  const matches = title.match(YEAR_PATTERN);
  if (!matches) return [];
  return matches.map(Number).filter((year) => Number.isFinite(year));
}

/** Год в названии допускается в пределах ±1 от года тайтла. */
export function matchesYear(title: string, year: number): boolean {
  const years = extractYears(title);
  if (years.length === 0) return true;
  return years.some((found) => Math.abs(found - year) <= 1);
}

const SEASON_PATTERNS: RegExp[] = [
  /\bs(\d{1,2})(?:e\d{1,3})?\b/gi,
  /(\d{1,2})\s*сезон/gi,
  /сезон\s*(\d{1,2})/gi,
  /\bseason\s*(\d{1,2})\b/gi,
  /\[(\d{1,2})x\d{1,3}\]/g,
];

export function extractSeasons(title: string): number[] {
  const seasons = new Set<number>();
  for (const pattern of SEASON_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(title)) !== null) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0 && value <= 100) seasons.add(value);
    }
  }
  return [...seasons];
}

/**
 * Сезон в названии должен совпадать с запрошенным.
 * Если сезон не указан вовсе — раздачу оставляем: не все трекеры его пишут.
 */
export function matchesSeason(
  title: string,
  season: number,
  qualitySeason?: number,
): boolean {
  const seasons = new Set(extractSeasons(title));
  if (typeof qualitySeason === 'number' && qualitySeason > 0) seasons.add(qualitySeason);
  if (seasons.size === 0) return true;
  return seasons.has(season);
}

export function filterReleases(
  releases: InternalRelease[],
  query: ReleasesQuery,
  title?: Pick<TitleDetailsDTO, 'year'>,
): InternalRelease[] {
  return releases.filter((release) => {
    if (query.type === 'movie' && title?.year !== undefined) {
      if (!matchesYear(release.title, title.year)) return false;
    }
    if (query.type === 'tv' && query.season !== undefined) {
      if (!matchesSeason(release.title, query.season, release.quality?.season)) return false;
    }
    return true;
  });
}

// --- Сортировка -----------------------------------------------------------

const RESOLUTION_RANK: Record<string, number> = {
  '2160p': 5,
  '1080p': 4,
  '720p': 3,
  '576p': 2,
  '480p': 1,
};

/**
 * Ранг разрешения. Основной источник — `quality.resolution` из parseRelease;
 * пока тот не реализован, подстраховываемся разбором названия.
 */
export function resolutionRank(release: InternalRelease): number {
  const parsed = release.quality?.resolution;
  if (parsed) return RESOLUTION_RANK[parsed] ?? 0;
  const match = /(2160|1080|720|576|480)p/i.exec(release.title);
  return match?.[1] ? (RESOLUTION_RANK[`${match[1]}p`] ?? 0) : 0;
}

/** Сиды по убыванию → разрешение по убыванию → размер по убыванию. */
export function sortReleases(releases: InternalRelease[]): InternalRelease[] {
  return [...releases].sort(
    (a, b) =>
      seedersOf(b) - seedersOf(a) ||
      resolutionRank(b) - resolutionRank(a) ||
      b.size - a.size,
  );
}

// --- Публичное представление ----------------------------------------------

/** Отбрасывает magnetUrl/downloadUrl: в них зашит API-ключ Prowlarr. */
export function toPublicRelease(release: InternalRelease): ReleaseDTO {
  const { magnetUrl: _magnetUrl, downloadUrl: _downloadUrl, ...publicRelease } = release;
  return publicRelease;
}

// --- Сервис ---------------------------------------------------------------

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

function cacheKeyOf(query: ReleasesQuery, limit: number): string {
  return JSON.stringify({
    type: query.type,
    titleId: query.titleId ?? null,
    season: query.season ?? null,
    q: query.q?.trim().toLowerCase() ?? null,
    indexerIds: query.indexerIds?.length ? [...query.indexerIds].sort((a, b) => a - b) : null,
    limit,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'неизвестная ошибка';
}

export function createReleasesService(deps: ReleasesServiceDeps): ReleasesService {
  const cache =
    deps.cache ?? new LruCache<string, ReleasesResult>({ max: CACHE_MAX_ENTRIES, ttlMs: CACHE_TTL_MS });

  return {
    async find(query: ReleasesQuery): Promise<ReleasesResult> {
      const limit = clampLimit(query.limit);
      const key = cacheKeyOf(query, limit);
      const cached = cache.get(key);
      if (cached) return cached;

      const freeQuery = query.q?.trim();

      let title: TitleDetailsDTO | undefined;
      if (!freeQuery) {
        if (query.titleId === undefined) {
          throw new ReleasesError('BAD_REQUEST', 'Нужен либо q, либо titleId');
        }
        if (!deps.tmdb) {
          throw new ReleasesError('TMDB_NOT_CONFIGURED', 'TMDB_API_KEY не задан');
        }
        title = await deps.tmdb.getTitle(query.type, query.titleId);
      }

      const categories = resolveCategories(query.type, title?.isAnimation === true);
      const variants = buildSearchVariants(query, title);

      const requests: ProwlarrSearchParams[] = variants.map((variant) => ({
        query: variant,
        categories,
        indexerIds: query.indexerIds,
        limit,
        // Свободный поиск по строке: сезон и год уже внутри запроса,
        // поэтому tvsearch/movie здесь не нужны.
        type: 'search',
      }));

      const settled = await Promise.allSettled(
        requests.map((request) => deps.prowlarr.search(request)),
      );

      const warnings: string[] = [];
      const collected: InternalRelease[] = [];
      let fulfilled = 0;
      let firstError: unknown;

      settled.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          fulfilled += 1;
          collected.push(...result.value.items);
          warnings.push(...result.value.warnings);
          return;
        }
        firstError ??= result.reason;
        warnings.push(
          `Поиск «${requests[index]?.query ?? ''}» не удался: ${errorMessage(result.reason)}`,
        );
      });

      // Если не ответил ни один вариант — отдаём ошибку наверх, роут выберет статус.
      if (fulfilled === 0) throw firstError;

      const filtered = filterReleases(collected, query, title);
      const sorted = sortReleases(dedupeReleases(filtered));
      const internal = sorted.slice(0, limit);
      rememberReleases(internal);

      const result: ReleasesResult = {
        items: internal.map(toPublicRelease),
        warnings: [...new Set(warnings)],
        internal,
      };

      cache.set(key, result);
      return result;
    },
  };
}
