-- Provider-neutral images and SSH public keys (paashup extension), filled by whichever
-- cloud / hypervisor plugin is in use, plus the VM's `image` link. `source_type` /
-- `source_id` say which object (e.g. an OpenStack cloud) a row was imported from;
-- NULL = created in paashup.
CREATE TABLE virtualization_image (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description VARCHAR(200),
    source_type VARCHAR(100),
    source_id BIGINT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE UNIQUE INDEX uq_virtualization_image_name ON virtualization_image (name);

CREATE TABLE virtualization_ssh_key (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    public_key TEXT NOT NULL,
    description VARCHAR(200),
    source_type VARCHAR(100),
    source_id BIGINT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE UNIQUE INDEX uq_virtualization_ssh_key_name ON virtualization_ssh_key (name);

ALTER TABLE virtualization_virtual_machine ADD COLUMN image_id BIGINT NULL;
ALTER TABLE virtualization_virtual_machine
    ADD CONSTRAINT fk_vm_image FOREIGN KEY (image_id)
    REFERENCES virtualization_image(id) ON DELETE SET NULL;
