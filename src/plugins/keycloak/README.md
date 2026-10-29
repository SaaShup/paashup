# Keycloak management (built-in plugin)

Manages Keycloak servers, realms, OIDC clients and their redirect URIs — so platform
instances get their OAuth callback / post-logout URLs registered in Keycloak
automatically. It is **loaded by default** and appears in the web UI with drill-down
navigation (**Servers → Realms → Clients → Redirect URLs**).

| Endpoint | Notes |
|----------|-------|
| `/api/plugins/keycloak/servers/` | Keycloak servers (URL + admin credentials). Creating one tests the connection, then auto-discovers realms and clients (with their secrets) and mirrors their URIs. Detail embeds `realms`. Deleting only removes the local mirror |
| `/api/plugins/keycloak/realms/` | realm writes are **real**: `POST`/`PATCH`/`DELETE` create/rename/delete the realm in Keycloak. Reads re-sync from Keycloak. Detail embeds `clients` |
| `/api/plugins/keycloak/clients/` | client writes are **real**: `POST` creates a **confidential OIDC client** (Authorization Code flow enabled) — Keycloak generates its secret, stored locally; `POST {id}/regenerate-secret/` rotates it. Detail embeds `redirect_urls` |
| `/api/plugins/keycloak/redirect-urls/` | mirror of each client's redirect (`kind=callback`) and post-logout (`kind=post_logout`) URIs. Reads re-sync from Keycloak; adding/deleting a row writes to Keycloak |
| `POST /api/plugins/keycloak/redirect-urls/register/` | for orchestrators: registers an instance's callback + post-logout URLs on a realm/client. Body: `url`, `realm`, `client_id`, `callback_path`, `postlogout_path?`. Idempotent; `https://` is assumed |
| `POST /api/plugins/keycloak/redirect-urls/unregister/` | same body as `register/` — recomputes and removes the same URLs |

## Orchestrator contract

After creating an instance, `POST register/` with the instance URL; before deleting it,
`POST unregister/` with the same body.

- `200` returns the touched `urls` (or a `skipped` reason)
- `400` lists missing fields
- `502` means every Keycloak write failed — safe to retry

Keycloak is simulated by a local HTTP server in the tests:
[test/keycloak.test.mjs](../../../test/keycloak.test.mjs).
