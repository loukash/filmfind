import type { TitleType } from '@filmfind/shared';
import { isApiError } from '../api/client';
import { useTitle } from '../api/queries';
import { Link } from '../lib/router';
import { Button, ErrorState, Skeleton, StatusDot } from '../ui';

export interface TitleProps {
  type: TitleType;
  id: number;
}

/**
 * Заглушка карточки тайтла для волны 2.
 *
 * Настоящий экран (постер, описание, сезоны, раздачи, кнопка «В Transmission»)
 * делает волна 3. Здесь — проверка маршрута с параметрами и работающего
 * API-клиента, чтобы переход из поиска не вёл в пустоту.
 */
export function Title({ type, id }: TitleProps) {
  const titleQuery = useTitle(type, id);
  const error = titleQuery.error;
  const tmdbNotConfigured = isApiError(error) && error.code === 'TMDB_NOT_CONFIGURED';

  return (
    <div className="min-h-dvh bg-bg">
      <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-5 md:px-6">
        <div className="flex items-center justify-between gap-3">
          <Link
            to="/"
            className="inline-flex h-11 items-center gap-1.5 rounded-chip px-3 text-sm font-medium text-muted transition-colors hover:text-fg"
          >
            <span aria-hidden="true">←</span>
            Назад
          </Link>
          <StatusDot tone="warn" label="Карточка в разработке" />
        </div>

        <div className="mt-6">
          {titleQuery.isPending ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-24 w-full rounded-card" />
            </div>
          ) : tmdbNotConfigured ? (
            <ErrorState
              title="TMDB не настроен"
              description="Добавьте TMDB_API_KEY в .env и перезапустите сервер."
            />
          ) : titleQuery.isError ? (
            <ErrorState
              title="Не удалось загрузить тайтл"
              description={
                isApiError(error) ? error.message : 'Сервер не ответил. Проверьте подключение.'
              }
              action={
                <Button size="sm" className="min-h-11" onClick={() => void titleQuery.refetch()}>
                  Повторить
                </Button>
              }
            />
          ) : titleQuery.data === undefined ? (
            <ErrorState title="Тайтл не найден" description="TMDB не вернул данные об этом тайтле." />
          ) : (
            <div className="space-y-3">
              <h1 className="text-2xl font-bold leading-tight tracking-tight text-fg md:text-3xl">
                {titleQuery.data.title}
              </h1>
              <p className="text-sm text-muted">
                {titleQuery.data.originalTitle}
                {titleQuery.data.year === undefined ? '' : ` · ${titleQuery.data.year}`}
                {type === 'tv' ? ' · сериал' : ' · фильм'}
                {titleQuery.data.isAnimation ? ' · мультфильм' : ''}
              </p>
              <p className="text-sm text-muted">
                Описание, сезоны и раздачи появятся в следующей волне.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
