import type { ReleaseDTO } from '@filmfind/shared';
import { formatBytes } from '@filmfind/shared';
import { isApiError } from '../api/client';
import { useAddTorrent } from '../api/queries';
import { formatPublishDate } from '../lib/formatDate';
import { Button, Card } from '../ui';
import { CheckIcon } from './icons';
import { ReleaseBadges } from './ReleaseBadges';

/**
 * Карточка раздачи.
 *
 * Состояние «В Transmission» живёт в собственной мутации этой карточки: две
 * раздачи можно добавлять независимо, и успех одной не подсвечивает другую.
 */
export function ReleaseCard({ release }: { release: ReleaseDTO }) {
  const add = useAddTorrent();

  const seeders = release.seeders ?? 0;
  const noSeeders = seeders === 0;
  const publishedAt = formatPublishDate(release.publishDate);

  const addToTransmission = () => add.mutate({ releaseId: release.id });

  const errorMessage = isApiError(add.error)
    ? add.error.message
    : 'Не удалось добавить раздачу. Проверьте подключение.';

  return (
    <Card className="space-y-2.5 p-3">
      <p className="line-clamp-2 text-sm font-medium leading-snug text-fg">{release.title}</p>

      <ReleaseBadges quality={release.quality} />

      <div className="flex items-end justify-between gap-3 pt-1">
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted">
          <span>{formatBytes(release.size)}</span>
          <span aria-hidden="true">·</span>
          <span className={noSeeders ? 'text-danger' : 'text-success'}>
            <span aria-hidden="true">●</span> {seeders}
            <span className="sr-only"> сидов</span>
          </span>
          <span aria-hidden="true">·</span>
          <span>{release.leechers ?? 0} пиров</span>
          {release.indexer !== undefined && (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">{release.indexer}</span>
            </>
          )}
          {publishedAt !== undefined && (
            <>
              <span aria-hidden="true">·</span>
              <span>{publishedAt}</span>
            </>
          )}
        </p>

        <div className="flex shrink-0 items-center">
          {add.isPending ? (
            <Button size="sm" loading className="min-h-11">
              В Transmission
            </Button>
          ) : add.isSuccess ? (
            add.data.result === 'added' ? (
              <span className="inline-flex h-9 items-center gap-1.5 rounded-chip border border-success/30 bg-success/15 px-3 text-sm font-medium text-success">
                <CheckIcon className="size-4" />
                Добавлено
              </span>
            ) : (
              <span className="inline-flex h-9 items-center rounded-chip border border-warn/30 bg-warn/15 px-3 text-sm font-medium text-warn">
                Уже есть
              </span>
            )
          ) : add.isError ? null : (
            <Button
              size="sm"
              disabled={noSeeders}
              onClick={addToTransmission}
              className="min-h-11"
            >
              {noSeeders ? 'Нет сидов' : 'В Transmission'}
            </Button>
          )}
        </div>
      </div>

      {add.isError && (
        <div className="space-y-2 border-t border-line pt-2">
          <p role="alert" className="text-xs leading-snug text-danger">
            {errorMessage}
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="min-h-11"
            onClick={addToTransmission}
          >
            Повторить
          </Button>
        </div>
      )}
    </Card>
  );
}
