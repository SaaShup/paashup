-- A Volume (virtual_disk) no longer needs a VM: an OpenStack Cinder volume paashup knows
-- about but that isn't currently attached to any VM is now mirrored too (virtual_machine
-- NULL), instead of being left out of paashup entirely.
ALTER TABLE virtualization_virtual_disk MODIFY COLUMN virtual_machine_id BIGINT NULL;
