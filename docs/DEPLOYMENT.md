# Deployment guide

paas2box ships as a single container that serves **everything on one port**: the REST API
at `/api/`, the OpenAPI schema at `/api/schema/`, the WebSocket change-feed at `/api/ws/`,
and the built Vue SPA at `/`. SQLite is the default store (one file on a volume); MariaDB
is supported for larger installs.

> **Secure by default.** `PB_AUTH_REQUIRED=1` — anonymous requests get `403` and the
> WebSocket requires a token. Before going live you **must** provide a credential: either
> pre-seed an API token (`PB_SEED_TOKEN`) or configure OIDC (below). For local dev only,
> set `PB_AUTH_REQUIRED=0`.

## Quick start (Docker, SQLite)

```bash
docker build -t paas2box .
docker run -d --name paas2box -p 8000:8000 \
  -e PB_MIGRATE=1 \
  -e PB_SEED_TOKEN="$(openssl rand -hex 20)" \
  -v paas2box-data:/data \
  paas2box
# then call the API with:  Authorization: Token <the value above>
```

`PB_MIGRATE=1` applies the bundled SQLite migrations on boot (Node-native, no Python in the
image). The DB persists in the `paas2box-data` volume at `/data/paas2box.db`.

## Environment variables

### Database

| Var | Default | Notes |
|-----|---------|-------|
| `PB_DIALECT` | `sqlite` | `sqlite` or `mariadb` |
| `PB_SQLITE_FILE` | `/data/paas2box.db` (image) | SQLite file path |
| `PB_MIGRATE` | — | `1` → apply SQLite migrations on container start |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | — | MariaDB connection (`PB_DIALECT=mariadb`) |

For MariaDB, run migrations separately (they are not auto-applied):
`python3 migrations/migrate.py --dialect mariadb --database paas2box --host … --user … --password …`.

### Server

| Var | Default | Notes |
|-----|---------|-------|
| `PORT` | `8000` | HTTP listen port |
| `BASE_URL` | `http://localhost:<PORT>` | Public base URL — set this behind a proxy/TLS so generated `url`/`display_url` and webhook absolute links are correct |
| `PB_WEB_ROOT` | `/app/web` (image) | Directory of the built SPA to serve; unset = API only |
| `PB_REALTIME` | on | `0` disables the `/api/ws/` change-feed |

### Authentication & bootstrap

| Var | Default | Notes |
|-----|---------|-------|
| `PB_AUTH_REQUIRED` | `1` | `1` = reject anonymous (REST + WS); `0` = allow anonymous (**dev only**) |
| `PB_SEED_TOKEN` | — | Provision this API token on boot (idempotent). Use a strong random value |
| `PB_SEED_USERNAME` | `admin` | Owner of the seeded token (find-or-created) |
| `PB_SEED_TOKEN_READONLY` | — | `1` → the seeded token is read-only |

With a fresh DB and no OIDC there is no way to mint the first token interactively, so seed
one (above) or enable OIDC. You can also insert a token directly:
`node scripts/seed-token.mjs <db-file> --user admin`.

### SSO / OIDC

Configure **one** provider with the `PB_OIDC_*` vars below, or **several at once** with
`PB_OIDC_PROVIDERS=keycloak,google` plus per-provider `PB_OIDC_<ID>_*` vars (same suffixes,
e.g. `PB_OIDC_GOOGLE_CLIENT_SECRET`). Interactive login uses a server-side
code→token exchange (a Backend-for-Frontend): the browser never holds a client secret or a
provider token. See [SSO-API-ACCESS.md](SSO-API-ACCESS.md) for headless/API access.

| Var | Applies to | Notes |
|-----|------------|-------|
| `PB_OIDC_PROVIDERS` | — | Comma list of provider ids; omit to use the single legacy provider below |
| `PB_OIDC_ISSUER` | all | Discovery base, e.g. `https://kc/realms/paasbox` or `https://accounts.google.com` |
| `PB_OIDC_CLIENT_ID` | all | OAuth client id |
| `PB_OIDC_CLIENT_SECRET` | confidential clients | **Required for Google** (and any confidential client); held server-side only |
| `PB_OIDC_AUDIENCE` | all | id_token `aud` to require (defaults to the client id) |
| `PB_OIDC_USERNAME_CLAIM` | oidc | Claim used as the username (default `preferred_username`) |
| `PB_OIDC_WRITE_ROLE` | Keycloak | Realm/client role granting write. **Fail closed:** with no role configured, OIDC users are **read-only** |
| `PB_OIDC_WRITE_DEFAULT` | oidc | `1` → grant write to *every* authenticated user when no `WRITE_ROLE` is set (explicit opt-in; default off) |
| `PB_OIDC_ALLOWED_DOMAINS` | Google | **Required** — comma list of email domains allowed to sign in (fail-closed) |
| `PB_OIDC_WRITE_EMAILS` | Google | Comma list of emails granted write (others read-only) |
| `PB_OIDC_SESSION_TTL_HOURS` | all | Lifetime of the paas2box token minted at login (default `12`) |
| `PB_OIDC_<ID>_KIND` / `_LABEL` / `_SCOPES` | per-provider | `oidc`\|`google` (inferred from issuer), button label, scopes (`openid profile email`) |

