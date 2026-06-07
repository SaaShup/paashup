-- Add `gateway` to IP ranges (paas2box extension: an IP within the range).
PRAGMA foreign_keys = ON;

BEGIN;

ALTER TABLE ipam_iprange ADD COLUMN gateway TEXT;

COMMIT;
