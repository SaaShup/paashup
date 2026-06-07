-- Webhooks: fire an HTTP request on object create/update/delete (NetBox-style).
PRAGMA foreign_keys = ON;

BEGIN;

CREATE TABLE extras_webhook (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT NOT NULL,
    enabled           INTEGER NOT NULL DEFAULT 1,
    object_types      TEXT NOT NULL DEFAULT '[]',   -- JSON array of content-types or "*"
    events            TEXT NOT NULL DEFAULT '[]',   -- JSON array: created/updated/deleted
    payload_url       TEXT NOT NULL,
    http_method       TEXT NOT NULL DEFAULT 'POST',
    http_content_type TEXT NOT NULL DEFAULT 'application/json',
    additional_headers TEXT NOT NULL DEFAULT '',    -- one "Key: Value" per line
    secret            TEXT NOT NULL DEFAULT '',     -- HMAC-SHA512 signing key
    ssl_verification  INTEGER NOT NULL DEFAULT 1,
    description       TEXT NOT NULL DEFAULT '',
    created           TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_updated      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX uq_extras_webhook_name ON extras_webhook (name);

COMMIT;
