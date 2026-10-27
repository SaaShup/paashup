-- Init scripts (paashup extension): shell scripts run at a new VM's first boot. The
-- adjustable `${NAME:-default}` variables are derived from `content` on every write;
-- `featured_variables` lists the ones shown first in the VM creation form, `secret_variables`
-- the ones whose value is masked (***) in the VM's journal.
PRAGMA foreign_keys = ON;

BEGIN;

CREATE TABLE virtualization_init_script (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    content TEXT NOT NULL,
    variables TEXT,
    featured_variables TEXT,
    secret_variables TEXT,
    custom_fields TEXT,
    created TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_updated TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX uq_virtualization_init_script_name ON virtualization_init_script (name);

COMMIT;
