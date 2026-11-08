import type { TitleType } from '@filmfind/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { isApiError, posterUrl } from '../api/client';
import { useTitle } from '../api/queries';
import { AppHeader } from '../components/AppHeader';
import { ExpandableText } from '../components/ExpandableText';
import { PosterImage } from '../components/PosterImage';
import { TmdbAttribution } from '../components/TmdbAttribution';
import { ReleasesSheet } from '../components/ReleasesSheet';
import { useAuthedImage } from '../lib/useAuthedImage';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { Button, Chip, ErrorState, Skeleton } from '../ui';

export interface TitleProps {
  type: TitleType;
  id: number;
}

const BACKDROP_STYLE = {
  background:
    'radial-gradient(120% 90% at 25% 15%, color-mix(in oklab, var(--accent) 18%, transparent) 0%, transparent 60%), linear-gradient(155deg, var(--surface-2) 0%, var(--surface) 45%, var(--bg) 100%)',
} as const;

/** «1 сезон», «2 сезона», «5 сезонов». */
function seasonsWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) return 'сезон';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'сезона';
  return 'сезонов';
}

/** Жанр — не действие, поэтому не `Chip`-кнопка, а такая же по виду метка. */
function GenreTag({ children }: { children: string }) {
  return (
    <span className="inline-flex h-9 items-center rounded-chip border border-line px-3.5 text-[13px] text-muted">
      {children}
    </span>
  );
}

