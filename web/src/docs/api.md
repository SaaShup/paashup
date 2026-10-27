# The API

paashup is **API-first**: everything in the UI is also available over a REST API that
mirrors NetBox's, so NetBox client tools (pynetbox, the Terraform provider, your own
scripts) work against it. Every list page shows its endpoint — copy it and go.

## Basics

- Base path is `/api/`, organised as `/api/<section>/<resource>/`, e.g.
  `GET /api/dcim/devices/`.
- Responses are JSON. Lists are paginated:

```json
{ "count": 142, "next": "…?limit=50&offset=50", "previous": null, "results": [ … ] }
```

- Each object includes `id`, a `url` (its own endpoint), and a friendly `display`.

## CRUD

```bash
# list / read
curl localhost:8000/api/dcim/sites/
curl localhost:8000/api/dcim/sites/1/

# create
curl -X POST localhost:8000/api/dcim/sites/ \
  -H 'Content-Type: application/json' \
  -d '{"name":"HQ","slug":"hq","region":3}'      # FKs are sent as ids

# update (partial) / replace / delete
curl -X PATCH  localhost:8000/api/dcim/sites/1/ -H 'Content-Type: application/json' -d '{"status":"active"}'
curl -X DELETE localhost:8000/api/dcim/sites/1/
```

**Bulk create**: POST a JSON *array* to the collection to create many at once.

## Pagination, search, ordering

- `?limit=50&offset=100` — page through results.
- `?q=acme` — free-text search across common fields.
- `?ordering=name` or `?ordering=-created` — sort (prefix `-` for descending).

## Filtering & lookups

Filter by any field, with optional lookup suffixes:

| Example | Meaning |
|---|---|
| `?name=HQ` | exact match |
| `?name__ic=hq` | case-insensitive contains |
| `?name__isw=h` / `?name__iew=q` | starts-with / ends-with |
| `?status__in=active,planned` | in a set |
| `?name__n=HQ` | not equal |
| `?id__gt=10&id__lte=20` | `>`, `>=`, `<`, `<=` (`gt/gte/lt/lte`) |
| `?description__empty=true` | is empty / not empty |

Filters combine (AND), e.g. `?site=1&status=active&ordering=name`.

## Authentication

If your administrator enabled auth, send a token:

```bash
curl -H 'Authorization: Token <your-key>' localhost:8000/api/dcim/devices/
```

Tokens can be **read-only** or read-write. Without auth required, the API is open.

You can create and manage these tokens yourself from the **API keys** page in the UI (or
the `/api/users/tokens/` endpoint) — see the [API keys](#api-keys) guide.

## The OpenAPI schema

- `GET /api/schema/` — the full OpenAPI document, generated live from the running
  server (so it always reflects core **and** any installed plugins). Feed it to a
  code generator to get a typed client.
- `GET /api/schema/swagger-ui/` — interactive Swagger UI in the browser.

## Field conventions

- **Foreign keys**: write the target `id`; reads return a nested brief
  (`{ "id":…, "url":…, "display":… }`).
- **Choices**: write the bare value (`"status":"active"`); reads return
  `{ "value":"active", "label":"Active" }`.
- **Blanks**: optional fields come back as sensible defaults (`""`, `false`, `0`, `{}`)
  rather than `null` where NetBox does the same.
- **Validation errors** return HTTP `400` with a field-keyed body, e.g.
  `{ "slug": ["This field is required."] }`.
