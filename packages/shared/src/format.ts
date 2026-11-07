const BYTE_UNITS = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'] as const;

/**
 * Форматирует размер в байтах с русскими единицами.
 * 0 → «0 Б», 1536 → «1.5 КБ», 19756849562 → «18.4 ГБ».
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 Б';

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const unit = BYTE_UNITS[unitIndex] ?? 'Б';
  // Один знак после запятой, но без лишнего «.0».
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${unit}`;
}

/**
 * Форматирует ETA в секундах.
 * 720 → «12 мин», 3900 → «1 ч 5 мин», 90000 → «1 д 1 ч», -1 → «—».
 */
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.floor(seconds)} с`;

  const totalMinutes = Math.floor(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} мин`;

  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) {
    return minutes > 0 ? `${totalHours} ч ${minutes} мин` : `${totalHours} ч`;
  }

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `${days} д ${hours} ч` : `${days} д`;
}
