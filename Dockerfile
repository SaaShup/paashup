# syntax=docker/dockerfile:1

# ---- build stage: install all deps, compile TypeScript, prune to prod deps ----
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

# ---- web stage: build the Vue SPA ----
FROM node:24-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- runtime stage: minimal image, non-root, SQLite-ready, serves API + SPA ----
FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    PORT=8000 \
    PB_DIALECT=sqlite \
    PB_SQLITE_FILE=/data/paasbox.db \
    PB_WEB_ROOT=/app/web
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=web /web/dist ./web
COPY package.json ./
COPY migrations ./migrations
COPY scripts/migrate-sqlite.mjs ./scripts/migrate-sqlite.mjs
COPY docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh && mkdir -p /data && chown -R node:node /data /app

USER node
EXPOSE 8000
# Set PB_MIGRATE=1 to auto-apply SQLite migrations on startup.
ENTRYPOINT ["./docker-entrypoint.sh"]
