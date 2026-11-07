# Волна 1 — Prowlarr и поиск раздач

## Что сделано

| Файл | Содержимое |
| --- | --- |
| `apps/server/src/clients/prowlarr.ts` | `createProwlarrClient`, `ProwlarrError`, нормализация `ReleaseResource` → `InternalRelease`, `checkHealth` сохранён без изменений |
| `apps/server/src/lib/releases.ts` | `createReleasesService`: варианты запросов, дедупликация, фильтрация, сортировка, кэш 3 мин |
| `apps/server/src/routes/releases.ts` | `GET /api/releases`, zod-валидация, маппинг ошибок в 400/502/503 |
| `apps/server/src/__tests__/{prowlarr,releases,releases-route}.test.ts` | тесты без реальной сети (внедряемый `fetch`, фейковые клиенты) |

`routes/index.ts`, `clients/tmdb.ts`, `routes/titles.ts`, `routes/img.ts` и `packages/shared/**` не трогались.

## Подключение роута (для оркестратора)

```ts
import { releasesRoutes } from './releases.js';

await app.register(releasesRoutes, { config });
// опционально: { config, tmdb, prowlarr, cache } — для тестов/внедрения
```

Опции (`ReleasesRoutesOptions`): `config` обязателен, `tmdb` / `prowlarr` / `cache` опциональны.
Если клиенты не переданы, создаются из `config`. Регистрировать нужно **без префикса**:
путь внутри плагина абсолютный (`/api/releases`).

## Prowlarr API: что подтверждено, а что принято по аналогии

Сверялся с официальным `openapi.json` Prowlarr (`/api/v1/openapi.json`, схема из репозитория
`Prowlarr/Prowlarr@develop`) и исходниками `SearchController.cs` / `SearchResource.cs` /
`ReleaseResource.cs`. Swagger конкретного инстанса 2.6.5 недоступен, но схема v1 стабильна.

**Подтверждено документацией:**

- `GET /api/v1/search`, заголовок `X-Api-Key`.
- Query-параметры: `query`, `type`, `indexerIds` (`int[]`), `categories` (`int[]`), `limit`, `offset`.
  Ровно тот набор, что в задаче; лишних нет.
- Ответ — **массив** `ReleaseResource[]` (не объект с полем `releases`).
- Поля `ReleaseResource`: `guid`, `title`, `size` (int64), `indexer`, `indexerId`, `publishDate`
  (date-time), `infoHash`, `seeders`, `leechers`, `magnetUrl`, `downloadUrl`, `protocol`,
  `categories` — **массив объектов** `IndexerCategory { id, name, subCategories }`, а не числа.
- `type` в API принимает `search` (значение по умолчанию), `tvsearch`, `movie`, `music`, `book`.
  `moviesearch` из нашего интерфейса — алиас, наружу уходит как `movie`.
- `GET /api/v1/indexer` — массив `IndexerResource` с `id`, `name`, `enable`, `protocol`.
- `downloadUrl` и `magnetUrl` в ответе — **прокси-ссылки Prowlarr** (`.../download?apikey=...`),
  то есть содержат API-ключ. Наружу не отдаются ни в каком виде.
- Prowlarr дедуплицирует результаты по `guid` между индексаторами ещё до ответа
  (`DeDupeReleases`), поэтому дедупликация сервиса — второй уровень (infoHash / название+размер).

**Принято по аналогии / наше решение:**

- `indexerIds` и `categories` отправляются **повторяющимися ключами**
  (`?categories=2000&categories=5070`). ASP.NET Core понимает и `2000,5070`, но повтор ключей
  самый предсказуемый вариант.
- Частичный сбой индексатора. В Prowlarr 2.x `DispatchIndexer` ловит исключение, пишет его в лог
  и возвращает пустой список — в ответе 200 «упавшего» индексатора обычно **нет вообще**.
  Поэтому клиент дополнительно защищается: записи без `title` и `guid` (и записи с полями
  `error`/`message`) считаются заглушками, их имена попадают в `warnings`, остальные результаты
  сохраняются. На уровне сервиса частичный сбой ловится через `Promise.allSettled`: упавший
  вариант запроса даёт warning, остальные результаты остаются.
