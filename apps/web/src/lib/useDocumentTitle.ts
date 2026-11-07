import { useEffect } from 'react';

const APP_NAME = 'FilmFind';

/**
 * Заголовок документа для текущего экрана.
 *
 * Без названия оставляем просто «FilmFind» — так экран загрузки не показывает
 * имя предыдущего тайтла, пока данные ещё не пришли.
 */
export function useDocumentTitle(title?: string): void {
  useEffect(() => {
    document.title =
      title !== undefined && title.trim().length > 0 ? `${title} — ${APP_NAME}` : APP_NAME;
  }, [title]);
}
