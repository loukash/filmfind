import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { ParsedRelease, ReleaseDTO, TorrentDTO } from '@filmfind/shared';
import { formatBytes, formatEta } from '@filmfind/shared';
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  IconButton,
  Poster,
  ProgressBar,
  Sheet,
  Skeleton,
  StatusDot,
  type BadgeTone,
} from '../ui';
import { AlertIcon, FilmIcon, SearchIcon } from '../ui/icons';

const SEARCH_TITLES = [
  { title: 'Дюна: Часть вторая', year: 2024 },
  { title: 'Оппенгеймер', year: 2023 },
  { title: 'Бедные-несчастные', year: 2023 },
  { title: 'Фуриоса: Безумный Макс', year: 2024 },
  { title: 'Падение дома Ашеров', year: 2023 },
  { title: 'Мальчик и птица', year: 2023 },
];

const RELEASES: { release: ReleaseDTO; age: string }[] = [
  {
    age: '2 дн',
    release: {
      id: 'dune-2160p-webdl',
      title: 'Дюна.Часть.вторая.2024.2160p.WEB-DL.DDP5.1.HDR.H.265-DUB',
      size: 19_756_849_562,
      seeders: 1242,
      leechers: 38,
      indexer: 'ExampleTracker',
      indexerId: 1,
      publishDate: '2026-11-06T10:00:00Z',
      categories: [2040, 2045],
      quality: {
        resolution: '2160p',
        source: 'WEB-DL',
        codec: 'H.265',
        hdr: ['HDR10'],
        audio: { format: 'DDP', channels: '5.1', atmos: false },
        voice: ['Дубляж'],
      },
      guid: 'dune-2160p-webdl',
    },
  },
  {
    age: '5 дн',
    release: {
      id: 'dune-1080p-bluray',
      title: 'Дюна.Часть.вторая.2024.1080p.BluRay.x264.DTS-HD.MA.5.1.MVO',
      size: 14_120_000_000,
      seeders: 856,
      leechers: 24,
      indexer: 'ExampleTracker',
      indexerId: 1,
      publishDate: '2026-11-03T18:30:00Z',
      categories: [2040],
      quality: {
        resolution: '1080p',
        source: 'BluRay',
        codec: 'H.264',
        audio: { format: 'DTS-HD MA', channels: '5.1' },
        voice: ['MVO', 'Субтитры'],
      },
      guid: 'dune-1080p-bluray',
    },
  },
  {
    age: '8 дн',
    release: {
      id: 'dune-2160p-remux',
      title: 'Дюна.Часть.вторая.2024.2160p.BluRay.REMUX.DV.HDR.HEVC.DTS-HD.MA.5.1',
      size: 62_400_000_000,
      seeders: 143,
      leechers: 12,
      indexer: 'DemoTracker',
      indexerId: 2,
      publishDate: '2026-10-31T09:15:00Z',
      categories: [2040],
      quality: {
        resolution: '2160p',
        source: 'Remux',
        codec: 'H.265',
        hdr: ['Dolby Vision', 'HDR10'],
        audio: { format: 'DTS-HD MA', channels: '5.1' },
        voice: ['Оригинал', 'Субтитры'],
      },
      guid: 'dune-2160p-remux',
    },
  },
  {
    age: '12 дн',
    release: {
      id: 'dune-cam',
      title: 'Дюна.Часть.вторая.2024.CAM.HD.TC.x264',
      size: 2_310_000_000,
      seeders: 0,
      leechers: 7,
      indexer: 'SampleIndexer',
      indexerId: 3,
      publishDate: '2026-10-27T21:00:00Z',
      categories: [2040],
      quality: {
        resolution: '1080p',
        source: 'CAM',
        codec: 'H.264',
        audio: { format: 'AC3', channels: '2.0' },
        voice: ['Дубляж'],
      },
      guid: 'dune-cam',
    },
  },
];

