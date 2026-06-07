# Webhooks & realtime

paasbox can notify other systems whenever objects change — either by **pushing HTTP
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
| `additional_headers` | extra headers, one `Key: Value` per line |
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

### Signing (verify it really came from paasbox)

If a `secret` is set, paasbox adds an `X-Hook-Signature` header — the **HMAC-SHA512**
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
