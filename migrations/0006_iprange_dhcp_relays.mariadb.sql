-- Add `dhcp_relays` (JSON array of IPs) to IP ranges (paashup extension).
ALTER TABLE ipam_iprange ADD COLUMN dhcp_relays JSON;
