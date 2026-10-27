-- Add `dhcp_relays` (JSON array of IPs) to IP ranges (paashup extension).
PRAGMA foreign_keys = ON;

BEGIN;

ALTER TABLE ipam_iprange ADD COLUMN dhcp_relays TEXT;

COMMIT;
