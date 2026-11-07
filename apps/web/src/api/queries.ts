import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { TitleType } from '@filmfind/shared';
import {
  addTorrent,
  getHealth,
  getReleases,
  getTitle,
  getTorrents,
  searchTitles,
  type AddTorrentBody,
  type ReleasesParams,
} from './client';

/**
 * Хуки TanStack Query. Ключи собраны в одном месте, чтобы инвалидация после
 * мутаций не разъезжалась с местами, где данные читаются.
 */

/** Клиентский фильтр выдачи: серверный `/search/multi` отдаёт всё подряд. */
export type SearchFilter = 'all' | 'movie' | 'tv' | 'animation';

export const queryKeys = {
  health: ['health'] as const,
  search: (q: string, page: number) => ['search', q, page] as const,
  title: (type: TitleType, id: number) => ['title', type, id] as const,
  releases: (params: ReleasesParams) => ['releases', params] as const,
  torrents: ['torrents'] as const,
};

/**
 * Опции одной страницы поиска. Вынесены отдельно, чтобы «Показать ещё» могло
 * догрузить предыдущие страницы тем же кэшем и теми же настройками.
 *
 * `filter` в опциях нет: он применяется на клиенте (см. `matchesFilter`),
 * иначе переключение «Фильмы / Сериалы» дёргало бы сеть заново.
 */
export function searchQueryOptions(q: string, page: number) {
  const trimmed = q.trim();

  return queryOptions({
    queryKey: queryKeys.search(trimmed, page),
    queryFn: ({ signal }) => searchTitles(trimmed, page, signal),
    enabled: trimmed.length > 0,
    staleTime: 60_000,
  });
}

/**
 * Поиск тайтлов. `placeholderData` держит предыдущую страницу на экране, пока
 * грузится новая.
 */
export function useSearch(q: string, filter: SearchFilter, page: number) {
  return useQuery({
    ...searchQueryOptions(q, page),
    placeholderData: keepPreviousData,
  });
}

/** Подробности тайтла. */
export function useTitle(type: TitleType, id: number) {
  return useQuery({
    queryKey: queryKeys.title(type, id),
    queryFn: ({ signal }) => getTitle(type, id, signal),
    enabled: Number.isSafeInteger(id) && id > 0,
    staleTime: 5 * 60_000,
  });
}

/** Раздачи из Prowlarr по тайтлу или свободному запросу. */
export function useReleases(params: ReleasesParams) {
  const hasQuery = params.titleId !== undefined || (params.q?.trim().length ?? 0) > 0;

  return useQuery({
    queryKey: queryKeys.releases(params),
    queryFn: ({ signal }) => getReleases(params, signal),
    enabled: hasQuery,
    staleTime: 60_000,
  });
}

/**
 * Здоровье сервисов. Опрос каждые 30 с; в фоновой вкладке не опрашиваем —
 * `refetchIntervalInBackground` по умолчанию `false`.
 */
export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => getHealth(signal),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/** Постановка раздачи в Transmission. После успеха обновляем список загрузок. */
export function useAddTorrent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: AddTorrentBody) => addTorrent(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.torrents });
    },
  });
}

/** Список загрузок: опрос каждые 5 с, только пока вкладка активна. */
export function useTorrents() {
  return useQuery({
    queryKey: queryKeys.torrents,
    queryFn: ({ signal }) => getTorrents(signal),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}
