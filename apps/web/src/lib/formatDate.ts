const DATE_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Дата публикации раздачи в компактном виде: «сегодня», «вчера», «3 дн»,
 * дальше — «06.11.2026». `undefined` для битой или отсутствующей даты:
 * сегмент в подвале карточки просто не показывается.
 */
export function formatPublishDate(value?: string): string | undefined {
  if (value === undefined) return undefined;

  const date = new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) return undefined;

  const diffDays = Math.floor((Date.now() - time) / DAY_MS);
  if (diffDays <= 0) return 'сегодня';
  if (diffDays === 1) return 'вчера';
  if (diffDays < 7) return `${diffDays} дн`;

  return DATE_FORMATTER.format(date);
}
