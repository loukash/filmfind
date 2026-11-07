# FilmFind

Self-hosted веб-приложение для поиска фильмов и сериалов, поиска раздач через
Prowlarr и отправки выбранной раздачи в Transmission.

Один контейнер: Fastify-сервер раздаёт собранный React-фронтенд и проксирует
запросы к TMDB / Prowlarr / Transmission, поэтому браузеру не нужен доступ к
внутренним сервисам напрямую.

## Возможности

Сейчас готов этап 0 — каркас приложения:

- монорепо на npm workspaces: `apps/server`, `apps/web`, `packages/shared`;
- общий контракт типов и утилиты форматирования (`@filmfind/shared`);
- Fastify 5 + TypeScript, валидация env, health-check всех сервисов;
- React 19 + Vite + Tailwind CSS v4, дизайн-система и стайлгайд;
- multi-stage Docker-сборка и `docker-compose.yml`.

Поиск, раздачи и загрузки появятся в следующих этапах (см. «Статус реализации»).

## Быстрый старт (Docker)

```bash
cp .env.example .env
# отредактируйте .env: как минимум TMDB_API_KEY
docker compose up -d --build
```

Приложение: <http://localhost:8080>. Проверка состояния сервисов:

```bash
curl -s http://localhost:8080/api/health | jq
```

Если Prowlarr или Transmission запущены на хосте, включите в
`docker-compose.yml` вариант B (`extra_hosts`) и используйте адреса
`http://host.docker.internal:9696` и `http://host.docker.internal:9091`.
Если это контейнеры в общей docker-сети — включите вариант A (`networks`)
и обращайтесь по именам контейнеров.

## Локальная разработка

Требуется Node.js 22+ (проверено на Node 25) и npm.

```bash
npm install
npm run dev
```

- фронтенд (Vite): <http://localhost:5173>, `/api` проксируется на сервер;
- API: <http://localhost:8080>;
- стайлгайд дизайн-системы: <http://localhost:5173/styleguide>.

`npm install` достаточно выполнить один раз: пакеты связываются через
workspaces. `npm run dev` сам собирает `@filmfind/shared` перед запуском
сервера, поэтому отдельная команда сборки не нужна.

Другие команды:

```bash
npm run build      # shared → server → web
npm test           # vitest: shared и server
npm run typecheck
npm run lint       # заглушка: линтер в следующих волнах
```

### Отдельный запуск пакетов

```bash
npm run build -w @filmfind/shared   # обязательно один раз перед запуском server отдельно
npm run dev -w @filmfind/server
npm run dev -w @filmfind/web
```

## Настройка внешних сервисов

Все переменные и комментарии — в [`.env.example`](./.env.example).

### TMDB

1. Зарегистрируйтесь на <https://www.themoviedb.org/>.
2. Откройте Settings → API и получите API Key (v3) или Read Access Token (v4).
3. Укажите значение в `TMDB_API_KEY`. Токен v4 определяется автоматически по
   префиксу `eyJ` и отправляется как `Authorization: Bearer`.

### Prowlarr

1. Откройте Prowlarr → Settings → General.
2. Скопируйте **API Key** в `PROWLARR_API_KEY`.
3. В `PROWLARR_URL` укажите базовый адрес, например `http://prowlarr:9696`
   или `http://host.docker.internal:9696`.

### Transmission

1. Включите удалённый доступ: Settings → Remote → «Allow remote access»
   (RPC включён по умолчанию на порту 9091).
2. Если включён whitelist, добавьте адрес, с которого приходит запрос:
   для контейнера на хосте это обычно `172.17.*.*`, для общей docker-сети —
   подсеть этой сети. Не отключайте whitelist без необходимости.
3. При необходимости задайте `TRANSMISSION_USER` / `TRANSMISSION_PASSWORD`
   (Settings → Remote → Authentication).
4. `TRANSMISSION_URL` — база (`http://host.docker.internal:9091`) или полный
   RPC-адрес (`.../transmission/rpc`).

## Безопасность

> **Не публикуйте FilmFind в интернет без VPN или reverse proxy с HTTPS и
> аутентификацией.** Приложение управляет загрузками и обращается к вашим
> приватным сервисам; встроенной авторизации пока нет.

Рекомендуется держать приложение в локальной сети или за VPN
(Tailscale/WireGuard), а наружу выставлять только через reverse proxy
(Caddy/nginx/Traefik) с TLS и Basic Auth/OIDC.

Дополнительно: секреты хранятся только в `.env`, который исключён из git;
логгер Fastify маскирует заголовки авторизации, ключи и пароли.

## Статус реализации

- [x] **Этап 0** — монорепо, контракт `@filmfind/shared`, сервер с `/api/health`,
      дизайн-система, стайлгайд, Docker.
- [x] **Этап 1** — клиент TMDB: поиск, карточка тайтла, прокси постеров.
- [x] **Этап 2** — клиент Prowlarr, парсер качества релизов (серверная часть).
- [ ] **Этап 3** — клиент Transmission, экран загрузок, отправка раздачи.
- [ ] **Этап 4** — экраны поиска/тайтла/раздач, авторизация, полировка, e2e.

## Структура

```
apps/
  server/        Fastify API + раздача статики в prod
  web/           React + Vite + Tailwind, дизайн-система в src/ui
packages/
  shared/        DTO-контракт, форматирование, парсер качества
Dockerfile
docker-compose.yml
```

Технические решения и отклонения описаны в [`NOTES.md`](./NOTES.md).
