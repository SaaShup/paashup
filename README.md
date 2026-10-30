# paashup

[![version](https://img.shields.io/github/v/tag/SaaShup/paashup?label=version)](https://github.com/SaaShup/paashup/tags)
[![node](https://img.shields.io/badge/node-24--slim-6cc24a)](Dockerfile)
[![license](https://img.shields.io/github/license/SaaShup/paashup)](LICENSE)
[![last commit](https://img.shields.io/github/last-commit/SaaShup/paashup)](https://github.com/SaaShup/paashup/commits/main)
[![repo size](https://img.shields.io/github/repo-size/SaaShup/paashup)](https://github.com/SaaShup/paashup)
[![top language](https://img.shields.io/github/languages/top/SaaShup/paashup)](https://github.com/SaaShup/paashup)
[![Tests](https://img.shields.io/github/actions/workflow/status/SaaShup/paashup/ci.yml?label=Tests&logo=github)](https://github.com/SaaShup/paashup/actions/workflows/ci.yml)
[![image](https://img.shields.io/badge/image-ghcr.io%2Fsaashup%2Fpaashup-2496ed?logo=docker&logoColor=white)](https://github.com/SaaShup/paashup/pkgs/container/paashup)

**An all-in-one datacenter console.** paashup gives you one place to see and manage
your infrastructure — sites, racks, devices, IP addresses, **virtual machines** and
**Docker containers** — from a live web UI or an API. And it's fast.

It is inspired by NetBox, the reference
tool for *documenting* infrastructure, and speaks the same API. But where NetBox only
records what you have, paashup's plugins connect to the real systems — Docker hosts,
OpenStack, Keycloak, Cloudflare — so you can **act on them**: start a container, open a
terminal, import your VMs, register a DNS record.

## Quick start

```bash
docker build -t paashup .
docker run -p 8000:8000 -e PB_MIGRATE=1 -v paashup-data:/data \
  -e PB_SEED_TOKEN="$(openssl rand -hex 20)" paashup
# then call the API with:  Authorization: Token <that value>
```

One container serves **everything on one port**:

| Path | What |
|------|------|
| `/` | Vue admin UI |
| `/api/` | REST API |
| `/api/schema/` | OpenAPI schema (Swagger UI at `/api/schema/swagger-ui/`) |
| `/api/status/` | public health/version probe |
| `/api/ws/` | WebSocket change-feed |

`PB_MIGRATE=1` applies the bundled SQLite migrations on boot. **Auth is secure by
default** (`403` for anonymous requests): seed a token with `PB_SEED_TOKEN` as above, or
enable OIDC. For local dev only, `-e PB_AUTH_REQUIRED=0` allows anonymous access.

- All environment variables, MariaDB, OIDC and docker-compose: [Deployment guide](docs/DEPLOYMENT.md)
- Running from source and hacking on the UI: [Development guide](docs/DEVELOPMENT.md)

## Features

**See everything in one place**
- Your whole inventory in one UI: sites, racks, devices, cables, IP addresses and
  prefixes, VLANs, clusters and virtual machines.
- **Live updates** — the UI refreshes on its own when anything changes, no reload.

**Manage, not just document**
- **Docker**: hosts, images, volumes, networks and containers — start, stop or restart
  a container, pull images, read logs, open an interactive terminal.
- **VMs on OpenStack**: connect a cloud and its servers, IPs and volumes show up as
  virtual machines — then create or delete VMs right from paashup.
- **Keycloak** and **Cloudflare DNS** managed from the same console.
- See [Built-in plugins](#built-in-plugins) for the details.

**Super fast and light**
- One small container, ready in **~2 seconds**.
- Runs on a single SQLite file for small setups, or MariaDB for large ones.

**Plays well with the rest**
- **NetBox-compatible API** for DCIM, IPAM and virtualization: scripts and integrations
  written for NetBox work against paashup.
- **Single sign-on** with Keycloak and/or Google — see the
  [Deployment guide](docs/DEPLOYMENT.md#sso--oidc) and
  [API access with SSO](docs/SSO-API-ACCESS.md).
- **Webhooks** to notify other tools when something changes — see
  [docs/WEBHOOKS.md](docs/WEBHOOKS.md).
- Extend it with your own [plugins](src/plugins/README.md).

## Built-in plugins

All loaded by default (via the `paashup.plugins` key in [package.json](package.json)) and
shown in the web UI under **plugins**.

| Plugin | What it does |
|--------|--------------|
| [docker](src/plugins/docker/README.md) | Docker hosts, images, volumes, networks and containers — pairs with [netbox-docker-agent](https://github.com/SaaShup/netbox-docker-agent) |
| [keycloak](src/plugins/keycloak/README.md) | Keycloak servers, realms, OIDC clients and redirect URIs — registers instance callbacks automatically |
| [netbox-migrate](src/plugins/netbox-migrate/README.md) | One-shot import of a live NetBox instance, with live progress |
| [cloudflare](src/plugins/cloudflare/README.md) | Cloudflare DNS zones and A/CNAME records, synced to the Cloudflare API |
| [openstack](src/plugins/openstack/README.md) | Imports an OpenStack cloud's VMs, IPs and volumes, and creates / deletes VMs |

## Documentation

| Topic | Doc |
|-------|-----|
| Deploying (env vars, OIDC, compose, TLS) | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| Development, local CI, code generation | [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) |
| API access with SSO (no frontend) | [docs/SSO-API-ACCESS.md](docs/SSO-API-ACCESS.md) |
| Webhooks | [docs/WEBHOOKS.md](docs/WEBHOOKS.md) |
| Writing a plugin | [src/plugins/README.md](src/plugins/README.md) |
| Porting a NetBox plugin | [docs/PLUGIN-PORTING.md](docs/PLUGIN-PORTING.md) |
| Data layer, API internals, conformance gaps | [src/README.md](src/README.md) |
| Web UI | [web/README.md](web/README.md) |

## Repository layout

| Path | What |
|------|------|
| [`openapi/`](openapi/) | Filtered NetBox OpenAPI spec (DCIM/IPAM/Virtualization) + extractor |
| [`datamodel/`](datamodel/) | Data model + generators → `data-model.json`, dual-dialect SQL, coverage report |
| [`migrations/`](migrations/) | Plain-SQL migrations (per dialect) + a no-ORM runner |
| [`src/`](src/) | TypeScript data layer + HTTP API (db abstraction, repository, serializer, auth, WebSocket feed) |
| [`web/`](web/) | Vue 3 + Vite + TS + Pinia admin UI — schema-driven, live over WebSocket |
| [`scripts/`](scripts/) | Code generation, migrations, token seeding, local CI |
| [`test/`](test/) | `node:test` suites incl. an OpenAPI contract test (ajv) |

## License

[MIT](LICENSE). The OpenAPI contract derives from NetBox (Apache-2.0).
