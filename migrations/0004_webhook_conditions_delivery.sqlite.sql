-- Webhook conditions (fire only when object fields match) + delivery log.
PRAGMA foreign_keys = ON;

BEGIN;

ALTER TABLE extras_webhook ADD COLUMN conditions TEXT NOT NULL DEFAULT '{}';

CREATE TABLE extras_webhook_delivery (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    webhook_name TEXT NOT NULL DEFAULT '',
    event        TEXT NOT NULL,
    object_type  TEXT NOT NULL,
    object_id    INTEGER,
    payload_url  TEXT NOT NULL,
    success      INTEGER NOT NULL DEFAULT 0,
    status_code  INTEGER,
    attempts     INTEGER NOT NULL DEFAULT 0,
    error        TEXT NOT NULL DEFAULT '',
    created      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_webhook_delivery_created ON extras_webhook_delivery (created);

COMMIT;
