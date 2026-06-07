-- Add `gateway` to IP ranges (paas2box extension: an IP within the range).
ALTER TABLE ipam_iprange ADD COLUMN gateway TEXT;
