-- Init scripts (paashup extension): shell scripts run at a new VM's first boot. The
-- adjustable `${NAME:-default}` variables are derived from `content` on every write;
-- `featured_variables` lists the ones shown first in the VM creation form, `secret_variables`
-- the ones whose value is masked (***) in the VM's journal.
CREATE TABLE virtualization_init_script (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(200),
    content TEXT NOT NULL,
    variables JSON,
    featured_variables JSON,
    secret_variables JSON,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE UNIQUE INDEX uq_virtualization_init_script_name ON virtualization_init_script (name);
