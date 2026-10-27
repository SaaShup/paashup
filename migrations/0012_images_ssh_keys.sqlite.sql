-- Provider-neutral images and SSH public keys (paashup extension), filled by whichever
-- cloud / hypervisor plugin is in use, plus the VM's `image` link. `source_type` /
-- `source_id` say which object (e.g. an OpenStack cloud) a row was imported from;
-- NULL = created in paashup.
PRAGMA foreign_keys = ON;

BEGIN;

CREATE TABLE virtualization_image (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    source_type TEXT,
    source_id INTEGER,
    custom_fields TEXT,
    created TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_updated TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX uq_virtualization_image_name ON virtualization_image (name);

CREATE TABLE virtualization_ssh_key (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    description TEXT,
    source_type TEXT,
    source_id INTEGER,
    custom_fields TEXT,
    created TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_updated TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX uq_virtualization_ssh_key_name ON virtualization_ssh_key (name);

ALTER TABLE virtualization_virtual_machine
    ADD COLUMN image_id INTEGER REFERENCES virtualization_image(id) ON DELETE SET NULL;

COMMIT;
