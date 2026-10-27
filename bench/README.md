# Benchmarks — paashup vs NetBox

A reproducible harness that compares **paashup** (SQLite and MariaDB profiles)
against **NetBox** on three dimensions:

1. **Deployment & start-up** — image acquire (build/pull) + boot to first served request.
2. **POST** (create) — throughput and latency.
3. **GET** (list + detail) — throughput and latency.

All three targets are exercised by the **same client** ([`bench.mjs`](bench.mjs))
hitting the same NetBox-compatible endpoint (`/api/dcim/manufacturers/`), so the
request shapes are identical.

> ⚠️ **This is not an apples-to-apples comparison.** NetBox is a full DCIM/IPAM
> application (Django + PostgreSQL + Redis) doing change-logging, custom fields,
> permissions, journaling and webhook evaluation on every write; paashup
> implements the API *surface* for three sections with no ORM. The numbers show
> the cost of that difference — not feature parity. See **Caveats** below.

## Run it

```bash
# one target at a time (each builds/pulls, boots, benchmarks, tears down)
bench/run.sh paashup-sqlite
bench/run.sh paashup-mariadb
bench/run.sh netbox            # ~3 min first boot (migrations); image ~1.3 GB

# tune load
REQUESTS=1000 CONCURRENCY=32 bench/run.sh paashup-sqlite

# combine results/*.json into a markdown table
bench/run.sh report
```

Each run writes `bench/results/<target>.json`; `report` renders
[`results/REPORT.md`](results/REPORT.md).

Requires Docker + Docker Compose and Node 24. NetBox needs ~1.3 GB of images and
a few minutes for its first migration.

## Sample results

One run on a dev machine (1000 requests/phase, concurrency 32) — **indicative only**:

| Dimension | paashup-sqlite | paashup-mariadb | netbox |
|-----------|:--------------:|:---------------:|:------:|
| Boot → first 200 | **2.3 s** | 8.0 s | 196.8 s |
| POST req/s (p50) | 758 (34 ms) | **1131 (24 ms)** | 57 (118 ms) |
| GET list req/s (p50) | **1626 (18 ms)** | 1324 (24 ms) | 48 (179 ms) |
| GET detail req/s (p50) | **3744 (5 ms)** | 2502 (12 ms) | 59 (119 ms) |

paashup throughput vs NetBox: **POST 13–20×, GET list ~28–34×, GET detail ~42–63×**;
start-up **~25–85× faster**. (MariaDB wins POST via concurrent writes; SQLite wins
GET being in-process. NetBox's high p99 tail comes from saturating its default
gunicorn worker pool at concurrency 32.)

## How it works

- **`bench.mjs`** — dependency-free client. Per phase it fires `REQUESTS` requests
  through a fixed-size concurrency pool, records each latency, and reports
  req/s + mean/p50/p95/p99/max. A short warm-up is excluded. POST creates rows
  with unique slugs and remembers their ids so GET-detail hits real records.
- **`compose/`** — one stack per target. paashup builds from the repo Dockerfile;
  NetBox is `netboxcommunity/netbox:v4.6` + PostgreSQL + Redis.
- **`run.sh`** — times image-acquire and boot-to-ready, applies migrations
  (MariaDB) / mints a fixed v1 API token (NetBox), runs `bench.mjs`, merges the
  startup timing into the result JSON, then tears the stack down.
- **`netbox-config/extra.py`** — supplies `API_TOKEN_PEPPERS` (required by NetBox 4.6).

## Caveats (read before quoting numbers)

- **Different datastores**: NetBox = PostgreSQL; paashup = SQLite or MariaDB.
- **Different work per request**: NetBox writes changelog rows, evaluates custom
  fields/permissions/webhooks and renders far richer serializers; paashup does a
  parameterized query + lightweight serialization.
- **Auth**: NetBox requires a token on every request (one extra lookup); paashup
  ran with auth disabled (its default). Token-auth overhead in paashup is one
  cheap indexed lookup.
- **Concurrency vs workers**: NetBox's default gunicorn worker count is small, so
  concurrency 32 queues requests → large p99. Lower concurrency narrows the gap on
  tail latency (not on throughput).
- **Single host, warm-ish caches, one run**: numbers vary by machine and run. Treat
  them as orders of magnitude, not precise figures. Re-run on your hardware.
- **Version**: pin the NetBox image tag to the version paashup targets (4.6.x) for a
  fair comparison; adjust in `compose/netbox.yml`.
