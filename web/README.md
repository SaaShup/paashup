# paas2box web (Vue 3 + Vite + TypeScript + Pinia)

A human-facing admin UI for paas2box. It's **schema-driven** — resources are
discovered from the API's own `/api/schema/` — and **live**: Pinia stores are kept
up to date by the backend's WebSocket change-feed (`/api/ws/`), so creates/edits/
deletes from anywhere (API, other tabs, automation) appear instantly.

## Stack & layout

Vue 3 · Vite · TypeScript · Pinia · **native WebSocket** (no socket.io).

```
src/
├── api/          REST client (client.ts) + schema-driven resource discovery (resources.ts)
├── websocket/
│   ├── socket.ts   native WebSocket manager (auto-reconnect, backoff)
│   └── events.ts   typed server events (hello / change)
├── stores/       Pinia state updated by the WebSocket
│   ├── connection.ts   status + rolling change log
│   └── objects.ts      records per table; load() via REST, applyChange() from WS
├── views/        DashboardView.vue (live activity), BrowseView.vue (any resource)
└── components/   StatusBadge · ObjectTable · EventLog
```

## Develop

```bash
# 1) run the backend (with the WebSocket feed, on by default)
cd .. && PB_SQLITE_FILE=./paas2box.db PB_MIGRATE=1 npm run build && npm start
# 2) run the UI (proxies /api and /api/ws to the backend)
cd web && npm install && npm run dev    # http://localhost:5173
```

`PB_BACKEND` overrides the dev proxy target (default `http://localhost:8000`).

## Build

```bash
npm run build      # vue-tsc typecheck + vite build -> dist/
```

Serve `dist/` with any static server (or behind the API). The UI calls the API
same-origin, so put it on the same host/proxy as paas2box in production.

## How "live" works

`main.ts` connects the singleton `socket`, forwards `change` events to the Pinia
stores; `BrowseView` loads a resource via REST once, then every subsequent change
to that table patches the in-memory list (insert/replace/remove) with no refetch.
The `StatusBadge` shows connection state; `EventLog` shows the recent change stream.

## Create / edit

Forms are **schema-driven**: `ObjectForm.vue` reads the entity's `<Model>Request`
schema from `/api/schema/` and renders inputs by type — text, number, checkbox
(boolean), `<select>` for enums, an async `<select>` populated from the target
resource for **foreign keys**, and a JSON textarea for `custom_fields`. Validation
errors from the API (400, NetBox field-error shape) show inline. On save the change
arrives over the WebSocket, so the list updates itself.

## Single-container deploy

The backend can serve the built SPA, so one container runs API + WebSocket + UI:

```bash
cd web && npm run build           # -> web/dist
cd .. && PB_WEB_ROOT=web/dist npm start   # SPA at /, API at /api/, schema at /api/schema/
```

The provided `Dockerfile` does this automatically (it builds `web/` and sets
`PB_WEB_ROOT`), so `docker run paas2box` serves everything on port 8000.

## Notes

- Auth: set a token in `localStorage.pb_token` to send `Authorization: Token …`.
