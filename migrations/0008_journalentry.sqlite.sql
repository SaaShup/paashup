-- NetBox-compatible journal entries (used by clients like the Docker agent).
PRAGMA foreign_keys = ON;

BEGIN;

CREATE TABLE extras_journalentry (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    assigned_object_type TEXT,
    assigned_object_id   INTEGER,
    kind                 TEXT,
    comments             TEXT NOT NULL DEFAULT '',
    created              TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_updated         TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

COMMIT;
