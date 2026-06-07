-- Add an auto-generated `uuid` reference to devices (paas2box extension).
PRAGMA foreign_keys = ON;

BEGIN;

ALTER TABLE dcim_device ADD COLUMN uuid TEXT;

COMMIT;
