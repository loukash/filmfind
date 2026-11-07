import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { useCallback, useSyncExternalStore } from 'react';
import type { TitleType } from '@filmfind/shared';

/**
 * Минимальный роутер на History API.
 *
 * Зачем свой, а не react-router: маршрутов четыре, а лишняя зависимость в
 * PWA-оболочке стоит веса и обновлений. Требования — параметры в компоненте,
 * работа кнопки «назад» и редирект неизвестных путей — закрываются парой
 * десятков строк.
 */

export interface Location {
  pathname: string;
  search: string;
}

export type RouteMatch =
  | { name: 'search' }
  | { name: 'title'; type: TitleType; id: number }
  | { name: 'downloads' }
  | { name: 'styleguide' }
  | { name: 'notFound' };

function readLocation(): Location {
  return { pathname: window.location.pathname, search: window.location.search };
}

/**
 * Снимок адреса кэшируется: `useSyncExternalStore` требует стабильную ссылку,
 * иначе React уходит в бесконечный ререндер.
 */
let current: Location = readLocation();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

window.addEventListener('popstate', () => {
  current = readLocation();
  emit();
});

export function getLocation(): Location {
  return current;
}

/**
 * Переход по адресу.
 *
 * `replace: true` не создаёт запись в истории — нужен для живого обновления
 * `?q=…`, чтобы набор запроса не забивал кнопку «назад» по символу.
 *
 * Глубина лежит в `history.state`: по ней `goBack` понимает, есть ли куда
 * возвращаться внутри приложения. Прямая ссылка на карточку тайтла получает
 * глубину 0 и уводит «Назад» на поиск, а не на чужой сайт из истории браузера.
 */
const DEPTH_KEY = '__filmfindDepth';

function readDepth(): number {
  const state: unknown = window.history.state;
  if (typeof state !== 'object' || state === null) return 0;

  const depth = (state as Record<string, unknown>)[DEPTH_KEY];
  return typeof depth === 'number' && Number.isSafeInteger(depth) && depth >= 0 ? depth : 0;
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const depth = readDepth();
  const state = { [DEPTH_KEY]: options.replace === true ? depth : depth + 1 };

  if (options.replace === true) {
    window.history.replaceState(state, '', to);
  } else {
    window.history.pushState(state, '', to);
  }

  current = readLocation();
  emit();
}

/** Назад по истории приложения; если истории нет — на `fallback`. */
export function goBack(fallback = '/'): void {
  if (readDepth() > 0) {
    window.history.back();
    return;
  }

  navigate(fallback, { replace: true });
}

export function useLocation(): Location {
  return useSyncExternalStore(subscribe, getLocation, getLocation);
}

export function useNavigate(): (to: string, options?: { replace?: boolean }) => void {
  return useCallback((to: string, options?: { replace?: boolean }) => {
    navigate(to, options);
  }, []);
}

/** Разбор пути в маршрут. Неизвестный путь — `notFound`, а не белый экран. */
export function parseRoute(pathname: string): RouteMatch {
  const path = pathname.replace(/\/+$/, '') || '/';

  if (path === '/') return { name: 'search' };
  if (path === '/styleguide') return { name: 'styleguide' };
  if (path === '/downloads') return { name: 'downloads' };

  const match = /^\/title\/(movie|tv)\/(\d+)$/.exec(path);
  if (match !== null) {
    const rawType = match[1];
    const rawId = match[2];
    const id = rawId === undefined ? Number.NaN : Number(rawId);

    if ((rawType === 'movie' || rawType === 'tv') && Number.isSafeInteger(id) && id > 0) {
      return { name: 'title', type: rawType, id };
    }
  }

  return { name: 'notFound' };
}

export function titlePath(type: TitleType, id: number): string {
  return `/title/${type}/${id}`;
}

/** Адрес поиска: пустые параметры не мусорят в строке. */
export function searchPath(q: string, page: number): string {
  const params = new URLSearchParams();
  if (q.length > 0) params.set('q', q);
  if (page > 1) params.set('page', String(page));

  const search = params.toString();
  return search.length > 0 ? `/?${search}` : '/';
}

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
  replace?: boolean;
}

/** Ссылка внутри SPA: модификаторы и средняя кнопка мыши остаются за браузером. */
export function Link({ to, replace = false, onClick, children, ...rest }: LinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    navigate(to, { replace });
  };

  return (
    <a href={to} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
