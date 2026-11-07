import { useSyncExternalStore } from 'react';

/**
 * Токен доступа к API и состояние «сервер требует авторизацию».
 *
 * Оба состояния живут вне React: токен читает `api/client.ts` на каждый запрос,
 * а 401 может прийти из любого запроса, в том числе до монтирования экрана.
 * Компоненты подписываются через `useSyncExternalStore`.
 */

export const TOKEN_STORAGE_KEY = 'filmfind.token';

function readStorage(): string | null {
  try {
    const value = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    return value !== null && value.length > 0 ? value : null;
  } catch {
    // Приватный режим или запрет storage — работаем без токена.
    return null;
  }
}

/** Текущий токен или `null`. Читается из storage каждый раз: токен может появиться без перезагрузки. */
export function getToken(): string | null {
  return readStorage();
}

export function saveToken(value: string): void {
  const token = value.trim();
  try {
    if (token.length === 0) {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    } else {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    }
  } catch {
    // storage недоступен — токен проживёт только до перезагрузки, но приложение не падает.
  }
  emitToken();
}

export function clearToken(): void {
  saveToken('');
}

// --- Подписки ---------------------------------------------------------------

const tokenListeners = new Set<() => void>();
const unauthorizedListeners = new Set<() => void>();

let unauthorized = false;

function emitToken(): void {
  for (const listener of tokenListeners) listener();
}

function emitUnauthorized(): void {
  for (const listener of unauthorizedListeners) listener();
}

function subscribeToken(listener: () => void): () => void {
  tokenListeners.add(listener);
  return () => {
    tokenListeners.delete(listener);
  };
}

function subscribeUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

/** Токен для React: `null`, если доступа без токена хватает. */
export function useToken(): string | null {
  return useSyncExternalStore(subscribeToken, getToken, () => null);
}

/** Сервер ответил 401 — нужен токен. Вызывается из `api/client.ts`. */
export function notifyUnauthorized(): void {
  if (unauthorized) return;
  unauthorized = true;
  emitUnauthorized();
}

/** Токен сохранён (или диалог закрыт) — снимаем требование. */
export function dismissUnauthorized(): void {
  if (!unauthorized) return;
  unauthorized = false;
  emitUnauthorized();
}

export function useUnauthorized(): boolean {
  return useSyncExternalStore(subscribeUnauthorized, () => unauthorized, () => false);
}
