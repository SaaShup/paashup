# API keys

API keys let **service and machine clients** authenticate without an interactive
(OIDC/SSO) login. A key is a long-lived token you send on every request:

```bash
curl -H 'Authorization: Token <your-key>' http://localhost:8000/api/dcim/devices/
```

They sit alongside browser/SSO authentication — humans sign in with OIDC, scripts and
integrations use an API key.

## Managing keys in the UI

Open **API keys** in the sidebar. Each key belongs to you (the signed-in user) and acts
with your identity.

- **Create a key** — give it a name/description, optionally set an expiration date, and
  choose **read-only** or read-write. Read-only keys can `GET` but cannot create, update,
  or delete.
- **Copy it once** — the full key is shown **only once**, right after creation. Copy it
  and store it somewhere safe (a secrets manager, CI variable, …). Afterwards the list
  shows only a masked value like `••••••••••••••••a1b2` — the last 4 characters are kept
  so you can tell keys apart.
- **Track usage** — the list shows each key's **created** and **last-used** timestamps, so
  you can spot stale or unused keys.
- **Revoke a key** — deleting it takes effect immediately; any client still using it gets
  `403`.

## Read-only vs read-write

Pick the least privilege a client needs:

- **Read-write** — full access (subject to your own permissions).
- **Read-only** — safe `GET` access; write attempts return `403 This token is read-only.`

## Expiration

An optional expiration date makes a key stop working after that moment. Expired keys are
rejected with `403`; revoke or recreate as needed.

## Using a key

Send it in the `Authorization` header with the `Token` scheme:

```bash
curl -H 'Authorization: Token 0123456789abcdef…' \
     http://localhost:8000/api/plugins/docker/hosts/
```

## REST endpoints

The UI is backed by these per-user endpoints (authentication required):

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/api/users/tokens/` | List **your** keys (masked). |
| `POST` | `/api/users/tokens/` | Create a key. Response includes the full `key` **once**. Body: `{ "description": "...", "expires": "2026-01-01T00:00:00Z" \| null, "write_enabled": true }`. |
| `DELETE` | `/api/users/tokens/{id}/` | Revoke one of your keys. |

Keys are scoped to their owner: you only ever see or revoke your own.

## Security notes

- Treat a key like a password. Anyone with it can act as you (within its read/write level).
- Prefer **read-only** keys for clients that only read, and set an **expiration** where you can.
- If a key leaks, **revoke** it immediately and create a new one.
