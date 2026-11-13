-- A Volume (virtual_disk) no longer needs a VM: an OpenStack Cinder volume paashup knows
-- about but that isn't currently attached to any VM is now mirrored too (virtual_machine
-- NULL), instead of being left out of paashup entirely. SQLite has no ALTER COLUMN, so the
-- table is rebuilt (same columns, FK constraint dropped NOT NULL).
PRAGMA foreign_keys = OFF;

BEGIN;

CREATE TABLE virtualization_virtual_disk__new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    virtual_machine_id INTEGER,
    name TEXT NOT NULL,
    description TEXT,
    size INTEGER NOT NULL,
    owner_id INTEGER,
    custom_fields TEXT,
    created TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_updated TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (virtual_machine_id) REFERENCES virtualization_virtual_machine(id) ON DELETE RESTRICT,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
);
INSERT INTO virtualization_virtual_disk__new SELECT * FROM virtualization_virtual_disk;
DROP TABLE virtualization_virtual_disk;
ALTER TABLE virtualization_virtual_disk__new RENAME TO virtualization_virtual_disk;

COMMIT;

PRAGMA foreign_keys = ON;
