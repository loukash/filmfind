import type { ApiErrorDTO } from '@filmfind/shared';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  IMAGE_CACHE_MAX_BYTES,
  IMAGE_CACHE_TTL_MS,
  ImageCache,
  MAX_IMAGE_BYTES,
  buildImageUrl,
  isImageSize,
  isValidImageFile,
  type CachedImage,
} from '../lib/images.js';

const IMAGE_REQUEST_TIMEOUT_MS = 10_000;

export interface ImgRoutesOptions {
  /** Подмена fetch для тестов; в проде используется глобальный fetch. */
  fetch?: typeof fetch;
}

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  const body: ApiErrorDTO = { code: 'BAD_REQUEST', message };
  return reply.code(400).send(body);
}

function upstreamError(reply: FastifyReply, message: string): FastifyReply {
  const body: ApiErrorDTO = { code: 'IMG_UPSTREAM_ERROR', message };
  return reply.code(502).send(body);
}

function sendImage(reply: FastifyReply, image: CachedImage): FastifyReply {
  return reply
    .code(200)
    .header('Content-Type', image.contentType)
    .header('Content-Length', String(image.body.byteLength))
    .header('Cache-Control', 'public, max-age=86400, immutable')
    .header('X-Content-Type-Options', 'nosniff')
    .send(image.body);
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Тело уже закрыто — ничего делать не нужно.
  }
}

export const imgRoutes: FastifyPluginAsync<ImgRoutesOptions> = async (app, opts) => {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const cache = new ImageCache(IMAGE_CACHE_MAX_BYTES, IMAGE_CACHE_TTL_MS);

  app.get<{ Params: { size: string; file: string } }>(
    '/api/img/:size/:file',
    async (request, reply) => {
      const { size, file } = request.params;

      // Никакого клиентского URL: размер — из белого списка, имя — по регулярке.
      if (!isImageSize(size) || !isValidImageFile(file)) {
        return badRequest(reply, 'Некорректный размер или имя файла изображения');
      }

      const cacheKey = `${size}/${file}`;
      const cached = cache.get(cacheKey);
      if (cached) return sendImage(reply, cached);

      let upstream: Response;
      try {
        upstream = await fetchImpl(buildImageUrl(size, file), {
          method: 'GET',
          headers: { accept: 'image/*' },
          signal: AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS),
        });
      } catch {
        return upstreamError(reply, 'Не удалось загрузить изображение с TMDB');
      }

      if (!upstream.ok) {
        await discardBody(upstream);
        return upstreamError(reply, `TMDB вернул HTTP ${upstream.status} для изображения`);
      }

      const contentType = upstream.headers.get('content-type') ?? '';
      if (!/^image\//i.test(contentType)) {
        await discardBody(upstream);
        return upstreamError(reply, 'TMDB вернул не изображение');
      }

      const declaredLength = Number(upstream.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
        await discardBody(upstream);
        return upstreamError(reply, 'Изображение превышает допустимый размер');
      }

      let body: Buffer;
      try {
        const data = await upstream.arrayBuffer();
        if (data.byteLength > MAX_IMAGE_BYTES) {
          return upstreamError(reply, 'Изображение превышает допустимый размер');
        }
        body = Buffer.from(data);
      } catch {
        return upstreamError(reply, 'Не удалось прочитать изображение');
      }

      const image: CachedImage = { body, contentType };
      cache.set(cacheKey, image);

      return sendImage(reply, image);
    },
  );
};
