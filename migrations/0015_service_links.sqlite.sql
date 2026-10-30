-- Pinned service links shown on the dashboard: either auto-detected from a remote
-- paashup instance's docker containers (Traefik labels) or added by hand.
PRAGMA foreign_keys = ON;

BEGIN;

CREATE TABLE extras_service_link (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    key           TEXT NOT NULL,
    label         TEXT NOT NULL,
    auto_url      TEXT,                        -- last URL detected from Traefik labels
    override_url  TEXT,                        -- admin-set URL; wins over auto_url
    icon_url      TEXT,                        -- admin-set icon; defaults to a favicon lookup
    pinned        INTEGER NOT NULL DEFAULT 1,
    managed       INTEGER NOT NULL DEFAULT 0,   -- true: maintained by the auto-sync, not just hand-added
    position      INTEGER NOT NULL DEFAULT 0,
    created       TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_updated  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX uq_extras_service_link_key ON extras_service_link (key);

COMMIT;
