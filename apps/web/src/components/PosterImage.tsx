import { posterUrl, type PosterSize } from '../api/client';
import { useAuthedImage } from '../lib/useAuthedImage';
import { Poster, type PosterProps } from '../ui';

export interface PosterImageProps extends Omit<PosterProps, 'src'> {
  /** Сырой путь TMDB; `undefined` — заглушка. */
  path?: string;
  size?: PosterSize;
}

/**
 * Постер по пути TMDB. Отдельный компонент, потому что `useAuthedImage` —
 * хук: в списках карточек его нельзя вызвать внутри `map`.
 */
export function PosterImage({ path, size = 'w342', ...rest }: PosterImageProps) {
  const src = useAuthedImage(posterUrl(path, size));
  return <Poster {...rest} src={src} />;
}
