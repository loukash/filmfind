import { useEffect, useState } from 'react';
import { cn } from '../lib/cn';
import { FilmIcon } from './icons';
import { Skeleton } from './Skeleton';

export interface PosterProps {
  title: string;
  year?: number;
  src?: string;
  alt?: string;
  className?: string;
  /** Показывать подпись поверх постера. Отключить для маленьких миниатюр. */
  showTitle?: boolean;
}

type ImageState = 'loading' | 'loaded' | 'error';

export function Poster({ title, year, src, alt, className, showTitle = true }: PosterProps) {
  const [state, setState] = useState<ImageState>(src ? 'loading' : 'error');

  useEffect(() => {
    setState(src ? 'loading' : 'error');
  }, [src]);

  return (
    <div
      className={cn(
        'relative aspect-[2/3] overflow-hidden rounded-card border border-line bg-surface2',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center"
        style={{
          background:
            'linear-gradient(145deg, var(--surface-2) 0%, var(--surface) 55%, var(--bg) 100%)',
        }}
      >
        <FilmIcon className="size-8 text-muted/40" />
        <span className="absolute text-5xl font-bold text-fg/5">{title.charAt(0)}</span>
      </div>

      {src && state !== 'error' && (
        <img
          src={src}
          alt={alt ?? title}
          loading="lazy"
          className={cn(
            'absolute inset-0 size-full object-cover transition-opacity duration-300',
            state === 'loaded' ? 'opacity-100' : 'opacity-0',
          )}
          onLoad={() => setState('loaded')}
          onError={() => setState('error')}
        />
      )}

      {state === 'loading' && <Skeleton className="absolute inset-0 rounded-none" />}

      {showTitle && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-bg via-bg/70 to-transparent p-3 pt-10">
          <p className="line-clamp-2 text-sm font-semibold leading-tight text-fg">{title}</p>
          {year !== undefined && <p className="mt-1 text-xs text-muted">{year}</p>}
        </div>
      )}
    </div>
  );
}
