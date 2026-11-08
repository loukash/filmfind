import type { SearchResultDTO, TitleSummaryDTO } from '@filmfind/shared';
import { useQueries } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { isApiError } from '../api/client';
import { searchQueryOptions, useSearch, type SearchFilter } from '../api/queries';
import { AppHeader } from '../components/AppHeader';
import { PosterImage } from '../components/PosterImage';
import { TmdbAttribution } from '../components/TmdbAttribution';
import { navigate, searchPath, titlePath } from '../lib/router';
import { clearHistory, pushHistory, readHistory } from '../lib/searchHistory';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useMediaQuery } from '../lib/useMediaQuery';
import { Button, Chip, EmptyState, ErrorState, IconButton, Skeleton } from '../ui';
import { CloseIcon, SearchIcon } from '../ui/icons';

const DEBOUNCE_MS = 350;
const SKELETON_COUNT = 8;

/**
 * Потолок страниц: при загрузке ссылки `?page=N` предыдущие страницы
 * догружаются отдельными запросами, поэтому N должно быть ограничено —
 * иначе крафтовая ссылка `?page=500` устроит 499 запросов.
 */
const MAX_PAGE = 20;

const FILTERS: { value: SearchFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'movie', label: 'Фильмы' },
  { value: 'tv', label: 'Сериалы' },
  { value: 'animation', label: 'Мультфильмы' },
];

const GRID_CLASS = 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6';

/** Клиентский фильтр: серверный мультипоиск отдаёт фильмы и сериалы вперемешку. */
function matchesFilter(item: TitleSummaryDTO, filter: SearchFilter): boolean {
  switch (filter) {
    case 'movie':
      return item.type === 'movie';
    case 'tv':
      return item.type === 'tv';
    case 'animation':
      return item.isAnimation;
    default:
      return true;
  }
}

/** «1 результат», «2 результата», «5 результатов». */
function resultsLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) return `${count} результат`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} результата`;
  return `${count} результатов`;
}

/** Склеивает страницы по порядку, убирая повторы (TMDB иногда отдаёт их на стыке). */
function mergePages(pages: (SearchResultDTO | undefined)[]): TitleSummaryDTO[] {
  const seen = new Set<string>();
  const items: TitleSummaryDTO[] = [];

  for (const page of pages) {
    if (page === undefined) continue;
    for (const item of page.items) {
      const key = `${item.type}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }

  return items;
}

function readUrlState(): { q: string; page: number } {
  const params = new URLSearchParams(window.location.search);
  const rawPage = Number(params.get('page') ?? '1');
  const page =
    Number.isSafeInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, MAX_PAGE) : 1;

  return { q: params.get('q') ?? '', page };
}