function TitleSkeleton() {
  return (
    <div aria-busy="true" className="flex items-end gap-3 -mt-16 md:-mt-20">
      <Skeleton className="aspect-[2/3] w-24 shrink-0 rounded-card md:w-28" />
      <div className="min-w-0 flex-1 space-y-2 pb-2">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

/**
 * Карточка тайтла: backdrop, постер, метаданные, описание, сезоны и переход
 * к раздачам. Раздачи открываются `Sheet`-ом поверх экрана, поэтому состояние
 * «какой сезон выбран» остаётся здесь.
 */
export function Title({ type, id }: TitleProps) {
  const query = useTitle(type, id);
  const data = query.data;

  const notFound = isApiError(query.error) && query.error.code === 'TMDB_NOT_FOUND';
  const tmdbMissing = isApiError(query.error) && query.error.code === 'TMDB_NOT_CONFIGURED';

  useDocumentTitle(data?.title ?? (notFound ? 'Тайтл не найден' : undefined));

  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [releasesOpen, setReleasesOpen] = useState(false);

  const seasons = useMemo(() => {
    const list = data?.seasons ?? [];
    return [...list].sort((a, b) => a.seasonNumber - b.seasonNumber);
  }, [data]);

  // Сезон по умолчанию — первый обычный: «Спецвыпуски» интересны редко.
  useEffect(() => {
    if (type !== 'tv' || seasons.length === 0) return;

    setSelectedSeason((current) => {
      if (current !== null && seasons.some((item) => item.seasonNumber === current)) {
        return current;
      }
      const regular = seasons.find((item) => item.seasonNumber > 0);
      return (regular ?? seasons[0])?.seasonNumber ?? null;
    });
  }, [seasons, type]);

  const closeReleases = useCallback(() => setReleasesOpen(false), []);

  const backdrop = useAuthedImage(posterUrl(data?.backdropPath, 'w780'));

  const regularSeasons = seasons.filter((item) => item.seasonNumber > 0).length;
  const durationPart =
    type === 'tv'
      ? regularSeasons > 0
        ? `${regularSeasons} ${seasonsWord(regularSeasons)}`
        : undefined
      : data?.runtime === undefined
        ? undefined
        : `${data.runtime} мин`;

  const meta = [
    data?.year === undefined ? undefined : String(data.year),
    data?.rating === undefined ? undefined : data.rating.toFixed(1),
    durationPart,
  ].filter((part): part is string => part !== undefined);

  return (
    <div className="min-h-dvh bg-bg">
      <div className="relative h-[40vh] max-h-[420px] min-h-[220px] w-full overflow-hidden">
        {backdrop === undefined ? (
          <div aria-hidden="true" className="absolute inset-0" style={BACKDROP_STYLE} />
        ) : (
          <img
            src={backdrop}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 size-full object-cover"
          />
        )}

        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-bg via-bg/45 to-transparent"
        />

        <AppHeader
          active="title"
          back
          overlay
          className="mx-auto w-full max-w-3xl px-4 pt-1 md:px-6"
        />
      </div>

      <main className="relative mx-auto w-full max-w-3xl px-4 pb-32 md:px-6">
        {query.isPending ? (
          <TitleSkeleton />
        ) : tmdbMissing ? (
          <div className="pt-6">
            <ErrorState
              title="TMDB не настроен"
              description="Добавьте TMDB_API_KEY в .env и перезапустите сервер."
            />
          </div>
        ) : notFound ? (
          <div className="pt-6">
            <ErrorState
              title="Тайтл не найден"
              description="TMDB не вернул данные об этом тайтле."
            />
          </div>
        ) : query.isError ? (
          <div className="pt-6">
            <ErrorState
              title="Не удалось загрузить тайтл"
              description={
                isApiError(query.error)
                  ? query.error.message
                  : 'Сервер не ответил. Проверьте подключение.'
              }
              action={
                <Button size="sm" className="min-h-11" onClick={() => void query.refetch()}>
                  Повторить
                </Button>
              }
            />
          </div>
        ) : data === undefined ? (
          <div className="pt-6">
            <ErrorState title="Тайтл не найден" description="TMDB не вернул данные об этом тайтле." />
          </div>
        ) : (
          <>
            <div className="flex items-end gap-3 -mt-16 md:-mt-20">
              <PosterImage
                title={data.title}
                year={data.year}
                path={data.posterPath}
                showTitle={false}
                className="w-24 shrink-0 md:w-28"
              />

              <div className="min-w-0 pb-1">
                <h1 className="text-xl font-bold leading-tight tracking-tight text-fg md:text-2xl">
                  {data.title}
                </h1>
                {data.originalTitle !== data.title && (
                  <p className="mt-1 text-sm leading-snug text-muted">{data.originalTitle}</p>
                )}
                {meta.length > 0 && (
                  <p className="mt-1 text-xs text-muted md:text-sm">{meta.join(' · ')}</p>
                )}
              </div>
            </div>

            {data.genres.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2" aria-label="Жанры">
                {data.genres.map((genre) => (
                  <GenreTag key={genre.id}>{genre.name}</GenreTag>
                ))}
              </div>
            )}

            {data.overview !== undefined && data.overview.trim().length > 0 && (
              <section className="mt-5" aria-label="Описание">
                <ExpandableText text={data.overview} />
              </section>
            )}

            {type === 'tv' && seasons.length > 0 && (
              <section className="mt-6">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Сезоны
                </h2>
                <div
                  role="group"
                  aria-label="Сезон"
                  className="mt-2 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {seasons.map((season) => (
                    <Chip
                      key={season.seasonNumber}
                      active={selectedSeason === season.seasonNumber}
                      onClick={() => setSelectedSeason(season.seasonNumber)}
                      className="px-3 text-[13px]"
                    >
                      {season.seasonNumber === 0
                        ? 'Спецвыпуски'
                        : `Сезон ${season.seasonNumber}`}
                    </Chip>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        <TmdbAttribution className="mt-10" />
      </main>

      {data !== undefined && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 backdrop-blur">
          <div className="mx-auto w-full max-w-3xl px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] md:px-6">
            <Button
              size="lg"
              className="w-full"
              aria-haspopup="dialog"
              onClick={() => setReleasesOpen(true)}
            >
              Найти раздачи
            </Button>
          </div>
        </div>
      )}

      {releasesOpen && data !== undefined && (
        <ReleasesSheet
          onClose={closeReleases}
          type={type}
          titleId={id}
          titleName={data.title}
          season={type === 'tv' ? (selectedSeason ?? undefined) : undefined}
        />
      )}
    </div>
  );
}
