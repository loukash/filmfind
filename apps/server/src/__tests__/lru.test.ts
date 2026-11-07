import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LruCache } from '../lib/lru.js';

describe('LruCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('хранит и возвращает значения', () => {
    const cache = new LruCache<string, number>({ max: 3, ttlMs: 1000 });
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('missing')).toBeUndefined();
    expect(cache.has('a')).toBe(true);
  });

  it('вытесняет самую старую запись', () => {
    const cache = new LruCache<string, number>({ max: 2, ttlMs: 1000 });
    cache.set('a', 1);
    cache.set('b', 2);
    // Обращение к «a» делает её свежей, значит вытеснится «b».
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);

    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('истекает по TTL', () => {
    const cache = new LruCache<string, number>({ max: 5, ttlMs: 1000 });
    cache.set('a', 1);

    vi.advanceTimersByTime(999);
    expect(cache.get('a')).toBe(1);

    vi.advanceTimersByTime(2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('поддерживает индивидуальный TTL и удаление', () => {
    const cache = new LruCache<string, number>({ max: 5, ttlMs: 1000 });
    cache.set('short', 1, 100);
    cache.set('long', 2, 5000);

    vi.advanceTimersByTime(200);
    expect(cache.get('short')).toBeUndefined();
    expect(cache.get('long')).toBe(2);

    expect(cache.delete('long')).toBe(true);
    expect(cache.get('long')).toBeUndefined();

    cache.set('x', 9);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
