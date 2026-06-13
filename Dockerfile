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
# ── Auth / SSO (set these at `docker run`/compose/Helm) ───────────────────────────
# Secure by default: PB_AUTH_REQUIRED=1 rejects unauthenticated requests. Provision a
# token (PB_SEED_TOKEN, below) or configure OIDC before use. Local dev only:
# PB_AUTH_REQUIRED=0 allows anonymous access.
#
# OIDC sign-in: configure ONE provider with the PB_OIDC_* vars below, OR several at once
# with PB_OIDC_PROVIDERS=keycloak,google + per-provider PB_OIDC_<ID>_* vars (same suffixes,
# e.g. PB_OIDC_GOOGLE_CLIENT_SECRET). The browser never sees the client secret — the
# authorization-code → token exchange runs server-side.
#
# Which vars each provider needs:
#   Keycloak  → PB_OIDC_ISSUER=https://kc/realms/<realm>, PB_OIDC_CLIENT_ID,
#               PB_OIDC_WRITE_ROLE   (public client; no secret)
#   Google    → PB_OIDC_ISSUER=https://accounts.google.com, PB_OIDC_CLIENT_ID,
#               PB_OIDC_CLIENT_SECRET     ← REQUIRED: Google is a confidential client;
#                                            without it login fails "client_secret is missing"
#               PB_OIDC_ALLOWED_DOMAINS=acme.com   ← REQUIRED: who may sign in (else all
#                                                     logins are rejected, fail-closed)
#               PB_OIDC_WRITE_EMAILS=admin@acme.com ← who gets write (others = read-only)
#   Also add the app URL (e.g. https://host/) to the provider's Authorized redirect URIs.
ENV PB_AUTH_REQUIRED=1 \
    PB_OIDC_PROVIDERS="" \
    PB_OIDC_ISSUER="" \
    PB_OIDC_CLIENT_ID="" \
    PB_OIDC_CLIENT_SECRET="" \
    PB_OIDC_AUDIENCE="" \
    PB_OIDC_USERNAME_CLAIM=preferred_username \
    PB_OIDC_WRITE_ROLE="" \
    PB_OIDC_ALLOWED_DOMAINS="" \
    PB_OIDC_WRITE_EMAILS=""
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
