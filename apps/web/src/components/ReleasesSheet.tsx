import type { ReleaseDTO, TitleType } from '@filmfind/shared';
import { useMemo, useState } from 'react';
import { isApiError } from '../api/client';
import { useReleases } from '../api/queries';
import { Button, Card, Chip, EmptyState, ErrorState, Sheet, Skeleton } from '../ui';
import { AlertIcon } from '../ui/icons';
import { ReleaseCard } from './ReleaseCard';

type ResolutionFilter = 'all' | '2160p' | '1080p' | '720p' | 'below';
type SeedsFilter = 0 | 5 | 20;
type SortKey = 'seeders' | 'size' | 'date';

const RESOLUTIONS: { value: ResolutionFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: '2160p', label: '2160p' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: 'below', label: 'Ниже' },
];

const SEEDS: { value: SeedsFilter; label: string }[] = [
  { value: 0, label: 'Любые' },
  { value: 5, label: '5+ сидов' },
  { value: 20, label: '20+ сидов' },
];

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'seeders', label: 'Сначала сиды' },
  { value: 'size', label: 'Сначала размер' },
  { value: 'date', label: 'Сначала новые' },
];

const CAM_SOURCES = new Set(['CAM', 'TS', 'TC']);
const SKELETON_COUNT = 4;

