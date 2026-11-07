/**
 * Всё, что связано с проксированием постеров TMDB: белый список размеров,
 * валидация имени файла и in-memory кэш байтов.
 *
 * Кэш только в памяти (без диска): после рестарта контейнера картинки
 * перезагружаются с image.tmdb.org — это осознанный компромисс, чтобы не
 * управлять файловым кэшем и его инвалидацией.
 */

export const IMAGE_SIZES = ['w92', 'w154', 'w185', 'w342', 'w500', 'w780', 'original'] as const;

export type ImageSize = (typeof IMAGE_SIZES)[number];

const IMAGE_SIZE_SET: ReadonlySet<string> = new Set(IMAGE_SIZES);

/** Имя файла TMDB: только безопасные символы и известные расширения. */
export const IMAGE_FILE_PATTERN = /^[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/;

/** Единственный разрешённый upstream — исключает SSRF через подмену URL. */
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

/** Один постер больше 5 МБ считаем аномалией и не отдаём. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const IMAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const IMAGE_CACHE_MAX_BYTES = 64 * 1024 * 1024;

export function isImageSize(value: string): value is ImageSize {
  return IMAGE_SIZE_SET.has(value);
}

export function isValidImageFile(value: string): boolean {
  return IMAGE_FILE_PATTERN.test(value);
}

export function buildImageUrl(size: ImageSize, file: string): string {
  return `${TMDB_IMAGE_BASE}/${size}/${file}`;
}

export interface CachedImage {
  body: Buffer;
  contentType: string;
}

interface ImageCacheEntry {
  image: CachedImage;
  bytes: number;
  expiresAt: number;
}

/**
 * LRU-кэш изображений с ограничением по суммарному размеру байтов и TTL.
 * Порядок в Map: старые записи в начале, свежие в конце.
 */
export class ImageCache {
  private readonly map = new Map<string, ImageCacheEntry>();
  private readonly maxBytes: number;
  private readonly ttlMs: number;
  private totalBytes = 0;

  constructor(maxBytes: number = IMAGE_CACHE_MAX_BYTES, ttlMs: number = IMAGE_CACHE_TTL_MS) {
    this.maxBytes = Math.max(1, Math.floor(maxBytes));
    this.ttlMs = Math.max(0, Math.floor(ttlMs));
  }

  get size(): number {
    return this.map.size;
  }

  get sizeBytes(): number {
    return this.totalBytes;
  }

  get(key: string): CachedImage | undefined {
    const entry = this.map.get(key);
    if (entry === undefined) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.remove(key, entry);
      return undefined;
    }

    this.map.delete(key);
    this.map.set(key, entry);
    return entry.image;
  }

  set(key: string, image: CachedImage): void {
    const bytes = image.body.byteLength;
    if (bytes > this.maxBytes) return; // одна картинка не помещается в кэш целиком

    const existing = this.map.get(key);
    if (existing !== undefined) this.remove(key, existing);

    while (this.totalBytes + bytes > this.maxBytes) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.map.get(oldestKey);
      if (oldest === undefined) break;
      this.remove(oldestKey, oldest);
    }

    this.map.set(key, { image, bytes, expiresAt: Date.now() + this.ttlMs });
    this.totalBytes += bytes;
  }

  clear(): void {
    this.map.clear();
    this.totalBytes = 0;
  }

  private remove(key: string, entry: ImageCacheEntry): void {
    this.map.delete(key);
    this.totalBytes -= entry.bytes;
  }
}
