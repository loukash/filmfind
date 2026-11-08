import type { TitleType } from '@filmfind/shared';

/** Каталоги загрузки: общий фолбэк и переопределения по категории. */
export interface DownloadDirConfig {
  /** `TRANSMISSION_DOWNLOAD_DIR` — используется, если специфичный каталог не задан. */
  base?: string;
  /** `TRANSMISSION_DOWNLOAD_DIR_MOVIE` — полнометражные фильмы. */
  movie?: string;
  /** `TRANSMISSION_DOWNLOAD_DIR_TV` — сериалы, включая аниме-сериалы. */
  tv?: string;
  /** `TRANSMISSION_DOWNLOAD_DIR_ANIMATION` — мультфильмы. */
  animation?: string;
}

/** Что известно о тайтле в момент добавления раздачи. */
export interface ReleaseContext {
  type: TitleType;
  isAnimation: boolean;
}

/**
 * Выбирает каталог загрузки для конкретной раздачи.
 *
 * Правило — сначала тип, потом жанр: аниме-сериал уходит в каталог сериалов,
 * потому что библиотека Jellyfin имеет тип (фильмы или сериалы), и сериал в
 * папке фильмов отображается некорректно. Мультфильмы — единственная категория,
 * где жанр переопределяет тип.
 *
 * Любое незаданное значение проваливается на общий каталог; если и его нет,
 * возвращается `undefined` — тогда Transmission использует свою папку
 * по умолчанию.
 */
export function resolveDownloadDir(
  config: DownloadDirConfig,
  context?: ReleaseContext,
): string | undefined {
  if (context === undefined) return config.base;

  if (context.type === 'movie') {
    const specific = context.isAnimation ? config.animation : config.movie;
    return specific ?? config.base;
  }

  return config.tv ?? config.base;
}
