# Webhooks & realtime

paas2box can notify other systems whenever objects change — either by **pushing HTTP
webhooks**, or by **streaming a live feed** over WebSocket.

## Webhooks

A **Webhook** (under *Operations → Webhooks*, or `/api/extras/webhooks/`) fires an
HTTP request when matching objects are created, updated, or deleted — for **any**
object type, including those added by plugins.

### Configure one

| Field | Meaning |
|---|---|
| `payload_url` | where to POST the event |
| `object_types` | which types trigger it: content-types like `dcim.device`, or `*` for all |
| `events` | any of `created`, `updated`, `deleted` |
| `enabled` | turn it on/off |
| `http_method` / `http_content_type` | defaults: `POST` / `application/json` |
| `additional_headers` | extra headers, one `Key: Value` per line (templated) |
| `body_template` | optional template for the request body; empty = default JSON payload |
| `secret` | if set, the body is signed (see below) |
| `conditions` | only fire when the object matches (see below) |
| `ssl_verification` | verify TLS on the target (default on) |

### Payload

```json
{
  "event": "created",
  "timestamp": "2026-06-07T10:00:00.000Z",
  "model": "dcim.device",
  "object_id": 42,
  "data": { … the full object … }
}
```

### Templating (Jinja-style)

The `payload_url`, every `additional_headers` value, and the optional `body_template`
are rendered at fire time with a context built from the triggering event — the same
idea as NetBox. Use `{{ … }}` placeholders:

| Variable | Value |
|---|---|
| `event` | `created`, `updated`, or `deleted` |
| `model` | the object's type, e.g. `dcim.device` |
| `timestamp` | when the event was processed (ISO 8601) |
| `username` | the user whose request triggered it (or empty if unauthenticated) |
| `request_id` | unique id of the HTTP request (correlate multiple objects changed together) |
| `data.*` | the full serialized object — any API field, incl. nested relations: `{{ data.site.slug }}`, `{{ data.custom_fields.x }}` |
| `snapshots.prechange.*` / `snapshots.postchange.*` | the object before/after the change (compare values) |

On `deleted`, `data` is null and the object is under `snapshots.prechange`; on
`created`, `snapshots.prechange` is null.

A per-object endpoint:

```jsonc
"payload_url": "https://automation.example.com/api/devices/{{ data.name }}/sync?site={{ data.site.slug }}"
```

A custom body (kept as configured; `http_content_type` is sent as-is):

```jsonc
"body_template": "{\"host\":\"{{ data.name }}\",\"was\":\"{{ snapshots.prechange.status }}\",\"now\":\"{{ data.status }}\"}"
```

Supported filters: `{{ x | default('n/a') }}`, `urlencode`, `lower`, `upper`. A missing
value renders as an empty string. (This is a pragmatic subset of Jinja2 — dotted-path
lookups plus those filters — not the full language.) Leave a field static and put the
variable parts elsewhere if your receiver prefers that.

### Authenticating to the target

If the receiving service is protected, send a credential one of three ways:

**1. Custom headers — `additional_headers`** (one `Header: Value` per line). The most
flexible option: bearer tokens, API keys, Basic auth, etc.

```jsonc
// in JSON, separate lines with \n
"additional_headers": "Authorization: Bearer eyJhbGci...\nX-Api-Key: key-987"
```

```text
Authorization: Basic dXNlcjpwYXNzd29yZA==   (base64 of "user:password")
```

**2. Credentials in the URL — `http://user:password@host`.** paas2box turns the
`user:password@` part into a `Basic` `Authorization` header automatically and fetches
the cleaned URL (a bare `fetch` rejects URLs that embed credentials). Percent-encoded
userinfo is decoded (`p%40ss` → `p@ss`).

```jsonc
"payload_url": "https://alice:s3cr3t@hooks.example.com/in"
// sent as:  POST https://hooks.example.com/in   with  Authorization: Basic YWxpY2U6czNjcjN0
```

**3. A token in the query string.** Anything in `payload_url` is sent verbatim:

```jsonc
"payload_url": "https://hooks.example.com/in?token=abc123"
```

Notes:

- An explicit `Authorization` in `additional_headers` **takes precedence** over
  credentials embedded in the URL.
- A password embedded in the URL is **redacted** (`user:***@host`) in the delivery log
  and error logs, so it isn't exposed via the read-only deliveries API. Values in
  `additional_headers` are stored as configured — treat the webhook as sensitive.

### Signing (verify it really came from paas2box)

If a `secret` is set, paas2box adds an `X-Hook-Signature` header — the **HMAC-SHA512**
of the exact request body. Recompute it on your side with the same secret and compare.

### Conditions (fire only when it matters)

Restrict a webhook to objects that match. Three styles:

```jsonc
{ "status": "active" }                              // simple: field equals value
{ "attr": "status", "op": "in", "value": ["active","staged"] }   // operator form
{ "and": [ { "attr": "site.id", "op": "eq", "value": 1 },
           { "attr": "status", "op": "eq", "value": "active" } ] }
```

Operators: `eq`, `ne`, `in`, `contains`, `gt`, `gte`, `lt`, `lte`, `empty`.

### Reliability

- Failed deliveries are **retried with exponential backoff**.
- Every attempt is recorded in the read-only **delivery log**
  (*Operations → Webhook Deliveries*, `/api/extras/webhook-deliveries/`): outcome,
  HTTP status, attempt count, and any error — so you can audit what was sent.

## Realtime (WebSocket)

The UI stays live via a WebSocket at `/api/ws/`. You can connect to it too:

```js
const ws = new WebSocket("ws://localhost:8000/api/ws/");
ws.onmessage = (e) => console.log(JSON.parse(e.data));
// { "type":"change", "event":"created", "object_type":"dcim.device", "id":42, "data":{…} }
```

Use **webhooks** to push events to other servers, and the **WebSocket** to drive live
dashboards or your own UI.
