# syntax=docker/dockerfile:1

# ---------- Сборка ----------
FROM node:22-alpine AS builder

WORKDIR /app

ENV npm_config_fund=false \
    npm_config_audit=false

# Сначала манифесты — слой с зависимостями кэшируется.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY apps/web apps/web

# shared → server → web; порядок задан в корневом scripts.build.
RUN npm run build

# ---------- Runtime ----------
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/apps/server/dist apps/server/dist
COPY --from=builder /app/apps/web/dist apps/web/dist

USER node

EXPOSE 8080

CMD ["node", "apps/server/dist/index.js"]
