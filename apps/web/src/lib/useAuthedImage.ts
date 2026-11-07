import { useEffect, useState } from 'react';
import { useToken } from './token';

/**
 * Картинка через серверный прокси с токеном доступа.
 *
 * `<img src>` не умеет отправлять `Authorization`, а сервер закрывает токеном
 * весь `/api/*`, включая `/api/img/*`. Поэтому при сохранённом токене картинка
 * скачивается обычным `fetch` с заголовком и подменяется blob-ссылкой. Без
 * токена возвращается исходный адрес: лишних запросов и blob-URL не появляется.
 */
export function useAuthedImage(src: string | undefined): string | undefined {
  const token = useToken();
  const [blobUrl, setBlobUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    // Старая blob-ссылка могла быть отозвана — не показываем её под новым адресом.
    setBlobUrl(undefined);

    if (src === undefined || token === null) return;

    let cancelled = false;
    let objectUrl: string | undefined;

    void fetch(src, { headers: { authorization: `Bearer ${token}` } })
      .then(async (response) => (response.ok ? response.blob() : undefined))
      .then((blob) => {
        if (cancelled || blob === undefined) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => {
        // Не загрузилось — `Poster` покажет заглушку, экран не падает.
      });

    return () => {
      cancelled = true;
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
    };
  }, [src, token]);

  return token === null ? src : blobUrl;
}
