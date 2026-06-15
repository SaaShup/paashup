# Adding a token per user

Every API token belongs to **exactly one user** and acts with that user's identity and
permissions — there is no shared or "global" token. This page covers the ways to add a
token _for a user_, depending on who is doing it and what access they have.

| You want to…                                   | See                          |
| ---------------------------------------------- | ---------------------------- |
| Let a signed-in user mint their own token      | **1. Self-service**          |
| Give an existing instance its first credential | **2. Deploy-time bootstrap** |
| Add a token for _another_ user (e.g. a bot)    | **3. SQLite script**         |

> A token always belongs to the **authenticated caller**, so the REST/UI path can only
> create a token for _yourself_. To create one for a **different** user, an operator uses
> the bootstrap or script methods below.

## 1. Self-service: the user creates their own

This is the normal path. The user signs in (local login or OIDC/SSO), opens **API keys**
in the sidebar, clicks **Create a key**, and copies it once. See the **API keys** page for
the full UI walkthrough.

Equivalently, over REST with an existing credential (a Token **or** an SSO `Bearer` JWT):

```bash
curl -X POST http://localhost:8000/api/users/tokens/ \
  -H 'Authorization: Token <existing-key>' \
  -H 'Content-Type: application/json' \
  -d '{"description":"my laptop","write_enabled":true}'
```

The response includes the full `key` **once** — store it immediately:

```json
{
  "id": 7,
  "description": "my laptop",
  "write_enabled": true,
  "expires": null,
  "key": "0123456789abcdef…",
  "last4": "cdef"
}
```

| Method   | Path                      | Purpose                                              |
| -------- | ------------------------- | ---------------------------------------------------- |
| `GET`    | `/api/users/tokens/`      | List **your** keys (masked).                         |
| `POST`   | `/api/users/tokens/`      | Create a key for yourself; full `key` returned once. |
| `DELETE` | `/api/users/tokens/{id}/` | Revoke one of **your** keys.                         |

Body fields for `POST`: `description` (string), `expires` (ISO timestamp or `null`),
`write_enabled` (`true` = read-write, `false` = read-only).

## 2. Deploy-time bootstrap (`PB_SEED_TOKEN`)

On a secure-by-default instance (`PB_AUTH_REQUIRED=1`) a fresh database has **no
credential** yet, so nobody can sign in to create one. Seed a token from the environment —
this works for both SQLite and MariaDB, including containers, and runs on boot:

```bash
PB_SEED_TOKEN=$(openssl rand -hex 20)   # a 40-hex NetBox-style key
PB_SEED_USERNAME=admin                  # owning user, find-or-created (default: admin)
PB_SEED_TOKEN_READONLY=1                # optional — make it read-only
```

It is **idempotent**: if a token with that key already exists, nothing changes. The owning
user is created if missing. Then authenticate with it:

```bash
curl -H "Authorization: Token $PB_SEED_TOKEN" http://localhost:8000/api/dcim/devices/
```

Set `PB_SEED_USERNAME` to add the token to a particular user (e.g. a dedicated service
account). See `docs/DEPLOYMENT.md` for the full deployment reference.

## 3. Add a token for a specific user (SQLite)

When you have filesystem access to a SQLite database, the bundled script adds a token to
**any** user (find-or-created), which is the simplest way to provision a token for someone
other than yourself:

```bash
# read-write token for "alice" (key auto-generated and printed once)
node scripts/seed-token.mjs ./paas2box.db --user alice

# read-only token for a CI bot, with an explicit key
node scripts/seed-token.mjs ./paas2box.db --user ci-bot --read-only --key "$(openssl rand -hex 20)"
```

It prints the key once and is idempotent by key. For MariaDB or containerized deploys,
prefer the `PB_SEED_TOKEN` environment method above.

## Machine & service accounts

For CI, agents, and integrations, give each its **own user** (e.g. `ci-bot`, `docker-agent`)
and its own token, rather than reusing a person's key. This keeps `last_used` audit trails
meaningful and lets you revoke one integration without affecting others. Create the user's
token with method 2 (`PB_SEED_USERNAME`) or method 3 (`--user`).

## Token format & usage

- Keys are **40 hex characters** (NetBox-compatible). Send them as the header
  `Authorization: Token <key>`.
- The plaintext key is shown **only once** (on creation); afterwards only a masked value
  like `••••••••••••••••a1b2` is stored/returned — the last 4 chars are kept so keys are
  distinguishable.
- Choose the **least privilege**: read-only for clients that only `GET`, and set an
  **expiration** where you can. Write attempts with a read-only token return
  `403 This token is read-only.`

## Revoking

- **UI:** API keys → **Revoke** (immediate; the client then gets `403`).
- **REST:** `DELETE /api/users/tokens/{id}/` for your own keys.
- **Operator:** delete the row from `auth_token` (by `key` or `user_id`) in the database.

If a key leaks, revoke it immediately and issue a new one.