/** «1 раздача», «2 раздачи», «5 раздач». */
function releasesLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) return `${count} раздача`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} раздачи`;
  return `${count} раздач`;
}

function sortValue(release: ReleaseDTO, key: SortKey): number {
  switch (key) {
    case 'size':
      return release.size;
    case 'date': {
      const time = release.publishDate === undefined ? Number.NaN : Date.parse(release.publishDate);
      return Number.isNaN(time) ? 0 : time;
    }
    default:
      return release.seeders ?? 0;
  }
}

export interface ReleasesSheetProps {
  onClose: () => void;
  type: TitleType;
  titleId: number;
  titleName: string;
  /** Сезон выбран в карточке тайтла; для фильмов не задаётся. */
  season?: number;
}

/**
 * Экран раздач: тот же `Sheet`, что в стайлгайде — снизу на мобильном,
 * по центру с ограниченной шириной на десктопе. Фильтры и сортировка
 * клиентские: выдача Prowlarr уже получена одним запросом.
 */
export function ReleasesSheet({ onClose, type, titleId, titleName, season }: ReleasesSheetProps) {
  const [resolution, setResolution] = useState<ResolutionFilter>('all');
  const [minSeeders, setMinSeeders] = useState<SeedsFilter>(0);
  const [indexer, setIndexer] = useState('all');
  const [noCam, setNoCam] = useState(false);
  const [sort, setSort] = useState<SortKey>('seeders');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const query = useReleases({ type, titleId, season, limit: 150 });

  const items = query.data?.items ?? [];
  const warnings = query.data?.warnings ?? [];

  const indexers = useMemo(() => {
    const unique = new Set<string>();
    for (const item of items) {
      if (item.indexer !== undefined && item.indexer.length > 0) unique.add(item.indexer);
    }
    return [...unique].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [items]);

  const visible = useMemo(() => {
    const filtered = items.filter((release) => {
      if (resolution !== 'all') {
        const value = release.quality.resolution;
        if (resolution === 'below') {
          if (value !== '480p' && value !== '576p') return false;
        } else if (value !== resolution) {
          return false;
        }
      }

      if ((release.seeders ?? 0) < minSeeders) return false;
      if (indexer !== 'all' && release.indexer !== indexer) return false;

      const source = release.quality.source;
      if (noCam && source !== undefined && CAM_SOURCES.has(source)) return false;

      return true;
    });

    return filtered.sort((a, b) => {
      const diff = sortValue(b, sort) - sortValue(a, sort);
      return diff !== 0 ? diff : (b.seeders ?? 0) - (a.seeders ?? 0);
    });
  }, [items, resolution, minSeeders, indexer, noCam, sort]);

  const resetFilters = () => {
    setResolution('all');
    setMinSeeders(0);
    setIndexer('all');
    setNoCam(false);
    setSort('seeders');
  };

  const activeFilters =
    (resolution !== 'all' ? 1 : 0) +
    (minSeeders > 0 ? 1 : 0) +
    (indexer !== 'all' ? 1 : 0) +
    (noCam ? 1 : 0);

  const error = query.error;
  const prowlarrMissing = isApiError(error) && error.code === 'PROWLARR_NOT_CONFIGURED';
  const isLoaded = query.data !== undefined;

  const title = isLoaded ? `Раздачи · ${visible.length}` : 'Раздачи';

  return (
    <Sheet open onClose={onClose} title={title}>
      <div className="sticky top-0 z-10 -mx-4 space-y-2 border-b border-line bg-surface px-4 pb-3">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="min-h-11 shrink-0"
            aria-expanded={filtersOpen}
            aria-controls="releases-filters"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            Фильтры{activeFilters > 0 ? ` · ${activeFilters}` : ''}
          </Button>

          <select
            aria-label="Сортировка"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className="h-11 min-w-0 flex-1 rounded-chip border border-line bg-bg px-3 text-[13px] text-fg"
          >
            {SORTS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>

        {filtersOpen && (
          <div id="releases-filters" className="space-y-2">
            <div
              role="group"
              aria-label="Разрешение"
              className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {RESOLUTIONS.map((entry) => (
                <Chip
                  key={entry.value}
                  active={resolution === entry.value}
                  onClick={() => setResolution(entry.value)}
                  className="px-3 text-[13px]"
                >
                  {entry.label}
                </Chip>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {SEEDS.map((entry) => (
                <Chip
                  key={entry.value}
                  active={minSeeders === entry.value}
                  onClick={() => setMinSeeders(entry.value)}
                  className="px-3 text-[13px]"
                >
                  {entry.label}
                </Chip>
              ))}

              <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-chip border border-line px-3 text-[13px] font-medium text-muted has-[:checked]:border-accent has-[:checked]:text-fg">
                <input
                  type="checkbox"
                  checked={noCam}
                  onChange={(event) => setNoCam(event.target.checked)}
                  className="size-4 accent-accent"
                />
                Без CAM/TS
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <select
                aria-label="Трекер"
                value={indexer}
                onChange={(event) => setIndexer(event.target.value)}
                className="h-11 min-w-0 flex-1 rounded-chip border border-line bg-bg px-3 text-[13px] text-fg"
              >
                <option value="all">Все трекеры</option>
                {indexers.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>

              {activeFilters > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11 shrink-0"
                  onClick={resetFilters}
                >
                  Сбросить
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {isLoaded ? `Найдено ${releasesLabel(visible.length)}` : ''}
      </p>

      <div className="mt-3 space-y-3 pb-2">
        {warnings.length > 0 && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-chip border border-warn/30 bg-warn/15 px-3 py-2 text-xs leading-snug text-warn"
          >
            <AlertIcon className="mt-0.5 size-4 shrink-0" />
            <span>Часть индексаторов недоступна</span>
          </div>
        )}

        {prowlarrMissing ? (
          <ErrorState
            title="Prowlarr не настроен"
            description="Добавьте PROWLARR_URL и PROWLARR_API_KEY в .env и перезапустите сервер."
          />
        ) : error !== null ? (
          <ErrorState
            title="Не удалось загрузить раздачи"
            description={
              isApiError(error) ? error.message : 'Сервер не ответил. Проверьте подключение.'
            }
            action={
              <Button size="sm" className="min-h-11" onClick={() => void query.refetch()}>
                Повторить
              </Button>
            }
          />
        ) : query.isPending ? (
          <div className="space-y-3" aria-busy="true">
            {Array.from({ length: SKELETON_COUNT }, (_, index) => (
              <Card key={index} className="space-y-3 p-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
                <div className="flex gap-1.5">
                  <Skeleton className="h-5 w-14" />
                  <Skeleton className="h-5 w-12" />
                  <Skeleton className="h-5 w-10" />
                </div>
                <Skeleton className="h-3 w-1/2" />
              </Card>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            title="Раздач не найдено"
            description={
              items.length > 0
                ? 'Под текущие фильтры ничего не подошло. Попробуйте их ослабить.'
                : `Для «${titleName}» пока нет раздач. Попробуйте другой сезон.`
            }
            action={
              <Button
                variant="secondary"
                size="sm"
                className="min-h-11"
                onClick={resetFilters}
              >
                Сбросить фильтры
              </Button>
            }
          />
        ) : (
          <ul className="list-none space-y-3 p-0">
            {visible.map((release) => (
              <li key={release.id}>
                <ReleaseCard release={release} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
