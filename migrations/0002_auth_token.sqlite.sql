-- API tokens (NetBox-style `Authorization: Token <key>`).
PRAGMA foreign_keys = ON;

BEGIN;

CREATE TABLE auth_token (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    key           TEXT NOT NULL,
    user_id       INTEGER NOT NULL,
    write_enabled INTEGER NOT NULL DEFAULT 1,
    expires       TEXT,
    description   TEXT NOT NULL DEFAULT '',
    created       TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_used     TEXT,
    FOREIGN KEY (user_id) REFERENCES users_user(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uq_auth_token_key ON auth_token (key);

COMMIT;