const DOWNLOADS: { torrent: TorrentDTO; label: string; tone: BadgeTone }[] = [
  {
    label: 'Скачивание',
    tone: 'accent',
    torrent: {
      id: 1,
      name: 'Дюна.Часть.вторая.2024.2160p.WEB-DL.DDP5.1.HDR.H.265-DUB',
      percentDone: 0.62,
      status: 4,
      rateDownload: 42_500_000,
      rateUpload: 1_200_000,
      eta: 1840,
      totalSize: 19_756_849_562,
      downloadDir: '/downloads/movies',
    },
  },
  {
    label: 'Пауза',
    tone: 'warn',
    torrent: {
      id: 2,
      name: 'Падение дома Ашеров / The Fall of the House of Usher (2023) 1080p',
      percentDone: 0.18,
      status: 0,
      rateDownload: 0,
      rateUpload: 0,
      eta: -1,
      totalSize: 24_600_000_000,
      downloadDir: '/downloads/series',
    },
  },
  {
    label: 'Раздача',
    tone: 'success',
    torrent: {
      id: 3,
      name: 'Оппенгеймер.2023.1080p.BluRay.x264.DTS-HD.MA.5.1',
      percentDone: 1,
      status: 6,
      rateDownload: 0,
      rateUpload: 3_400_000,
      eta: -1,
      totalSize: 16_800_000_000,
      downloadDir: '/downloads/movies',
    },
  },
];

const CODEC_LABELS: Record<string, string> = {
  'H.264': 'x264',
  'H.265': 'x265',
  AV1: 'AV1',
  XviD: 'XviD',
};

function PhoneFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-2">
      <p className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
      <div className="relative mx-auto h-[844px] w-full max-w-[390px] overflow-hidden rounded-[28px] border border-line bg-bg">
        {children}
      </div>
    </div>
  );
}

function ReleaseBadges({ quality }: { quality: ParsedRelease }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {quality.resolution !== undefined && (
        <Badge variant="resolution">{quality.resolution}</Badge>
      )}
      {quality.source !== undefined && <Badge variant="source">{quality.source}</Badge>}
      {quality.codec !== undefined && (
        <Badge variant="codec">{CODEC_LABELS[quality.codec] ?? quality.codec}</Badge>
      )}
      {quality.hdr?.map((hdr) => (
        <Badge key={hdr} variant="hdr">
          {hdr}
        </Badge>
      ))}
      {quality.audio !== undefined && (
        <Badge variant="audio">
          {[quality.audio.format, quality.audio.channels].filter(Boolean).join(' ')}
          {quality.audio.atmos === true ? ' Atmos' : ''}
        </Badge>
      )}
      {quality.voice?.map((voice) => (
        <Badge key={voice} variant="voice">
          {voice}
        </Badge>
      ))}
    </div>
  );
}

function SearchScreen() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between px-4 pb-3 pt-5">
        <span className="text-xl font-bold tracking-tight text-fg">FilmFind</span>
        <StatusDot tone="success" label="3/3" />
      </header>

      <div className="px-4">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            aria-label="Поиск фильмов и сериалов"
            placeholder="Найти фильм или сериал"
            className="h-11 w-full rounded-chip border border-line bg-surface pl-9 pr-3 text-sm text-fg placeholder:text-muted"
          />
        </div>

        <div className="mt-3 flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Chip active className="px-3 text-[13px]">Все</Chip>
          <Chip className="px-2.5 text-[13px]">Фильмы</Chip>
          <Chip className="px-2.5 text-[13px]">Сериалы</Chip>
          <Chip className="px-2.5 text-[13px]">Мультфильмы</Chip>
        </div>
      </div>

      <div className="mt-4 grid min-h-0 auto-rows-max grid-cols-2 content-start gap-3 overflow-y-auto px-4 pb-6">
        {SEARCH_TITLES.map((item) => (
          <Poster key={item.title} title={item.title} year={item.year} />
        ))}
        <Skeleton className="aspect-[2/3] w-full rounded-card" />
      </div>
    </div>
  );
}