- `size` в `ReleaseDTO` обязателен (число), поэтому при отсутствии в ответе пишется `0`.
- `categories` в DTO — плоский список id: верхний уровень + вложенные `subCategories`.
- `id`: `infoHash` в нижнем регистре → `sha1(guid)` → `sha1(normalizedTitle:size)`.
- `type=search` для всех вариантов из сервиса: сезон и год уже внутри строки запроса,
  `tvsearch`/`movie` не нужны и хуже переносятся разными индексаторами.

## Решения сервиса поиска

- **Варианты запросов** (параллельно, `Promise.allSettled`):
  локализованное название, оригинальное (если нормализованно отличается), для фильма
  `название + год`, для сериала `название + S{NN}` и `название + {NN} сезон`.
  При заданном `q` TMDB не вызывается вообще.
- **Категории Newznab**: фильм `[2000]`, сериал `[5000]`. Аниме (`isAnimation` из TMDB)
  добавляется к базовой категории: фильм `[2000, 5070]`, сериал `[5000, 5070]`.
  В задаче явно оговорён только аниме-сериал; для аниме-фильма 2000 добавлен как более широкий
  охват (Prowlarr объединяет категории по OR). Расхождение осознанное.
- **Дедупликация**: `infoHash`, иначе `normalizeReleaseTitle(title) + size`. Из дублей —
  больше сидов, при равенстве — более поздний `publishDate`.
- **Фильтрация**: год в названии допускается ±1 от года тайтла; если годов несколько
  (`1917.2019.1080p`), достаточно совпадения любого — иначе название-год («1917») ложно
  отбрасывалось бы. Сезон: если найден и не совпадает — отбросить, если не найден — оставить.
  Учитываются `S01`, `S01E02`, `1 сезон`, `сезон 1`, `Season 1`, `[1x02]` и `quality.season`.
- **Сортировка**: сиды ↓ → разрешение ↓ (2160 > 1080 > 720 > 576 > 480) → размер ↓.
- **Кэш**: `LruCache`, TTL 3 минуты, 200 записей, ключ — тип/`titleId`/сезон/`q`/`indexerIds`/`limit`.
  Сервис создаётся один раз на плагин, поэтому кэш живёт между запросами.
- **Лимит** `1..300`, по умолчанию 100; `limit` передаётся в каждый вариант запроса,
  после дедупликации/сортировки список обрезается до `limit`.

## Расхождения и зависимости

- **`normalizeReleaseTitle`** пока нет в `@filmfind/shared`, поэтому реализован локально в
  `lib/releases.ts` и импортируется клиентом Prowlarr. Когда появится в shared — заменить импорт,
  поведение (нижний регистр, не-буквы/цифры → пробел) совпадает с ожидаемым.
- **`parseRelease`** сейчас заглушка (`{}`). `quality` заполняется им как есть. Чтобы сортировка
  по разрешению работала уже сейчас, `resolutionRank` при пустом `quality.resolution`
  подстраховывается регуляркой по названию. После реализации `parseRelease` фолбэк можно убрать.
- **Публичный DTO.** Сервис возвращает `{ items, warnings, internal }`: `items` — копии без
  `magnetUrl`/`downloadUrl`, `internal` — полные объекты для волны 2 (скачивание). Роут отдаёт
  только `items` и `warnings`, поэтому утечка ключа Prowlarr исключена конструктивно.
- **Ошибки**: `PROWLARR_NOT_CONFIGURED` / `TMDB_NOT_CONFIGURED` → 503; `PROWLARR_UNAUTHORIZED` →
  502 (ключ задан, но отклонён — это не конфигурация); прочие `PROWLARR_*`/`TMDB_*` → 502;
  `TMDB_NOT_FOUND` → 404; невалидные параметры → 400 `VALIDATION_ERROR`.
- **`checkHealth`** в `clients/prowlarr.ts` не изменён и по-прежнему ходит в
  `/api/v1/system/status` через `fetchJson` с таймаутом 2 с.

## Проверка

```bash
npm run build -w @filmfind/shared && npm run build -w @filmfind/server
npm run test -w @filmfind/server
```
