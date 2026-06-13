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
    PB_SQLITE_FILE=/data/paas2box.db \
    PB_WEB_ROOT=/app/web
# Auth / SSO knobs. Secure by default: PB_AUTH_REQUIRED=1 rejects unauthenticated requests
# (provision an API token or enable OIDC before use). For local dev only, run with
# PB_AUTH_REQUIRED=0 to allow anonymous access. Enable Keycloak/OIDC by setting at least
# PB_OIDC_ISSUER (+ PB_OIDC_CLIENT_ID for the web login page).
ENV PB_AUTH_REQUIRED=1 \
    PB_OIDC_ISSUER="" \
    PB_OIDC_AUDIENCE="" \
    PB_OIDC_CLIENT_ID="" \
    PB_OIDC_WRITE_ROLE="" \
    PB_OIDC_USERNAME_CLAIM=preferred_username
# Deploy-time bootstrap token (idempotent): set PB_SEED_TOKEN to provision an API key on
# first boot so a secure-by-default instance is usable before any OIDC login. Owned by
# PB_SEED_USERNAME (find-or-created). Unset = no seeding. Use a strong, random value.
ENV PB_SEED_TOKEN="" \
    PB_SEED_USERNAME=admin
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
