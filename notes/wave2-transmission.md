# Волна 2 — Transmission RPC, отправка раздачи, список загрузок

## Что сделано

- `clients/transmission.ts` — полноценный клиент классического RPC (409-хендшейк, кэш session id, torrent-add / torrent-get / session-get), `checkHealth` сохранён.
- `lib/release-store.ts` — индекс найденных раздач: `rememberReleases` / `getReleaseById`, LRU 2000 записей TTL 30 мин (переиспользован `LruCache` из `lib/lru.ts`).
- `lib/releases.ts` — минимальная правка: импорт `rememberReleases` + вызов `rememberReleases(internal)` сразу после `sorted.slice(0, limit)`. Больше ничего не менялось.
- `routes/transmission.ts` — `transmissionRoutes: FastifyPluginAsync<TransmissionRoutesOptions>`, полные пути `/api/transmission/add` и `/api/transmission/torrents`. `routes/index.ts` не тронут — регистрацию подключает оркестратор.
- Тесты: `__tests__/transmission.test.ts` (клиент, реальный `http.createServer` на случайном порту), `__tests__/transmission-route.test.ts` (роуты + release-store).

## 409-цикл

Transmission 3.00 отдаёт session id в 409. Логика в `rpc()`:

1. Запрос без session id → если 409, берём `X-Transmission-Session-Id` из заголовка, кэшируем в замыкании, повторяем.
2. Второй 409 подряд → обновляем id из свежего заголовка, повторяем ещё раз.
3. Третий 409 → `TRANSMISSION_SESSION_FAILED`. Максимум 3 попытки, без бесконечного цикла.
4. session id держится в замыкании клиента и переиспользуется: последующие вызовы идут сразу с ним, лишнего 409 нет (покрыто тестом).

Если 409 пришёл без заголовка — это тоже `TRANSMISSION_SESSION_FAILED` (нестандартное поведение сервера).

## Решения и расхождения со спекой/документацией

- **Формат RPC.** Всё по классике 3.00: `{ method, arguments, tag }`, поля `filename`/`metainfo`/`download-dir`/`paused`; ответ `torrent-added` / `torrent-duplicate`. JSON-RPC 2.0 не используется.
- **`createTransmissionClient(cfg: AppConfig)`** — как в ТЗ, сигнатура на всю конфигурацию (клиент сам берёт `cfg.transmission`). Это отличается от соседнего `createProwlarrClient`, который принимает узкий срез конфига; оставил по ТЗ, чтобы оркестратору не пришлось адаптировать.
- **403 тоже считается неавторизацией** (`TRANSMISSION_UNAUTHORIZED`): у linuxserver/transmission при неверном пароле может прийти и 403. В документации явно описан только 401 — отмечаю как сознательное расширение.
- **Коды статусов роута, не покрытые ТЗ:**
  - `TRANSMISSION_UNAUTHORIZED` → 502 (сбой апстрима, а не конфигурация);
  - `TRANSMISSION_UNAVAILABLE` / `TRANSMISSION_RPC_ERROR` / `TRANSMISSION_SESSION_FAILED` → 502;
  - скачивание `.torrent` не удалось (сеть/таймаут 15 с, HTTP != 200, пустой файл, >10 МБ) → 502 `TORRENT_DOWNLOAD_FAILED` — в разрешённых ТЗ статусах для этой ситуации кода не было.
- **releaseId есть, но у раздачи ни магнита, ни downloadUrl** → 400 `BAD_REQUEST` (в ТЗ случай не описан; 404 считаю неверным — раздача найдена).
- **Origin-проверка `.torrent`**: `new URL(downloadUrl).origin !== origin(PROWLARR_URL)` → 400 `UNSAFE_URL`. Если `PROWLARR_URL` не задан — проверка строгая (любое скачивание запрещено), fallback на «разрешить всем» опасен.
- **Размер `.torrent`**: лимит 10 МБ проверяется и по `content-length` (обрываем до чтения), и по фактическому размеру тела. Таймаут 15 с через `AbortSignal.timeout`.
- **Логи**: в `request.log` уходят только `releaseId` и `torrentId`. Магнит/downloadUrl (внутри API-ключ Prowlarr) не логируются и не возвращаются клиенту.
- **`tag`**: каждому RPC присваивается инкрементный `tag` — Transmission его эхом возвращает, это безобидно и помогает при отладке.
- **`torrent-get`**: запрашивает ровно 9 полей TorrentDTO — не тянем лишнего из RPC.
- **Ошибки маппинга torrent-get**: отсутствующие числовые поля → 0, а не undefined (Transmission в 3.00 отдаёт их всегда, защита от кривых форков). `eta=-1` проходит как есть.
- **`checkHealth`** сохранён (используется `/api/health`), переписан с `fetchJson` на прямой `fetch` с таймаутом 15 с и тем же 409-хендшейком; семантика ответа (`ServiceStatus`) прежняя, кроме чуть более конкретного сообщения при 409 без заголовка.

## Контроль секретности ответов

`GET /api/transmission/torrents` отдаёт только `TorrentDTO`; `add` возвращает `{ result, id?, name? }` — magnetUrl/downloadUrl наружу не утекают нигде (тест на магнит-путь проверяет отсутствие `metainfo` в RPC при отправке магнитом).

## Проверка

```sh
npm run build -w @filmfind/shared && npm run build -w @filmfind/server   # без ошибок
npm run test -w @filmfind/server                                        # 128 passed (103 прежних + 25 новых)
```

Тесты поднимают локальный `http.createServer` на случайном порту (порт 0, `127.0.0.1`) и ходят в него реальным `fetch`/`app.inject`; inject-подмена fetch используется в тесте «чужой origin → запрос не уходит».
