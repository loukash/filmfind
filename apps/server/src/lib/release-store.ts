import type { InternalRelease } from '../clients/prowlarr.js';
import type { ReleaseContext } from './download-dirs.js';
import { LruCache } from './lru.js';

/** Сколько свеженайденных раздач держим в памяти. */
const MAX_ENTRIES = 2000;
/** Через полчаса раздача считается устаревшей: ссылки Prowlarr живут недолго. */
const TTL_MS = 30 * 60 * 1000;

interface StoredRelease {
  release: InternalRelease;
  context?: ReleaseContext;
}

const store = new LruCache<string, StoredRelease>({ max: MAX_ENTRIES, ttlMs: TTL_MS });

/**
 * Запоминает найденные раздачи по стабильному `id`.
 * Нужен, чтобы `POST /api/transmission/add { releaseId }` мог достать магнит:
 * публичный ответ поиска наружу эти поля не отдаёт.
 *
 * `context` — тип тайтла и признак анимации: по ним выбирается каталог загрузки.
 * Клиент этот выбор не присылает, иначе каталог стал бы управляемым извне.
 */
export function rememberReleases(items: InternalRelease[], context?: ReleaseContext): void {
  for (const item of items) {
    if (typeof item?.id === 'string' && item.id.length > 0) {
      store.set(item.id, { release: item, context });
    }
  }
}

/** Возвращает раздачу по id или undefined, если индекс пуст / запись протухла (TTL). */
export function getReleaseById(id: string): InternalRelease | undefined {
  return store.get(id)?.release;
}

/** Контекст раздачи для выбора каталога загрузки. */
export function getReleaseContext(id: string): ReleaseContext | undefined {
  return store.get(id)?.context;
}
