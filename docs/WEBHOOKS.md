# Webhooks

paashup fires configurable HTTP webhooks ([src/webhooks.ts](../src/webhooks.ts)) on object
**create/update/delete**, for **core and plugin** entities alike. Delivery tuning env vars
are listed in [DEPLOYMENT.md](DEPLOYMENT.md#webhooks-delivery-tuning--plugins).

| Endpoint | Notes |
|----------|-------|
| `/api/extras/webhooks/` | webhooks, managed as a normal CRUD resource |
| `/api/extras/webhook-deliveries/` | read-only, auditable delivery log |

## Options

- **Object-type + event filtering.**
- **Conditions** — fire only when fields match, NetBox event-rule style: `{and/or}`,
  `{attr,op,value}`, or a plain `{field: value}` map.
- Optional **HMAC-SHA512** signature, custom headers, TLS-verify toggle.
- **Retry with exponential backoff.**

## Templating

Jinja-style, NetBox-compatible. `payload_url`, each `additional_headers` value, and an
optional `body_template` are rendered with the event context:

- `{{ event }}`, `{{ model }}`, `{{ timestamp }}`, `{{ username }}`, `{{ request_id }}`
- `{{ data.* }}` — full serialized object, incl. nested relations
- `{{ snapshots.prechange.* }}` / `{{ snapshots.postchange.* }}`
- filters: `default`, `urlencode`, `lower`, `upper`

E.g. a per-object URL `https://host/devices/{{ data.name }}/sync`.

## Credentials

- a token in the URL query string,
- an `Authorization` / API-key header via `additional_headers`,
- or `http://user:pass@host` — auto-converted to a Basic auth header; the password is
  redacted in the delivery log.

## Live change feed

The same change events are also available live over a **WebSocket** at `/api/ws/` — see
[SSO-API-ACCESS.md](SSO-API-ACCESS.md#websocket-change-feed-apiws) for authentication.
