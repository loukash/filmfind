/**
 * История поисковых запросов в localStorage.
 *
 * В storage лежит только текст запроса — никаких токенов и ответов сервера.
 * Все операции терпимы к недоступному storage (приватный режим Safari) и к
 * испорченному JSON: история — украшение, а не критичные данные.
 */

const STORAGE_KEY = 'filmfind.history';

export const MAX_HISTORY_ITEMS = 8;

function isQuery(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function readRaw(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isQuery).slice(0, MAX_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

function writeRaw(items: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Нет места или storage запрещён — молча живём без истории.
  }
}

export function readHistory(): string[] {
  return readRaw();
}

/** Добавляет запрос в начало списка без дублей (регистр не важен). */
export function pushHistory(query: string): string[] {
  const value = query.trim();
  if (value.length === 0) return readRaw();

  const normalized = value.toLocaleLowerCase('ru');
  const rest = readRaw().filter((item) => item.toLocaleLowerCase('ru') !== normalized);
  const next = [value, ...rest].slice(0, MAX_HISTORY_ITEMS);

  writeRaw(next);
  return next;
}

export function clearHistory(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage недоступен — очищать нечего.
  }
}
