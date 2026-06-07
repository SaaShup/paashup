-- Add an auto-generated `uuid` reference to devices (paas2box extension).
ALTER TABLE dcim_device ADD COLUMN uuid VARCHAR(36);
