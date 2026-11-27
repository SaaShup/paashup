-- Global app settings (paashup extension): a small key/value store for admin-configured
-- UI preferences, starting with which sidebar sections are hidden for everyone.
PRAGMA foreign_keys = ON;

BEGIN;

CREATE TABLE app_settings (
    setting_key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

COMMIT;
