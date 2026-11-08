import { cn } from '../lib/cn';

export interface TmdbAttributionProps {
  className?: string;
}

/**
 * Обязательная по условиям TMDB атрибуция: без неё ключ API выдаётся, но
 * использование нарушает Terms of Use. Формулировка — дословно из их требований.
 */
export function TmdbAttribution({ className }: TmdbAttributionProps) {
  return (
    <p className={cn('text-center text-[11px] leading-relaxed text-muted', className)}>
      This product uses the{' '}
      <a
        href="https://www.themoviedb.org/"
        target="_blank"
        rel="noreferrer noopener"
        className="underline decoration-line underline-offset-2 transition-colors hover:text-fg"
      >
        TMDB API
      </a>{' '}
      but is not endorsed or certified by TMDB.
    </p>
  );
}
