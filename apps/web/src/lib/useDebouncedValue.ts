import { useEffect, useState } from 'react';

/**
 * Отложенное значение: возвращает `value` только после `delayMs` тишины.
 * Начальное значение отдаётся сразу — при загрузке с `?q=…` поиск стартует
 * без искусственной паузы.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
