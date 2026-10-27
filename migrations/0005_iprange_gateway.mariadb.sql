-- Add `gateway` to IP ranges (paashup extension: an IP within the range).
ALTER TABLE ipam_iprange ADD COLUMN gateway TEXT;
