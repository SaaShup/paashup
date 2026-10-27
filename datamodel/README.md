# Data Model (DCIM · IPAM · Virtualization)

Database data model for paashup, derived from the NetBox-compatible OpenAPI spec
in [`../openapi/`](../openapi/). **No ORM** — the model generates raw SQL DDL for
two engines: **SQLite** (small customers) and **MariaDB** (big customers) from a
single source of truth.

## Pipeline

```
openapi/netbox-dcim-ipam-virt.openapi.json  ─┐
netbox-constraints.json (from NetBox source) ─┼─► build_datamodel.py ─► data-model.json + DATA-MODEL.md
external-entities.json (cached extraction)   ─┘
                                                build_schema.py ─► sql/schema.{sqlite,mariadb}.sql
                                                                   ../migrations/0001_initial.{sqlite,mariadb}.sql
```

## Files

| File | Description |
|------|-------------|
| [`DATA-MODEL.md`](DATA-MODEL.md) | Human reference: every entity, fields, relations, enums. |
| [`data-model.json`](data-model.json) | Machine-readable model — the single source of truth for DDL. |
| [`build_datamodel.py`](build_datamodel.py) | Builds the model from the OpenAPI spec + external entities. |
| [`build_schema.py`](build_schema.py) | Emits SQLite + MariaDB DDL from `data-model.json`. |
| [`sql/schema.sqlite.sql`](sql/schema.sqlite.sql) | Current SQLite schema (mirror of migration 0001). |
| [`sql/schema.mariadb.sql`](sql/schema.mariadb.sql) | Current MariaDB schema (mirror of migration 0001). |
| [`netbox-constraints.json`](netbox-constraints.json) | Unique constraints extracted from NetBox v4.6.2 source. |
| [`extract_constraints.py`](extract_constraints.py) | AST extractor that produced the constraints file. |
| [`external-entities.json`](external-entities.json) | Cached "full" external entities (so the 11 MB spec isn't needed to regenerate). |

The runnable migrations live in [`../migrations/`](../migrations/) — see its README.

## Scope

- **82 entities** → **94 tables** (82 entity tables + 11 M2M join tables + 1 polymorphic tagging table).
- DCIM 46 · IPAM 18 · Virtualization 7 = 71 core, plus 11 external.
- **87 enums** (emitted as `CHECK` constraints), **243 foreign keys**, **~85–99 unique indexes**.
- Validated: SQLite executes in-memory; MariaDB 11 executes in a real server (FK, unique, enum, JSON all enforced).

## The three follow-up points (now done)

### 1. External entities
FK/M2M targets from other NetBox apps are now modeled so the relationship graph
is **fully closed** (zero unresolved references):

- **Full** (extracted from the complete NetBox schema): `Tag`, `Tenant`,
  `TenantGroup`, `Owner`, `OwnerGroup`.
- **Stub** (minimal tables, flesh out later): `User`, `Group`, `ConfigTemplate`,
  `L2VPNTermination`, `WirelessLAN`, `WirelessLink`.

`Tag` is implemented as NetBox-style **polymorphic tagging**: one
`tagging_taggeditem(tag_id, object_type, object_id)` table instead of per-entity
join tables.

### 2. Unique constraints
Extracted from the real NetBox v4.6.2 Django models (not derivable from OpenAPI):

- **field-level** uniques (`slug`, `asn`, `rd`, `asset_tag`, `name`, …) → unique index.
- **composite** uniques (`VLAN(group,vid)`, `Rack(location,name)`,
  `Device(rack,position,face)`, `Cluster(group,name)`, …) → composite unique index.
- **case-insensitive** uniques (`Device` name via `Lower('name')`) → SQLite gets a
  `lower(...)` expression index; MariaDB relies on its case-insensitive collation.
- **partial** uniques (e.g. device name unique per site *when tenant is null*) →
  SQLite gets a partial index (`WHERE ... IS NULL`); MariaDB can't do partial
  indexes, so these are emitted as `-- APP-ENFORCED` notes for the application layer.

### 3. Dual-dialect DDL + migrations
One model → both dialects, handling the real differences: auto-increment PK
(`AUTOINCREMENT` vs `AUTO_INCREMENT`), booleans (`INTEGER` vs `TINYINT(1)`),
JSON (`TEXT` vs `JSON`), datetimes, identifier-length limits (MariaDB's 64-char
cap → hashed index names), and FK ordering (SQLite forward refs vs MariaDB
`FOREIGN_KEY_CHECKS=0`).

## Regenerate

```bash
# 1. (only when changing NetBox version) refresh constraints from source:
#    git clone --depth1 -b vX.Y.Z netbox && python3 datamodel/extract_constraints.py
# 2. rebuild the model (uses /tmp/nb_schema.json full spec if present, else the cache):
python3 datamodel/build_datamodel.py
# 3. regenerate both dialect schemas:
python3 datamodel/build_schema.py
```

## Remaining caveats

- **Stub tables** (User/Group/ConfigTemplate/VPN/wireless) carry only identity
  columns — extend when those subsystems are built.
- **FK `ON DELETE`** defaults to `SET NULL` (nullable) / `RESTRICT` (required);
  NetBox's real behaviour is per-field (PROTECT/CASCADE/SET_NULL) and should be
  reviewed for important relations.
- **Column defaults**: booleans default `0`; other non-null-without-default fields
  are required on insert. NetBox's per-field defaults (e.g. status values) are
  enforced by the application layer, not the DB.
- **Partial-unique constraints** must be enforced in the app on MariaDB (see the
  `-- APP-ENFORCED` notes at the bottom of `schema.mariadb.sql`).
