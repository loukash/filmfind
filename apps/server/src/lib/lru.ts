export interface LruCacheOptions {
  max: number;
  ttlMs: number;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

/**
 * Небольшой LRU-кэш с TTL.
 * Порядок в Map: старые записи в начале, свежие в конце.
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, Entry<V>>();
  private readonly max: number;
  private readonly ttlMs: number;

  constructor(options: LruCacheOptions) {
    this.max = Math.max(1, Math.floor(options.max));
    this.ttlMs = Math.max(0, options.ttlMs);
  }

  get size(): number {
    return this.map.size;
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (entry === undefined) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }

    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, ttlMs = this.ttlMs): void {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    this.evict();
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  private evict(): void {
    while (this.map.size > this.max) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) return;
      this.map.delete(oldestKey);
    }
  }
}