export function Search() {
  useDocumentTitle('Поиск');

  const [query, setQuery] = useState(() => readUrlState().q);
  const [page, setPage] = useState(() => readUrlState().page);
  const [filter, setFilter] = useState<SearchFilter>('all');
  const [history, setHistory] = useState<string[]>(readHistory);

  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const trimmedQuery = debouncedQuery.trim();
  const hasQuery = trimmedQuery.length > 0;

  // Текущая страница — основной запрос. Предыдущие догружаем отдельными
  // запросами того же кэша: так ссылка `?page=3` и кнопка «назад» показывают
  // все страницы, а не только третью.
  const currentPage = useSearch(debouncedQuery, filter, page);
  const previousPages = useQueries({
    queries: Array.from({ length: Math.max(0, page - 1) }, (_, index) =>
      searchQueryOptions(trimmedQuery, index + 1),
    ),
  });

  const isDesktop = useMediaQuery('(hover: hover) and (pointer: fine)');
  const inputRef = useRef<HTMLInputElement>(null);

  /** Последний запрос, уже отражённый в адресе: защита от лишних replaceState. */
  const lastQueryRef = useRef(debouncedQuery);

  // Адрес — единственный источник ссылки: ?q=…&page=… обновляем без новой записи
  // истории, иначе «назад» пришлось бы нажимать по разу на символ.
  useEffect(() => {
    if (debouncedQuery !== lastQueryRef.current) {
      lastQueryRef.current = debouncedQuery;
      setPage(1);
      navigate(searchPath(debouncedQuery, 1), { replace: true });
      return;
    }

    navigate(searchPath(debouncedQuery, page), { replace: true });
  }, [debouncedQuery, page]);

  // Кнопка браузера «назад/вперёд» меняет адрес, но не состояние — синхронизируем.
  useEffect(() => {
    const onPopState = () => {
      const url = readUrlState();
      lastQueryRef.current = url.q;
      setQuery(url.q);
      setPage(url.page);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // В историю попадает только «дозревший» запрос, а не каждая буква.
  useEffect(() => {
    if (debouncedQuery.trim().length === 0) return;
    setHistory(pushHistory(debouncedQuery));
  }, [debouncedQuery]);

  const pageError: Error | null =
    currentPage.error ?? previousPages.find((item) => item.error)?.error ?? null;
  const tmdbNotConfigured = isApiError(pageError) && pageError.code === 'TMDB_NOT_CONFIGURED';

  // Пока грузится новая страница, предыдущие уже в кэше — сетка не пропадает.
  const items = hasQuery
    ? mergePages([
        ...previousPages.map((item) => item.data),
        currentPage.isPlaceholderData ? undefined : currentPage.data,
      ])
    : [];
  const visibleItems = items.filter((item) => matchesFilter(item, filter));

  const isPendingAny =
    currentPage.isPending ||
    currentPage.isPlaceholderData ||
    previousPages.some((item) => item.isPending);
  const showSkeletons = hasQuery && pageError === null && items.length === 0 && isPendingAny;

  const totalPages = currentPage.data?.totalPages ?? 1;
  const totalResults = currentPage.data?.totalResults ?? 0;
  const canLoadMore =
    hasQuery &&
    !currentPage.isPlaceholderData &&
    currentPage.data !== undefined &&
    page < Math.min(totalPages, MAX_PAGE);
  const isFetching = currentPage.isFetching || previousPages.some((item) => item.isFetching);

  const liveMessage =
    hasQuery && currentPage.data !== undefined && !currentPage.isPlaceholderData
      ? `Найдено ${resultsLabel(totalResults)}`
      : '';

  const clearQuery = () => {
    setQuery('');
    inputRef.current?.focus();
  };

  const clearHistoryItems = () => {
    clearHistory();
    setHistory([]);
  };

  const retry = () => {
    void currentPage.refetch();
    for (const item of previousPages) void item.refetch();
  };

  return (
    <div className="min-h-dvh bg-bg">
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-5 md:px-6">
        <AppHeader active="search" />

        <h1 className="sr-only">Поиск фильмов и сериалов</h1>

        <div className="mt-4">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              autoFocus={isDesktop}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') clearQuery();
              }}
              aria-label="Поиск фильмов и сериалов"
              placeholder="Найти фильм или сериал"
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
              className="h-12 w-full rounded-chip border border-line bg-surface pl-10 pr-12 text-[15px] text-fg placeholder:text-muted [&::-webkit-search-cancel-button]:appearance-none"
            />
            {query.length > 0 && (
              <IconButton
                label="Очистить поиск"
                onClick={clearQuery}
                className="absolute right-0.5 top-1/2 -translate-y-1/2"
              >
                <CloseIcon className="size-5" />
              </IconButton>
            )}
          </div>

          <div
            role="group"
            aria-label="Фильтр по типу"
            className="mt-3 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {FILTERS.map((entry) => (
              <Chip
                key={entry.value}
                active={filter === entry.value}
                onClick={() => setFilter(entry.value)}
                className="px-3.5 text-[13px]"
              >
                {entry.label}
              </Chip>
            ))}
          </div>
        </div>

        <p className="sr-only" aria-live="polite">
          {liveMessage}
        </p>

        <div className="mt-4">
          {tmdbNotConfigured ? (
            <ErrorState
              title="TMDB не настроен"
              description="Добавьте TMDB_API_KEY в .env и перезапустите сервер."
            />
          ) : pageError !== null ? (
            <ErrorState
              title="Не удалось выполнить поиск"
              description={
                isApiError(pageError)
                  ? pageError.message
                  : 'Сервер не ответил. Проверьте подключение.'
              }
              action={
                <Button size="sm" className="min-h-11" onClick={retry}>
                  Повторить
                </Button>
              }
            />
          ) : showSkeletons ? (
            <div className={GRID_CLASS} aria-busy="true">
              {Array.from({ length: SKELETON_COUNT }, (_, index) => (
                <Skeleton key={index} className="aspect-[2/3] w-full rounded-card" />
              ))}
            </div>
          ) : !hasQuery ? (
            <EmptyState
              title="Начните поиск"
              description="Введите название фильма или сериала — покажем, что можно скачать."
              action={
                history.length > 0 ? (
                  <div className="w-full">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                        Недавние запросы
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-11"
                        onClick={clearHistoryItems}
                      >
                        Очистить
                      </Button>
                    </div>
                    <div className="mt-2 flex flex-wrap justify-center gap-2">
                      {history.map((item) => (
                        <Chip key={item} onClick={() => setQuery(item)}>
                          {item}
                        </Chip>
                      ))}
                    </div>
                  </div>
                ) : undefined
              }
            />
          ) : visibleItems.length === 0 ? (
            <EmptyState
              title="Ничего не найдено"
              description={
                filter === 'all'
                  ? 'Попробуйте изменить запрос.'
                  : 'Попробуйте изменить запрос или снять фильтр.'
              }
              action={
                filter === 'all' ? undefined : (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="min-h-11"
                    onClick={() => setFilter('all')}
                  >
                    Сбросить фильтр
                  </Button>
                )
              }
            />
          ) : (
            <>
              <ul className={`${GRID_CLASS} list-none p-0`}>
                {visibleItems.map((item) => (
                  <li key={`${item.type}:${item.id}`}>
                    <button
                      type="button"
                      onClick={() => navigate(titlePath(item.type, item.id))}
                      aria-label={`${item.title}${item.year === undefined ? '' : `, ${item.year}`}${
                        item.isAnimation ? ', мультфильм' : ''
                      }`}
                      className="block w-full rounded-card text-left transition-transform duration-200 hover:-translate-y-0.5"
                    >
                      <PosterImage title={item.title} year={item.year} path={item.posterPath} />
                    </button>
                  </li>
                ))}
              </ul>

              {canLoadMore && (
                <div className="mt-6 flex justify-center">
                  <Button
                    variant="secondary"
                    size="lg"
                    loading={isFetching}
                    onClick={() => setPage(page + 1)}
                  >
                    Показать ещё
                  </Button>
                </div>
              )}
            </>
          )}

          <TmdbAttribution className="mt-10" />
        </div>
      </div>
    </div>
  );
}