function TitleScreen() {
  return (
    <div className="relative h-full overflow-y-auto pb-24">
      <div
        className="relative h-[40%] shrink-0"
        style={{
          background:
            'radial-gradient(120% 90% at 25% 15%, rgba(109, 94, 248, 0.18) 0%, transparent 60%), linear-gradient(155deg, #22222C 0%, var(--surface) 45%, var(--bg) 100%)',
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <FilmIcon className="size-10 text-fg/10" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-transparent" />
      </div>

      <div className="relative -mt-24 flex items-end gap-3 px-4">
        <Poster title="Дюна: Часть вторая" year={2024} className="w-24 shrink-0" showTitle={false} />
        <div className="min-w-0 pb-1">
          <h2 className="text-lg font-bold leading-tight text-fg">Дюна: Часть вторая</h2>
          <p className="mt-1 text-xs text-muted">Dune: Part Two</p>
          <p className="mt-1 text-xs text-muted">2024 · 8.0 · 166 мин</p>
        </div>
      </div>

      <div className="px-4 pt-4">
        <div className="flex flex-wrap gap-2">
          <Chip>Фантастика</Chip>
          <Chip>Приключения</Chip>
          <Chip>Драма</Chip>
        </div>
        <p className="mt-4 line-clamp-4 text-sm leading-relaxed text-muted">
          Пол Атрейдес объединяется с Чани и фременами, чтобы отомстить заговорщикам,
          уничтожившим его семью. Сражаясь за будущее Арракиса, он пытается предотвратить
          ужасную судьбу, которую способен предвидеть только он.
        </p>
      </div>

      <div className="absolute inset-x-0 bottom-0 border-t border-line bg-bg/95 p-4">
        <Button size="lg" className="w-full">
          Найти раздачи
        </Button>
      </div>
    </div>
  );
}

function ReleasesScreen() {
  return (
    <div className="h-full">
      <TitleScreen />
      <Sheet open onClose={() => undefined} title="Раздачи 24" embedded>
        <div className="flex gap-2 overflow-x-auto pb-3">
          <Chip active>1080p+</Chip>
          <Chip>Сиды 5+</Chip>
          <Chip>Без CAM</Chip>
        </div>

        <div className="space-y-3 pb-2">
          {RELEASES.map(({ release, age }) => {
            const noSeeders = (release.seeders ?? 0) === 0;
            return (
              <Card key={release.id} className="space-y-2.5 p-3">
                <p className="line-clamp-2 text-sm font-medium leading-snug text-fg">
                  {release.title}
                </p>

                <ReleaseBadges quality={release.quality} />

                <div className="flex items-center justify-between gap-2 pt-1">
                  <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted">
                    <span>{formatBytes(release.size)}</span>
                    <span aria-hidden="true">·</span>
                    <span className={noSeeders ? 'text-danger' : 'text-success'}>
                      ● {release.seeders ?? 0}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{release.leechers ?? 0} пиров</span>
                    <span aria-hidden="true">·</span>
                    <span>{release.indexer}</span>
                    <span aria-hidden="true">·</span>
                    <span>{age}</span>
                  </p>
                  <Button size="sm" disabled={noSeeders} className="shrink-0">
                    В Transmission
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </Sheet>
    </div>
  );
}

function DownloadsScreen() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between px-4 pb-3 pt-5">
        <h2 className="text-xl font-bold tracking-tight text-fg">Загрузки</h2>
        <StatusDot tone="success" label="3 активных" />
      </header>

      <div className="mt-0 min-h-0 space-y-3 overflow-y-auto px-4 pb-6">
        {DOWNLOADS.map(({ torrent, label, tone }) => {
          const percent = Math.round(torrent.percentDone * 100);
          const speed =
            torrent.rateDownload > 0 ? `${formatBytes(torrent.rateDownload)}/с` : '—';

          return (
            <Card key={torrent.id} className="space-y-2.5 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 line-clamp-2 text-sm font-medium leading-snug text-fg">
                  {torrent.name}
                </p>
                <Badge tone={tone}>{label}</Badge>
              </div>

              <ProgressBar
                value={torrent.percentDone}
                tone={torrent.status === 6 ? 'success' : 'accent'}
                label={`Загрузка: ${percent}%`}
              />

              <div className="flex items-center justify-between text-xs text-muted">
                <span>
                  {percent}% · {speed}
                </span>
                <span>осталось {formatEta(torrent.eta)}</span>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">{title}</h3>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

export function Styleguide() {
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    document.title = 'FilmFind — стайлгайд';
  }, []);

  return (
    <div className="min-h-dvh bg-bg px-4 py-8 md:px-8">
      <header className="mx-auto mb-8 flex w-full max-w-[1200px] flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-muted">FilmFind</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-fg">Стайлгайд</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Четыре экрана мобильного приложения и примитивы дизайн-системы. Все макеты собраны
            на настоящих компонентах из <code className="text-fg">src/ui</code>.
          </p>
        </div>
        <a
          href="/"
          className="inline-flex h-11 items-center rounded-chip border border-line px-4 text-sm font-medium text-fg transition-colors hover:border-muted"
        >
          На главную
        </a>
      </header>

      <div className="mx-auto grid w-full max-w-[1200px] justify-items-center gap-10 lg:grid-cols-2">
        <PhoneFrame label="1. Поиск">
          <SearchScreen />
        </PhoneFrame>
        <PhoneFrame label="2. Карточка тайтла">
          <TitleScreen />
        </PhoneFrame>
        <PhoneFrame label="3. Раздачи">
          <ReleasesScreen />
        </PhoneFrame>
        <PhoneFrame label="4. Загрузки">
          <DownloadsScreen />
        </PhoneFrame>
      </div>

      <section className="mx-auto mt-16 w-full max-w-[1200px] space-y-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-fg">Примитивы</h2>
          <p className="mt-1 text-sm text-muted">
            Все варианты, состояния и размеры интерактивных элементов.
          </p>
        </div>

        <Card className="space-y-8 p-6">
          <Section title="Button · варианты">
              <Button variant="primary">Основная</Button>
              <Button variant="secondary">Вторичная</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Опасная</Button>
            </Section>

            <Section title="Button · размеры и состояния">
              <Button size="sm">Маленькая</Button>
              <Button size="md">Средняя</Button>
              <Button size="lg">Большая</Button>
              <Button loading>Загрузка</Button>
              <Button disabled>Недоступна</Button>
              <IconButton label="Поиск" variant="secondary">
                <SearchIcon className="size-5" />
              </IconButton>
            </Section>

            <Section title="Chip">
              <Chip active>Все</Chip>
              <Chip>Фильмы</Chip>
              <Chip icon={<FilmIcon className="size-4" />}>Сериалы</Chip>
              <Chip disabled>Недоступно</Chip>
            </Section>

            <Section title="Badge">
              <Badge variant="resolution">2160p</Badge>
              <Badge variant="resolution">1080p</Badge>
              <Badge variant="source">WEB-DL</Badge>
              <Badge variant="codec">x265</Badge>
              <Badge variant="hdr">HDR</Badge>
              <Badge variant="audio">DDP 5.1</Badge>
              <Badge variant="voice">Дубляж</Badge>
              <Badge tone="success">Раздача</Badge>
              <Badge tone="danger">0 сидов</Badge>
            </Section>

            <Section title="StatusDot">
              <StatusDot tone="success" label="Все сервисы доступны" />
              <StatusDot tone="warn" label="Prowlarr не настроен" />
              <StatusDot tone="danger" label="Transmission недоступен" />
            </Section>

            <Section title="ProgressBar">
              <div className="w-full max-w-sm space-y-3">
                <ProgressBar value={0.62} label="Скачивание: 62%" />
                <ProgressBar value={1} tone="success" label="Раздача: 100%" />
              </div>
            </Section>

            <Section title="Skeleton">
              <div className="flex w-full flex-wrap gap-3">
                <Skeleton className="h-11 w-40" />
                <Skeleton className="h-11 w-24" />
                <Skeleton className="aspect-[2/3] w-24 rounded-card" />
              </div>
            </Section>

            <Section title="EmptyState и ErrorState">
              <div className="grid w-full gap-4 md:grid-cols-2">
                <Card>
                  <EmptyState
                    title="Ничего не найдено"
                    description="Попробуйте изменить запрос или снять фильтры."
                    action={
                      <Button variant="secondary" size="sm">
                        Сбросить фильтры
                      </Button>
                    }
                  />
                </Card>
                <Card>
                  <ErrorState
                    title="Не удалось загрузить раздачи"
                    description="Prowlarr не отвечает. Проверьте настройки подключения."
                    icon={<AlertIcon className="size-6" />}
                    action={
                      <Button size="sm">
                        Повторить
                      </Button>
                    }
                  />
                </Card>
              </div>
            </Section>

            <Section title="Sheet">
              <Button onClick={() => setSheetOpen(true)}>Открыть Sheet</Button>
            </Section>
          </Card>
      </section>

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Пример Sheet">
        <p className="pb-4 text-sm leading-relaxed text-muted">
          Bottom sheet с ручкой, затемнением фона, закрытием по Escape и клику по фону,
          а также focus-trap. На мобильном занимает 85% высоты экрана.
        </p>
        <div className="space-y-3">
          <Button className="w-full">Основное действие</Button>
          <Button variant="secondary" className="w-full" onClick={() => setSheetOpen(false)}>
            Закрыть
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
