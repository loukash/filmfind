import type { TorrentDTO } from '@filmfind/shared';
import { formatBytes, formatEta } from '@filmfind/shared';
import { isApiError } from '../api/client';
import { useTorrents } from '../api/queries';
import { AppHeader } from '../components/AppHeader';
import { TmdbAttribution } from '../components/TmdbAttribution';
import { DownloadIcon } from '../components/icons';
import { Link } from '../lib/router';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ProgressBar,
  Skeleton,
  type BadgeTone,
  type ProgressTone,
} from '../ui';

const SKELETON_COUNT = 3;

interface TorrentState {
  label: string;
  tone: BadgeTone;
  progress: ProgressTone;
  downloading: boolean;
}

/**
 * Коды Transmission: 0 — стоп, 1–2 — проверка, 3–4 — скачивание, 5–6 — раздача.
 * Промежуточные состояния («ждёт проверки», «ждёт раздачи») попадают в ту же
 * группу, что и основной процесс.
 */
function torrentState(status: number): TorrentState {
  if (status === 0) {
    return { label: 'Стоп', tone: 'warn', progress: 'accent', downloading: false };
  }
  if (status <= 2) {
    return { label: 'Проверка', tone: 'warn', progress: 'accent', downloading: false };
  }
  if (status <= 4) {
    return { label: 'Скачивание', tone: 'accent', progress: 'accent', downloading: true };
  }
  return { label: 'Раздача', tone: 'success', progress: 'success', downloading: false };
}

function isActive(torrent: TorrentDTO): boolean {
  return torrent.percentDone < 1 && torrent.status !== 0;
}

function TorrentCard({ torrent }: { torrent: TorrentDTO }) {
  const state = torrentState(torrent.status);
  const percent = Math.round(torrent.percentDone * 100);
  const speed = torrent.rateDownload > 0 ? `${formatBytes(torrent.rateDownload)}/с` : '—';

  return (
    <Card className="space-y-2.5 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 line-clamp-2 text-sm font-medium leading-snug text-fg">
          {torrent.name}
        </p>
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>

      <ProgressBar
        value={torrent.percentDone}
        tone={state.progress}
        label={`Загрузка: ${percent}%`}
      />

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted">
        <span>
          {percent}% · {speed}
        </span>
        {state.downloading && torrent.eta >= 0 && <span>осталось {formatEta(torrent.eta)}</span>}
        <span>{formatBytes(torrent.totalSize)}</span>
      </div>
    </Card>
  );
}

/**
 * Экран загрузок: прогресс, скорость и ETA из Transmission.
 *
 * Опрос раз в 5 секунд уже настроен в `useTorrents`; в фоновой вкладке он
 * останавливается (`refetchIntervalInBackground: false`).
 */
export function Downloads() {
  useDocumentTitle('Загрузки');

  const query = useTorrents();
  const items = query.data ?? [];
  const active = items.filter(isActive);
  const totalSpeed = active.reduce((sum, torrent) => sum + torrent.rateDownload, 0);

  const transmissionMissing =
    isApiError(query.error) && query.error.code === 'TRANSMISSION_NOT_CONFIGURED';

  return (
    <div className="min-h-dvh bg-bg">
      <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-5 md:px-6">
        <AppHeader active="downloads" />

        <h1 className="mt-5 text-2xl font-bold tracking-tight text-fg">Загрузки</h1>

        {query.data !== undefined && items.length > 0 && (
          <p className="mt-1 text-sm text-muted">
            Активных: {active.length} · {formatBytes(totalSpeed)}/с
          </p>
        )}

        <p className="sr-only" aria-live="polite">
          {query.data === undefined
            ? ''
            : `Активных загрузок: ${active.length}. Суммарная скорость: ${formatBytes(totalSpeed)} в секунду`}
        </p>

        <div className="mt-4">
          {transmissionMissing ? (
            <ErrorState
              title="Transmission не настроен"
              description="Добавьте TRANSMISSION_URL в .env и перезапустите сервер."
            />
          ) : query.isError ? (
            <ErrorState
              title="Не удалось загрузить список"
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
          ) : query.isPending ? (
            <div className="space-y-3" aria-busy="true">
              {Array.from({ length: SKELETON_COUNT }, (_, index) => (
                <Card key={index} className="space-y-3 p-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-1 w-full rounded-pill" />
                  <Skeleton className="h-3 w-1/2" />
                </Card>
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              title="Загрузок нет"
              description="Найдите раздачу в поиске и добавьте её в Transmission."
              icon={<DownloadIcon className="size-6" />}
              action={
                <Link
                  to="/"
                  className="inline-flex h-11 items-center rounded-chip border border-line bg-surface2 px-4 text-sm font-medium text-fg transition-colors hover:border-muted"
                >
                  Найти раздачу
                </Link>
              }
            />
          ) : (
            <ul className="list-none space-y-3 p-0">
              {items.map((torrent) => (
                <li key={torrent.id}>
                  <TorrentCard torrent={torrent} />
                </li>
              ))}
            </ul>
          )}

          <TmdbAttribution className="mt-10" />
        </div>
      </div>
    </div>
  );
}
