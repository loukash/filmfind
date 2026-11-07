import type { InternalRelease } from '../clients/prowlarr.js';
import { LruCache } from './lru.js';

/** Сколько свеженайденных раздач держим в памяти. */
const MAX_ENTRIES = 2000;
/** Через полчаса раздача считается устаревшей: ссылки Prowlarr живут недолго. */
const TTL_MS = 30 * 60 * 1000;

const store = new LruCache<string, InternalRelease>({ max: MAX_ENTRIES, ttlMs: TTL_MS });

/**
 * Запоминает найденные раздачи по стабильному `id`.
 * Нужен, чтобы `POST /api/transmission/add { releaseId }` мог достать магнит:
 * публичный ответ поиска наружу эти поля не отдаёт.
 */
export function rememberReleases(items: InternalRelease[]): void {
  for (const item of items) {
    if (typeof item?.id === 'string' && item.id.length > 0) {
      store.set(item.id, item);
    }
  }
}

/** Возвращает раздачу по id или undefined, если индекс пуст / запись протухла (TTL). */
export function getReleaseById(id: string): InternalRelease | undefined {
  return store.get(id);
}
