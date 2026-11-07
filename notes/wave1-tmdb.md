# Волна 1: клиент TMDB, роуты тайтлов, прокси постеров

## Что сделано

- `apps/server/src/clients/tmdb.ts` — клиент TMDB v3:
  - `createTmdbClient(cfg, deps?)` → `TmdbClient` с `searchMulti` / `getTitle`.
  - v4-токен (префикс `eyJ`) уходит `Authorization: Bearer`, v3-ключ — `api_key`
    в query.
  - Таймаут запроса 8 с через `AbortSignal.timeout`.
  - Типизированная `TmdbError` с кодами `TMDB_NOT_CONFIGURED`, `TMDB_NOT_FOUND`,
    `TMDB_UNAUTHORIZED`, `TMDB_UNAVAILABLE`; отсутствие ключа проверяется при
    вызове, а не на импорте.
  - `checkHealth` для `/api/health` сохранён без изменений.
- `apps/server/src/routes/titles.ts` — `export const titlesRoutes`:
  - `GET /api/titles/search?q=&page=` → `SearchResultDTO`.
  - `GET /api/titles/:type/:id` → `TitleDetailsDTO`.
  - Валидация zod; ошибки 400 отдаются через существующий обработчик `app.ts`
    (бросается ошибка со `statusCode = 400` → `{ code: 'BAD_REQUEST', message }`).
  - `TMDB_NOT_CONFIGURED` → 503, `TMDB_NOT_FOUND` → 404, `TMDB_UNAUTHORIZED` /
    `TMDB_UNAVAILABLE` → 502 с кодом ошибки TMDB.
  - Кэш: поиск 5 минут (500 записей), детали 30 минут (1000 записей). Ключ
    включает язык: `${language}|${q}|${page}` и `${language}|${type}|${id}`.
- `apps/server/src/routes/img.ts` — `export const imgRoutes`:
  - `GET /api/img/:size/:file`, размер только из белого списка
    `w92|w154|w185|w342|w500|w780|original`, имя файла строго
    `[A-Za-z0-9_-]+\.(jpg|png|webp)`.
  - URL всегда собирается как `https://image.tmdb.org/t/p/{size}/{file}` —
    клиентский URL не принимается (защита от SSRF). Path traversal, включая
    `%2F`/`%2e%2e`, не проходит регулярку → 400.
  - Ответ: `Content-Type` из upstream, `Cache-Control: public, max-age=86400,
    immutable`, `X-Content-Type-Options: nosniff`.
  - Не-2xx, не-image `Content-Type`, сетевая ошибка/таймаут и превышение размера
    → 502 `{ code: 'IMG_UPSTREAM_ERROR' }`, HTML никогда не отдаётся.
  - Лимит одного изображения — 5 МБ (проверяется и по `Content-Length`, и после
    чтения тела).
- `apps/server/src/lib/images.ts` — белый список размеров, валидация имени,
  `ImageCache` (LRU с учётом байтов).

## Контракт и интеграция

- `createTmdbClient` принимает `AppConfig` из `config.ts`; в файле он
  импортирован как `import type { AppConfig as Config }`, чтобы сигнатура
  читалась как в контракте. `Config` в `config.ts` не экспортируется, и трогать
  его было нельзя.
- Второй аргумент `deps?: { fetch?: typeof fetch }` опционален — контракт
  `createTmdbClient(cfg)` остаётся валидным, а тесты внедряют фейковый fetch.
- Регистрация роутов (это делает оркестратор):
  ```ts
  await app.register(titlesRoutes, { config });
  await app.register(imgRoutes);
  ```
  Обе плагин-функции также принимают `fetch` для тестов. Если `titlesRoutes`
  зарегистрировать без опций, он возьмёт конфигурацию из `process.env` через
  `loadConfig()`.
- `routes/index.ts`, `clients/prowlarr.ts`, `clients/transmission.ts` и
  `packages/shared/**` не изменялись.

## Кэш изображений

- Только in-memory, без диска: лимит ~64 МБ, TTL 24 ч, вытеснение по LRU при
  превышении суммарного размера. После рестарта контейнера кэш пуст и постеры
  один раз перезагружаются с TMDB. Диск не используем, чтобы не управлять
  файловым кэшем и его инвалидацией.
- В кэш попадают только успешные ответы с `Content-Type: image/*` и размером
  ≤ 5 МБ. Учёт размера — по `Buffer.byteLength`, без накладных расходов Map.

## Расхождения с ТЗ и особенности TMDB v3

Сверено с https://developer.themoviedb.org/reference (search-multi,
movie-details, tv-series-details, tv-series-external-ids) на 2025-10-01:

- **У сериалов нет `original_title` и `release_date`.** В TV-ответах только
  `original_name` и `first_air_date`. Поэтому локализованное название берётся из
  `name`, оригинальное — из `original_name`, год — из `first_air_date`.
- **`episode_run_time` у TV — массив и может быть пустым.** Берём `[0]`;
  при пустом массиве `runtime` не задаётся (в ТЗ это оговорено, но на практике
  пустой массив встречается чаще, чем ожидалось).
- **`seasons` содержит спецвыпуски.** TMDB отдаёт сезон 0 «Specials» с
  произвольным `episode_count` (в примере документации — 272). Сезоны не
  фильтруются: отдаём как есть, решение «показывать ли specials» — за UI.
- **`imdb_id` есть и в `movie/{id}` верхним уровнем.** Мы, как в ТЗ, берём
  `external_ids.imdb_id` через `append_to_response=external_ids` — это работает
  одинаково для movie и tv.
- **`vote_average = 0` означает «нет голосов»**, а не нулевой рейтинг; трактуем
  как отсутствие рейтинга. Округление до одного знака: `7.45 → 7.5`.
- **`poster_path`/`backdrop_path`/`air_date` могут быть `null` или пустой
  строкой** — в DTO превращаются в `undefined`.
- **`include_adult` — параметр только поиска**, в запросы деталей не добавляем
  (там его нет в спецификации). `language` и `include_adult=false` — в поиске.
- **Ошибки TMDB.** HTTP 401 соответствует `status_code: 7` (невалидный ключ),
  404 — `status_code: 34`. Роуты различают их по HTTP-статусу; тело ответа
  TMDB не пробрасывается клиенту, чтобы не светить детали.
- **Пустой `overview`/`status`** трактуется как отсутствие поля.

## Ограничения, зафиксированные осознанно

- Таймаут картинок — 10 с (в ТЗ таймаут 8 с указан только для клиента TMDB).
- Ответы TMDB (`search/multi`, `movie|tv/{id}`) не валидируются zod-схемой
  целиком: поля читаются защитно (`typeof`, массивы, null). При изменении
  формата API клиент не упадёт, а отдаст поля, которые смог разобрать.
- `page` в клиенте нормализуется (`Math.max(1, Math.trunc(page))`), но роут
  всё равно строго валидирует 1..500.

## Проверка

```bash
npm run build -w @filmfind/shared
npm run build -w @filmfind/server
npm run test -w @filmfind/server
```