Service-account `Authorization: Bearer <JWT>` (Keycloak) keeps working directly for
automation; static `Authorization: Token <key>` always works regardless of SSO.

#### Keycloak (public client)

```
PB_OIDC_PROVIDERS=keycloak
PB_OIDC_KEYCLOAK_ISSUER=https://kc.example.com/realms/paasbox
PB_OIDC_KEYCLOAK_CLIENT_ID=paasbox
PB_OIDC_KEYCLOAK_WRITE_ROLE=paasbox-write
PB_OIDC_KEYCLOAK_AUDIENCE=paasbox
```
In Keycloak: a **public** client (Standard Flow on), redirect URI `https://<host>/*`, and a
`paasbox-write` role assigned to users who should have write access.

#### Google (confidential client)

```
PB_OIDC_PROVIDERS=google
PB_OIDC_GOOGLE_ISSUER=https://accounts.google.com
PB_OIDC_GOOGLE_CLIENT_ID=<id>.apps.googleusercontent.com
PB_OIDC_GOOGLE_CLIENT_SECRET=<secret>            # REQUIRED — Google is confidential
PB_OIDC_GOOGLE_ALLOWED_DOMAINS=example.com       # REQUIRED — who may sign in (fail-closed)
PB_OIDC_GOOGLE_WRITE_EMAILS=admin@example.com    # who gets write (others read-only)
```
In Google Cloud Console: a **Web application** OAuth client, with the app URL
`https://<host>/` listed under **Authorized redirect URIs**.

> **Common Google mistakes** (both cause login to fail after the Google consent screen):
> - missing `PB_OIDC_..._CLIENT_SECRET` → `token exchange rejected … "client_secret is missing."`
> - missing `PB_OIDC_..._ALLOWED_DOMAINS` → every login is rejected `403 "No allowed domains configured"`.

Use both providers together by setting `PB_OIDC_PROVIDERS=keycloak,google` and the
`PB_OIDC_KEYCLOAK_*` + `PB_OIDC_GOOGLE_*` blocks above; the login page shows a button each.

### Webhooks (delivery tuning) & plugins

| Var | Default | Notes |
|-----|---------|-------|
| `PB_WEBHOOK_RETRIES` | `2` | Extra delivery attempts after the first (total tries = retries + 1) |
| `PB_WEBHOOK_BACKOFF_MS` | `500` | Base backoff between attempts |
| `PB_WEBHOOK_TIMEOUT_MS` | `8000` | Per-request timeout |
| `PB_SSRF_BLOCK_PRIVATE` | — | `1` → outbound webhooks & netbox-migrate also refuse loopback/RFC1918/ULA targets (metadata/link-local are always blocked). Enable for an internet-only egress posture |
| `PB_PLUGINS` | — | Extra plugin module specifiers (comma list), merged with `package.json` `paas2box.plugins` |
| `PB_CLOUDFLARE_BASE_URL` | Cloudflare API | Override for the Cloudflare plugin |

## docker-compose example

```yaml
services:
  paas2box:
    image: paas2box
    ports: ['8000:8000']
    environment:
      PB_MIGRATE: '1'
      BASE_URL: https://paasbox.example.com
      # bootstrap credential (or configure OIDC below)
      PB_SEED_TOKEN: ${PB_SEED_TOKEN}
      # SSO (Keycloak + Google)
      PB_OIDC_PROVIDERS: keycloak,google
      PB_OIDC_KEYCLOAK_ISSUER: https://kc.example.com/realms/paasbox
      PB_OIDC_KEYCLOAK_CLIENT_ID: paasbox
      PB_OIDC_KEYCLOAK_WRITE_ROLE: paasbox-write
      PB_OIDC_GOOGLE_ISSUER: https://accounts.google.com
      PB_OIDC_GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
      PB_OIDC_GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
      PB_OIDC_GOOGLE_ALLOWED_DOMAINS: example.com
      PB_OIDC_GOOGLE_WRITE_EMAILS: admin@example.com
    volumes:
      - paas2box-data:/data
volumes:
  paas2box-data:
```

## Behind a reverse proxy / TLS

- Set `BASE_URL` to the external HTTPS URL so generated links and webhook URLs are correct.
- Forward the WebSocket upgrade for `/api/ws/` (e.g. nginx `proxy_set_header Upgrade`/
  `Connection`); the SPA passes its token in the query string, so no header rewriting is needed.
- The container runs as a non-root user and serves HTTP; terminate TLS at the proxy.

## Verifying a deployment

```bash
# anonymous must be rejected when secure (expect 403)
curl -s -o /dev/null -w '%{http_code}\n' https://host/api/dcim/manufacturers/
# with the seeded token (expect 200)
curl -s -H "Authorization: Token $PB_SEED_TOKEN" https://host/api/dcim/manufacturers/
# OIDC providers advertised to the login page
curl -s https://host/api/auth/providers/
```
