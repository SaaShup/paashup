# Keycloak

This plugin (loaded by default) manages **Keycloak** servers, realms, OIDC clients and
their redirect URIs, so when you provision a new platform instance, its OAuth
callback / post-logout URLs get registered in Keycloak automatically, instead of by
hand.

## Adding a server

Click **Keycloak → Servers → + Add**, or use `POST /api/plugins/keycloak/servers/` with the server's URL and admin credentials.

- The connection is tested first.
- On success, paashup **auto-discovers** every realm and client on that server
  (including client secrets) and mirrors their redirect URIs locally.
- **Deleting** a server only removes paashup's local mirror, nothing is touched on
  Keycloak itself.

## Realms and clients: writes are real

- `/api/plugins/keycloak/realms/`: `POST` / `PATCH` / `DELETE` create, rename or
  delete the realm **on Keycloak itself**.
- `/api/plugins/keycloak/clients/`: `POST` creates a **confidential OIDC client**
  with the Authorization Code flow enabled; Keycloak generates its secret, which paashup
  stores locally. `POST {id}/regenerate-secret/` rotates it.
- `/api/plugins/keycloak/redirect-urls/`: each client's callback (`kind=callback`) and
  post-logout (`kind=post_logout`) URIs. Reads re-sync from Keycloak; adding or deleting
  a row writes the change to Keycloak immediately.

## Registering an instance's URLs (for orchestrators)

An **orchestrator** here means whatever system automatically creates and destroys your
platform instances (a provisioning pipeline, a control plane, ...). Rather than making
it create redirect URL rows one by one by hand, two dedicated endpoints let it register
or remove an instance's URLs in a single, automation-friendly call:

- `POST /api/plugins/keycloak/redirect-urls/register/`: body: `url`, `realm`,
  `client_id`, `callback_path`, `postlogout_path?` (optional). Registers both the
  callback and post-logout URLs on that realm/client in one call. It's **idempotent**
  (calling it again for the same instance is harmless) and assumes `https://`.
- `POST /api/plugins/keycloak/redirect-urls/unregister/`: same body, removes the same
  URLs.

Responses: `200` returns the touched `urls` (or a `skipped` reason if nothing changed);
`400` lists missing fields; `502` means every Keycloak write failed, and is safe to
retry.

**Contract**: call `register/` right after creating an instance, and `unregister/` right
before deleting it, so Keycloak never accumulates stale redirect URLs.

Next: **Cloudflare DNS** covers managing DNS zones and records the same way.
