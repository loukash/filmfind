import { useCallback, useSyncExternalStore } from 'react';

/**
 * Подписка на CSS media query. Нужна, чтобы включать автофокус только там, где
 * есть физическая клавиатура: на телефоне автофокус выдёргивает экранную
 * клавиатуру поверх выдачи.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
