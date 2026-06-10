-- NetBox-style config contexts (core extras feature). Arbitrary JSON `data` that
-- is merged onto a device/VM when the object matches the context's assignment
-- criteria; applicable contexts are merged in (weight, name) order. Assignment
-- criteria are stored as JSON arrays of object ids (regions, sites, roles, …).
PRAGMA foreign_keys = ON;

BEGIN;

CREATE TABLE extras_configcontext (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    weight         INTEGER NOT NULL DEFAULT 1000,
    description    TEXT NOT NULL DEFAULT '',
    is_active      INTEGER NOT NULL DEFAULT 1,
    data           TEXT NOT NULL DEFAULT '{}',
    -- assignment criteria (JSON arrays of ids; empty = unrestricted)
    regions        TEXT NOT NULL DEFAULT '[]',
    site_groups    TEXT NOT NULL DEFAULT '[]',
    sites          TEXT NOT NULL DEFAULT '[]',
    locations      TEXT NOT NULL DEFAULT '[]',
    device_types   TEXT NOT NULL DEFAULT '[]',
    roles          TEXT NOT NULL DEFAULT '[]',
    platforms      TEXT NOT NULL DEFAULT '[]',
    cluster_types  TEXT NOT NULL DEFAULT '[]',
    cluster_groups TEXT NOT NULL DEFAULT '[]',
    clusters       TEXT NOT NULL DEFAULT '[]',
    tenant_groups  TEXT NOT NULL DEFAULT '[]',
    tenants        TEXT NOT NULL DEFAULT '[]',
    tags           TEXT NOT NULL DEFAULT '[]',
    created        TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_updated   TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX uq_extras_configcontext_name ON extras_configcontext (name);

COMMIT;
