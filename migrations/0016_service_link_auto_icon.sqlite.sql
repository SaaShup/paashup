-- The icon resolved by fetching a service's page and reading its <link rel="icon">
-- (e.g. a custom saashup_logo.svg), since most sites don't serve a plain /favicon.ico.
PRAGMA foreign_keys = ON;

BEGIN;

ALTER TABLE extras_service_link ADD COLUMN auto_icon_url TEXT;

COMMIT;
