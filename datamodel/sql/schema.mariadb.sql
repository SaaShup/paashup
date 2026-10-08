-- paas2box initial schema (mariadb) — generated from data-model.json
-- NetBox 4.6.2 (4.6) compatible. Do not edit by hand; run datamodel/build_schema.py.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ===== Entity tables =====
CREATE TABLE dcim_cable_bundle (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_cable_termination (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_cable (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    type VARCHAR(32) CHECK (type IN ('cat3', 'cat5', 'cat5e', 'cat6', 'cat6a', 'cat7', 'cat7a', 'cat8', 'mrj21-trunk', 'dac-active', 'dac-passive', 'coaxial', 'rg-6', 'rg-8', 'rg-11', 'rg-59', 'rg-62', 'rg-213', 'lmr-100', 'lmr-200', 'lmr-400', 'mmf', 'mmf-om1', 'mmf-om2', 'mmf-om3', 'mmf-om4', 'mmf-om5', 'smf', 'smf-os1', 'smf-os2', 'aoc', 'power', 'usb')),
    a_terminations JSON,
    b_terminations JSON,
    status VARCHAR(32) CHECK (status IN ('connected', 'planned', 'decommissioning')),
    profile VARCHAR(32) CHECK (profile IN ('single-1c1p', 'single-1c2p', 'single-1c4p', 'single-1c6p', 'single-1c8p', 'single-1c12p', 'single-1c16p', 'trunk-2c1p', 'trunk-2c2p', 'trunk-2c4p', 'trunk-2c4p-shuffle', 'trunk-2c6p', 'trunk-2c8p', 'trunk-2c12p', 'trunk-4c1p', 'trunk-4c2p', 'trunk-4c4p', 'trunk-4c4p-shuffle', 'trunk-4c6p', 'trunk-4c8p', 'trunk-8c4p', 'breakout-1c2p-2c1p', 'breakout-1c4p-4c1p', 'breakout-1c6p-6c1p', 'breakout-2c4p-8c1p-shuffle')),
    tenant_id BIGINT,
    bundle_id BIGINT,
    label VARCHAR(100),
    color VARCHAR(6),
    length DECIMAL(20,6),
    length_unit VARCHAR(32) CHECK (length_unit IN ('km', 'm', 'cm', 'mi', 'ft', 'in')),
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (tenant_id) REFERENCES tenancy_tenant(id) ON DELETE SET NULL,
    FOREIGN KEY (bundle_id) REFERENCES dcim_cable_bundle(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_console_port_template (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    device_type_id BIGINT,
    module_type_id BIGINT,
    name VARCHAR(64) NOT NULL,
    label VARCHAR(64),
    type VARCHAR(32) CHECK (type IN ('de-9', 'db-25', 'rj-11', 'rj-12', 'rj-45', 'mini-din-8', 'usb-a', 'usb-b', 'usb-c', 'usb-mini-a', 'usb-mini-b', 'usb-micro-a', 'usb-micro-b', 'usb-micro-ab', 'other')),
    description VARCHAR(200),
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (device_type_id) REFERENCES dcim_device_type(id) ON DELETE SET NULL,
    FOREIGN KEY (module_type_id) REFERENCES dcim_module_type(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_console_port (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(36) NOT NULL,
    module_id BIGINT,
    name VARCHAR(64) NOT NULL,
    label VARCHAR(64),
    type VARCHAR(32) CHECK (type IN ('de-9', 'db-25', 'rj-11', 'rj-12', 'rj-45', 'mini-din-8', 'usb-a', 'usb-b', 'usb-c', 'usb-mini-a', 'usb-mini-b', 'usb-micro-a', 'usb-micro-b', 'usb-micro-ab', 'other')),
    speed INT,
    description VARCHAR(200),
    mark_connected TINYINT(1) DEFAULT 0,
    owner_id BIGINT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (device_id) REFERENCES dcim_device(id) ON DELETE RESTRICT,
    FOREIGN KEY (module_id) REFERENCES dcim_module(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_console_server_port_template (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    device_type_id BIGINT,
    module_type_id BIGINT,
    name VARCHAR(64) NOT NULL,
    label VARCHAR(64),
    type VARCHAR(32) CHECK (type IN ('de-9', 'db-25', 'rj-11', 'rj-12', 'rj-45', 'mini-din-8', 'usb-a', 'usb-b', 'usb-c', 'usb-mini-a', 'usb-mini-b', 'usb-micro-a', 'usb-micro-b', 'usb-micro-ab', 'other')),
    description VARCHAR(200),
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (device_type_id) REFERENCES dcim_device_type(id) ON DELETE SET NULL,
    FOREIGN KEY (module_type_id) REFERENCES dcim_module_type(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_console_server_port (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(36) NOT NULL,
    module_id BIGINT,
    name VARCHAR(64) NOT NULL,
    label VARCHAR(64),
    type VARCHAR(32) CHECK (type IN ('de-9', 'db-25', 'rj-11', 'rj-12', 'rj-45', 'mini-din-8', 'usb-a', 'usb-b', 'usb-c', 'usb-mini-a', 'usb-mini-b', 'usb-micro-a', 'usb-micro-b', 'usb-micro-ab', 'other')),
    speed INT,
    description VARCHAR(200),
    mark_connected TINYINT(1) DEFAULT 0,
    owner_id BIGINT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (device_id) REFERENCES dcim_device(id) ON DELETE RESTRICT,
    FOREIGN KEY (module_id) REFERENCES dcim_module(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_device_bay_template (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    device_type_id BIGINT NOT NULL,
    name VARCHAR(64) NOT NULL,
    label VARCHAR(64),
    enabled TINYINT(1) DEFAULT 0,
    description VARCHAR(200),
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (device_type_id) REFERENCES dcim_device_type(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_device_bay (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(36) NOT NULL,
    name VARCHAR(64) NOT NULL,
    label VARCHAR(64),
    enabled TINYINT(1) DEFAULT 0,
    description VARCHAR(200),
    installed_device_id VARCHAR(36),
    owner_id BIGINT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (device_id) REFERENCES dcim_device(id) ON DELETE RESTRICT,
    FOREIGN KEY (installed_device_id) REFERENCES dcim_device(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_device_role (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    color VARCHAR(6),
    vm_role TINYINT(1) DEFAULT 0,
    config_template_id BIGINT,
    parent_id BIGINT,
    description VARCHAR(200),
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    owner_id BIGINT,
    comments TEXT,
    FOREIGN KEY (config_template_id) REFERENCES extras_config_template(id) ON DELETE SET NULL,
    FOREIGN KEY (parent_id) REFERENCES dcim_device_role(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_device_type (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    manufacturer_id BIGINT NOT NULL,
    default_platform_id BIGINT,
    model VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    part_number VARCHAR(50),
    u_height DECIMAL(20,6),
    exclude_from_utilization TINYINT(1) DEFAULT 0,
    is_full_depth TINYINT(1) DEFAULT 0,
    subdevice_role VARCHAR(32) CHECK (subdevice_role IN ('parent', 'child')),
    airflow VARCHAR(32) CHECK (airflow IN ('front-to-rear', 'rear-to-front', 'left-to-right', 'right-to-left', 'side-to-rear', 'rear-to-side', 'bottom-to-top', 'top-to-bottom', 'passive', 'mixed')),
    weight DECIMAL(20,6),
    weight_unit VARCHAR(32) CHECK (weight_unit IN ('kg', 'g', 'lb', 'oz')),
    front_image VARCHAR(500),
    rear_image VARCHAR(500),
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (manufacturer_id) REFERENCES dcim_manufacturer(id) ON DELETE RESTRICT,
    FOREIGN KEY (default_platform_id) REFERENCES dcim_platform(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_device (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    name VARCHAR(64),
    device_type_id BIGINT NOT NULL,
    role_id BIGINT,
    tenant_id BIGINT,
    platform_id BIGINT,
    serial VARCHAR(50),
    asset_tag VARCHAR(50),
    site_id BIGINT NOT NULL,
    location_id BIGINT,
    rack_id BIGINT,
    position DECIMAL(20,6),
    face VARCHAR(32) CHECK (face IN ('front', 'rear')),
    latitude DECIMAL(20,6),
    longitude DECIMAL(20,6),
    status VARCHAR(32) CHECK (status IN ('offline', 'active', 'planned', 'staged', 'failed', 'inventory', 'decommissioning')),
    airflow VARCHAR(32) CHECK (airflow IN ('front-to-rear', 'rear-to-front', 'left-to-right', 'right-to-left', 'side-to-rear', 'rear-to-side', 'bottom-to-top', 'top-to-bottom', 'passive', 'mixed')),
    primary_ip4_id BIGINT,
    primary_ip6_id BIGINT,
    oob_ip_id BIGINT,
    cluster_id BIGINT,
    virtual_chassis_id BIGINT,
    vc_position INT,
    vc_priority INT,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    config_template_id BIGINT,
    local_context_data JSON,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (device_type_id) REFERENCES dcim_device_type(id) ON DELETE RESTRICT,
    FOREIGN KEY (role_id) REFERENCES dcim_device_role(id) ON DELETE SET NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenancy_tenant(id) ON DELETE SET NULL,
    FOREIGN KEY (platform_id) REFERENCES dcim_platform(id) ON DELETE SET NULL,
    FOREIGN KEY (site_id) REFERENCES dcim_site(id) ON DELETE RESTRICT,
    FOREIGN KEY (location_id) REFERENCES dcim_location(id) ON DELETE SET NULL,
    FOREIGN KEY (rack_id) REFERENCES dcim_rack(id) ON DELETE SET NULL,
    FOREIGN KEY (primary_ip4_id) REFERENCES ipam_ipaddress(id) ON DELETE SET NULL,
    FOREIGN KEY (primary_ip6_id) REFERENCES ipam_ipaddress(id) ON DELETE SET NULL,
    FOREIGN KEY (oob_ip_id) REFERENCES ipam_ipaddress(id) ON DELETE SET NULL,
    FOREIGN KEY (cluster_id) REFERENCES virtualization_cluster(id) ON DELETE SET NULL,
    FOREIGN KEY (virtual_chassis_id) REFERENCES dcim_virtual_chassis(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL,
    FOREIGN KEY (config_template_id) REFERENCES extras_config_template(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_front_port_template (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    device_type_id BIGINT,
    module_type_id BIGINT,
    name VARCHAR(64) NOT NULL,
    label VARCHAR(64),
    type VARCHAR(32) NOT NULL CHECK (type IN ('8p8c', '8p6c', '8p4c', '8p2c', '6p6c', '6p4c', '6p2c', '4p4c', '4p2c', 'gg45', 'tera-4p', 'tera-2p', 'tera-1p', '110-punch', 'bnc', 'f', 'n', 'mrj21', 'fc', 'fc-pc', 'fc-upc', 'fc-apc', 'lc', 'lc-pc', 'lc-upc', 'lc-apc', 'lsh', 'lsh-pc', 'lsh-upc', 'lsh-apc', 'lx5', 'lx5-pc', 'lx5-upc', 'lx5-apc', 'mpo', 'mtrj', 'sc', 'sc-pc', 'sc-upc', 'sc-apc', 'st', 'cs', 'sn', 'sma-905', 'sma-906', 'urm-p2', 'urm-p4', 'urm-p8', 'splice', 'usb-a', 'usb-b', 'usb-c', 'usb-mini-a', 'usb-mini-b', 'usb-micro-a', 'usb-micro-b', 'usb-micro-ab', 'other')),
    color VARCHAR(6),
    positions INT,
    rear_ports JSON,
    description VARCHAR(200),
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (device_type_id) REFERENCES dcim_device_type(id) ON DELETE SET NULL,
    FOREIGN KEY (module_type_id) REFERENCES dcim_module_type(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_front_port (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(36) NOT NULL,
    module_id BIGINT,
    name VARCHAR(64) NOT NULL,
    label VARCHAR(64),
    type VARCHAR(32) NOT NULL CHECK (type IN ('8p8c', '8p6c', '8p4c', '8p2c', '6p6c', '6p4c', '6p2c', '4p4c', '4p2c', 'gg45', 'tera-4p', 'tera-2p', 'tera-1p', '110-punch', 'bnc', 'f', 'n', 'mrj21', 'fc', 'fc-pc', 'fc-upc', 'fc-apc', 'lc', 'lc-pc', 'lc-upc', 'lc-apc', 'lsh', 'lsh-pc', 'lsh-upc', 'lsh-apc', 'lx5', 'lx5-pc', 'lx5-upc', 'lx5-apc', 'mpo', 'mtrj', 'sc', 'sc-pc', 'sc-upc', 'sc-apc', 'st', 'cs', 'sn', 'sma-905', 'sma-906', 'urm-p2', 'urm-p4', 'urm-p8', 'splice', 'usb-a', 'usb-b', 'usb-c', 'usb-mini-a', 'usb-mini-b', 'usb-micro-a', 'usb-micro-b', 'usb-micro-ab', 'other')),
    color VARCHAR(6),
    positions INT,
    rear_ports JSON,
    description VARCHAR(200),
    mark_connected TINYINT(1) DEFAULT 0,
    owner_id BIGINT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (device_id) REFERENCES dcim_device(id) ON DELETE RESTRICT,
    FOREIGN KEY (module_id) REFERENCES dcim_module(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_interface_template (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    device_type_id BIGINT,
    module_type_id BIGINT,
    name VARCHAR(64) NOT NULL,
    label VARCHAR(64),
    type VARCHAR(32) NOT NULL CHECK (type IN ('virtual', 'bridge', 'lag', '100base-fx', '100base-lfx', '100base-tx', '100base-t1', '1000base-bx10-d', '1000base-bx10-u', '1000base-cwdm', '1000base-cx', '1000base-dwdm', '1000base-ex', '1000base-lsx', '1000base-lx', '1000base-lx10', '1000base-sx', '1000base-t', '1000base-tx', '1000base-zx', '2.5gbase-t', '5gbase-t', '10gbase-br-d', '10gbase-br-u', '10gbase-cu', '10gbase-cx4', '10gbase-er', '10gbase-lr', '10gbase-lrm', '10gbase-lx4', '10gbase-sr', '10gbase-t', '10gbase-zr', '25gbase-cr', '25gbase-er', '25gbase-lr', '25gbase-sr', '25gbase-t', '40gbase-cr4', '40gbase-er4', '40gbase-fr4', '40gbase-lr4', '40gbase-sr4', '40gbase-sr4-bd', '50gbase-cr', '50gbase-er', '50gbase-fr', '50gbase-lr', '50gbase-sr', '100gbase-cr1', '100gbase-cr2', '100gbase-cr4', '100gbase-cr10', '100gbase-cwdm4', '100gbase-dr', '100gbase-er4', '100gbase-fr1', '100gbase-lr1', '100gbase-lr4', '100gbase-sr1', '100gbase-sr1.2', '100gbase-sr2', '100gbase-sr4', '100gbase-sr10', '100gbase-zr', '200gbase-cr2', '200gbase-cr4', '200gbase-dr4', '200gbase-er4', '200gbase-fr4', '200gbase-lr4', '200gbase-sr2', '200gbase-sr4', '200gbase-vr2', '400gbase-cr4', '400gbase-dr4', '400gbase-er8', '400gbase-fr4', '400gbase-fr8', '400gbase-lr4', '400gbase-lr8', '400gbase-sr4', '400gbase-sr4_2', '400gbase-sr8', '400gbase-sr16', '400gbase-vr4', '400gbase-zr', '800gbase-cr8', '800gbase-dr8', '800gbase-sr8', '800gbase-vr8', '1.6tbase-cr8', '1.6tbase-dr8', '1.6tbase-dr8-2', '100base-x-sfp', '1000base-x-gbic', '1000base-x-sfp', '2.5gbase-x-sfp', '10gbase-x-sfpp', '10gbase-x-xenpak', '10gbase-x-xfp', '10gbase-x-x2', '25gbase-x-sfp28', '40gbase-x-qsfpp', '50gbase-x-sfp28', '50gbase-x-sfp56', '100gbase-x-cfp', '100gbase-x-cfp2', '100gbase-x-cfp4', '100gbase-x-cxp', '100gbase-x-cpak', '100gbase-x-dsfp', '100gbase-x-qsfp28', '100gbase-x-qsfpdd', '100gbase-x-sfpdd', '200gbase-x-cfp2', '200gbase-x-qsfp56', '200gbase-x-qsfpdd', '400gbase-x-qsfp112', '400gbase-x-qsfpdd', '400gbase-x-cdfp', '400gbase-x-cfp2', '400gbase-x-cfp8', '400gbase-x-osfp', '400gbase-x-osfp-rhs', '800gbase-x-osfp', '800gbase-x-qsfpdd', '1.6tbase-x-osfp1600', '1.6tbase-x-osfp1600-rhs', '1.6tbase-x-qsfpdd1600', '1000base-kx', '2.5gbase-kx', '5gbase-kr', '10gbase-kr', '10gbase-kx4', '25gbase-kr', '40gbase-kr4', '50gbase-kr', '100gbase-kp4', '100gbase-kr2', '100gbase-kr4', '1.6tbase-kr8', 'ieee802.11a', 'ieee802.11g', 'ieee802.11n', 'ieee802.11ac', 'ieee802.11ad', 'ieee802.11ax', 'ieee802.11ay', 'ieee802.11be', 'ieee802.15.1', 'ieee802.15.4', 'other-wireless', 'gsm', 'cdma', 'lte', '4g', '5g', 'sonet-oc3', 'sonet-oc12', 'sonet-oc48', 'sonet-oc192', 'sonet-oc768', 'sonet-oc1920', 'sonet-oc3840', '1gfc-sfp', '2gfc-sfp', '4gfc-sfp', '8gfc-sfpp', '16gfc-sfpp', '32gfc-sfp28', '32gfc-sfpp', '64gfc-qsfpp', '64gfc-sfpdd', '64gfc-sfpp', '128gfc-qsfp28', 'infiniband-sdr', 'infiniband-ddr', 'infiniband-qdr', 'infiniband-fdr10', 'infiniband-fdr', 'infiniband-edr', 'infiniband-hdr', 'infiniband-ndr', 'infiniband-xdr', 't1', 'e1', 't3', 'e3', 'xdsl', 'docsis', 'moca', 'bpon', 'epon', '10g-epon', 'gpon', 'xg-pon', 'xgs-pon', 'ng-pon2', '25g-pon', '50g-pon', 'cisco-stackwise', 'cisco-stackwise-plus', 'cisco-flexstack', 'cisco-flexstack-plus', 'cisco-stackwise-80', 'cisco-stackwise-160', 'cisco-stackwise-320', 'cisco-stackwise-480', 'cisco-stackwise-1t', 'juniper-vcp', 'extreme-summitstack', 'extreme-summitstack-128', 'extreme-summitstack-256', 'extreme-summitstack-512', 'other')),
    enabled TINYINT(1) DEFAULT 0,
    mgmt_only TINYINT(1) DEFAULT 0,
    description VARCHAR(200),
    bridge_id BIGINT,
    poe_mode VARCHAR(32) CHECK (poe_mode IN ('pd', 'pse')),
    poe_type VARCHAR(32) CHECK (poe_type IN ('type1-ieee802.3af', 'type2-ieee802.3at', 'type3-ieee802.3bt', 'type4-ieee802.3bt', 'passive-24v-2pair', 'passive-24v-4pair', 'passive-48v-2pair', 'passive-48v-4pair')),
    rf_role VARCHAR(32) CHECK (rf_role IN ('ap', 'station')),
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (device_type_id) REFERENCES dcim_device_type(id) ON DELETE SET NULL,
    FOREIGN KEY (module_type_id) REFERENCES dcim_module_type(id) ON DELETE SET NULL,
    FOREIGN KEY (bridge_id) REFERENCES dcim_interface_template(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_interface (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(36) NOT NULL,
    module_id BIGINT,
    name VARCHAR(64) NOT NULL,
    label VARCHAR(64),
    type VARCHAR(32) NOT NULL CHECK (type IN ('virtual', 'bridge', 'lag', '100base-fx', '100base-lfx', '100base-tx', '100base-t1', '1000base-bx10-d', '1000base-bx10-u', '1000base-cwdm', '1000base-cx', '1000base-dwdm', '1000base-ex', '1000base-lsx', '1000base-lx', '1000base-lx10', '1000base-sx', '1000base-t', '1000base-tx', '1000base-zx', '2.5gbase-t', '5gbase-t', '10gbase-br-d', '10gbase-br-u', '10gbase-cu', '10gbase-cx4', '10gbase-er', '10gbase-lr', '10gbase-lrm', '10gbase-lx4', '10gbase-sr', '10gbase-t', '10gbase-zr', '25gbase-cr', '25gbase-er', '25gbase-lr', '25gbase-sr', '25gbase-t', '40gbase-cr4', '40gbase-er4', '40gbase-fr4', '40gbase-lr4', '40gbase-sr4', '40gbase-sr4-bd', '50gbase-cr', '50gbase-er', '50gbase-fr', '50gbase-lr', '50gbase-sr', '100gbase-cr1', '100gbase-cr2', '100gbase-cr4', '100gbase-cr10', '100gbase-cwdm4', '100gbase-dr', '100gbase-er4', '100gbase-fr1', '100gbase-lr1', '100gbase-lr4', '100gbase-sr1', '100gbase-sr1.2', '100gbase-sr2', '100gbase-sr4', '100gbase-sr10', '100gbase-zr', '200gbase-cr2', '200gbase-cr4', '200gbase-dr4', '200gbase-er4', '200gbase-fr4', '200gbase-lr4', '200gbase-sr2', '200gbase-sr4', '200gbase-vr2', '400gbase-cr4', '400gbase-dr4', '400gbase-er8', '400gbase-fr4', '400gbase-fr8', '400gbase-lr4', '400gbase-lr8', '400gbase-sr4', '400gbase-sr4_2', '400gbase-sr8', '400gbase-sr16', '400gbase-vr4', '400gbase-zr', '800gbase-cr8', '800gbase-dr8', '800gbase-sr8', '800gbase-vr8', '1.6tbase-cr8', '1.6tbase-dr8', '1.6tbase-dr8-2', '100base-x-sfp', '1000base-x-gbic', '1000base-x-sfp', '2.5gbase-x-sfp', '10gbase-x-sfpp', '10gbase-x-xenpak', '10gbase-x-xfp', '10gbase-x-x2', '25gbase-x-sfp28', '40gbase-x-qsfpp', '50gbase-x-sfp28', '50gbase-x-sfp56', '100gbase-x-cfp', '100gbase-x-cfp2', '100gbase-x-cfp4', '100gbase-x-cxp', '100gbase-x-cpak', '100gbase-x-dsfp', '100gbase-x-qsfp28', '100gbase-x-qsfpdd', '100gbase-x-sfpdd', '200gbase-x-cfp2', '200gbase-x-qsfp56', '200gbase-x-qsfpdd', '400gbase-x-qsfp112', '400gbase-x-qsfpdd', '400gbase-x-cdfp', '400gbase-x-cfp2', '400gbase-x-cfp8', '400gbase-x-osfp', '400gbase-x-osfp-rhs', '800gbase-x-osfp', '800gbase-x-qsfpdd', '1.6tbase-x-osfp1600', '1.6tbase-x-osfp1600-rhs', '1.6tbase-x-qsfpdd1600', '1000base-kx', '2.5gbase-kx', '5gbase-kr', '10gbase-kr', '10gbase-kx4', '25gbase-kr', '40gbase-kr4', '50gbase-kr', '100gbase-kp4', '100gbase-kr2', '100gbase-kr4', '1.6tbase-kr8', 'ieee802.11a', 'ieee802.11g', 'ieee802.11n', 'ieee802.11ac', 'ieee802.11ad', 'ieee802.11ax', 'ieee802.11ay', 'ieee802.11be', 'ieee802.15.1', 'ieee802.15.4', 'other-wireless', 'gsm', 'cdma', 'lte', '4g', '5g', 'sonet-oc3', 'sonet-oc12', 'sonet-oc48', 'sonet-oc192', 'sonet-oc768', 'sonet-oc1920', 'sonet-oc3840', '1gfc-sfp', '2gfc-sfp', '4gfc-sfp', '8gfc-sfpp', '16gfc-sfpp', '32gfc-sfp28', '32gfc-sfpp', '64gfc-qsfpp', '64gfc-sfpdd', '64gfc-sfpp', '128gfc-qsfp28', 'infiniband-sdr', 'infiniband-ddr', 'infiniband-qdr', 'infiniband-fdr10', 'infiniband-fdr', 'infiniband-edr', 'infiniband-hdr', 'infiniband-ndr', 'infiniband-xdr', 't1', 'e1', 't3', 'e3', 'xdsl', 'docsis', 'moca', 'bpon', 'epon', '10g-epon', 'gpon', 'xg-pon', 'xgs-pon', 'ng-pon2', '25g-pon', '50g-pon', 'cisco-stackwise', 'cisco-stackwise-plus', 'cisco-flexstack', 'cisco-flexstack-plus', 'cisco-stackwise-80', 'cisco-stackwise-160', 'cisco-stackwise-320', 'cisco-stackwise-480', 'cisco-stackwise-1t', 'juniper-vcp', 'extreme-summitstack', 'extreme-summitstack-128', 'extreme-summitstack-256', 'extreme-summitstack-512', 'other')),
    enabled TINYINT(1) DEFAULT 0,
    parent_id BIGINT,
    bridge_id BIGINT,
    lag_id BIGINT,
    mtu INT,
    primary_mac_address_id BIGINT,
    speed BIGINT,
    duplex VARCHAR(32) CHECK (duplex IN ('half', 'full', 'auto')),
    wwn TEXT,
    mgmt_only TINYINT(1) DEFAULT 0,
    description VARCHAR(200),
    mode VARCHAR(32) CHECK (mode IN ('access', 'tagged', 'tagged-all', 'q-in-q')),
    rf_role VARCHAR(32) CHECK (rf_role IN ('ap', 'station')),
    rf_channel VARCHAR(32) CHECK (rf_channel IN ('2.4g-1-2412-22', '2.4g-2-2417-22', '2.4g-3-2422-22', '2.4g-4-2427-22', '2.4g-5-2432-22', '2.4g-6-2437-22', '2.4g-7-2442-22', '2.4g-8-2447-22', '2.4g-9-2452-22', '2.4g-10-2457-22', '2.4g-11-2462-22', '2.4g-12-2467-22', '2.4g-13-2472-22', '5g-32-5160-20', '5g-34-5170-40', '5g-36-5180-20', '5g-38-5190-40', '5g-40-5200-20', '5g-42-5210-80', '5g-44-5220-20', '5g-46-5230-40', '5g-48-5240-20', '5g-50-5250-160', '5g-52-5260-20', '5g-54-5270-40', '5g-56-5280-20', '5g-58-5290-80', '5g-60-5300-20', '5g-62-5310-40', '5g-64-5320-20', '5g-100-5500-20', '5g-102-5510-40', '5g-104-5520-20', '5g-106-5530-80', '5g-108-5540-20', '5g-110-5550-40', '5g-112-5560-20', '5g-114-5570-160', '5g-116-5580-20', '5g-118-5590-40', '5g-120-5600-20', '5g-122-5610-80', '5g-124-5620-20', '5g-126-5630-40', '5g-128-5640-20', '5g-132-5660-20', '5g-134-5670-40', '5g-136-5680-20', '5g-138-5690-80', '5g-140-5700-20', '5g-142-5710-40', '5g-144-5720-20', '5g-149-5745-20', '5g-151-5755-40', '5g-153-5765-20', '5g-155-5775-80', '5g-157-5785-20', '5g-159-5795-40', '5g-161-5805-20', '5g-163-5815-160', '5g-165-5825-20', '5g-167-5835-40', '5g-169-5845-20', '5g-171-5855-80', '5g-173-5865-20', '5g-175-5875-40', '5g-177-5885-20', '6g-1-5955-20', '6g-3-5965-40', '6g-5-5975-20', '6g-7-5985-80', '6g-9-5995-20', '6g-11-6005-40', '6g-13-6015-20', '6g-15-6025-160', '6g-17-6035-20', '6g-19-6045-40', '6g-21-6055-20', '6g-23-6065-80', '6g-25-6075-20', '6g-27-6085-40', '6g-29-6095-20', '6g-31-6105-320', '6g-33-6115-20', '6g-35-6125-40', '6g-37-6135-20', '6g-39-6145-80', '6g-41-6155-20', '6g-43-6165-40', '6g-45-6175-20', '6g-47-6185-160', '6g-49-6195-20', '6g-51-6205-40', '6g-53-6215-20', '6g-55-6225-80', '6g-57-6235-20', '6g-59-6245-40', '6g-61-6255-20', '6g-65-6275-20', '6g-67-6285-40', '6g-69-6295-20', '6g-71-6305-80', '6g-73-6315-20', '6g-75-6325-40', '6g-77-6335-20', '6g-79-6345-160', '6g-81-6355-20', '6g-83-6365-40', '6g-85-6375-20', '6g-87-6385-80', '6g-89-6395-20', '6g-91-6405-40', '6g-93-6415-20', '6g-95-6425-320', '6g-97-6435-20', '6g-99-6445-40', '6g-101-6455-20', '6g-103-6465-80', '6g-105-6475-20', '6g-107-6485-40', '6g-109-6495-20', '6g-111-6505-160', '6g-113-6515-20', '6g-115-6525-40', '6g-117-6535-20', '6g-119-6545-80', '6g-121-6555-20', '6g-123-6565-40', '6g-125-6575-20', '6g-129-6595-20', '6g-131-6605-40', '6g-133-6615-20', '6g-135-6625-80', '6g-137-6635-20', '6g-139-6645-40', '6g-141-6655-20', '6g-143-6665-160', '6g-145-6675-20', '6g-147-6685-40', '6g-149-6695-20', '6g-151-6705-80', '6g-153-6715-20', '6g-155-6725-40', '6g-157-6735-20', '6g-159-6745-320', '6g-161-6755-20', '6g-163-6765-40', '6g-165-6775-20', '6g-167-6785-80', '6g-169-6795-20', '6g-171-6805-40', '6g-173-6815-20', '6g-175-6825-160', '6g-177-6835-20', '6g-179-6845-40', '6g-181-6855-20', '6g-183-6865-80', '6g-185-6875-20', '6g-187-6885-40', '6g-189-6895-20', '6g-193-6915-20', '6g-195-6925-40', '6g-197-6935-20', '6g-199-6945-80', '6g-201-6955-20', '6g-203-6965-40', '6g-205-6975-20', '6g-207-6985-160', '6g-209-6995-20', '6g-211-7005-40', '6g-213-7015-20', '6g-215-7025-80', '6g-217-7035-20', '6g-219-7045-40', '6g-221-7055-20', '6g-225-7075-20', '6g-227-7085-40', '6g-229-7095-20', '6g-233-7115-20', '60g-1-58320-2160', '60g-2-60480-2160', '60g-3-62640-2160', '60g-4-64800-2160', '60g-5-66960-2160', '60g-6-69120-2160', '60g-9-59400-4320', '60g-10-61560-4320', '60g-11-63720-4320', '60g-12-65880-4320', '60g-13-68040-4320', '60g-17-60480-6480', '60g-18-62640-6480', '60g-19-64800-6480', '60g-20-66960-6480', '60g-25-61560-6480', '60g-26-63720-6480', '60g-27-65880-6480')),
    poe_mode VARCHAR(32) CHECK (poe_mode IN ('pd', 'pse')),
    poe_type VARCHAR(32) CHECK (poe_type IN ('type1-ieee802.3af', 'type2-ieee802.3at', 'type3-ieee802.3bt', 'type4-ieee802.3bt', 'passive-24v-2pair', 'passive-24v-4pair', 'passive-48v-2pair', 'passive-48v-4pair')),
    rf_channel_frequency DECIMAL(20,6),
    rf_channel_width DECIMAL(20,6),
    tx_power INT,
    untagged_vlan_id BIGINT,
    qinq_svlan_id BIGINT,
    vlan_translation_policy_id BIGINT,
    mark_connected TINYINT(1) DEFAULT 0,
    vrf_id BIGINT,
    owner_id BIGINT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (device_id) REFERENCES dcim_device(id) ON DELETE RESTRICT,
    FOREIGN KEY (module_id) REFERENCES dcim_module(id) ON DELETE SET NULL,
    FOREIGN KEY (parent_id) REFERENCES dcim_interface(id) ON DELETE SET NULL,
    FOREIGN KEY (bridge_id) REFERENCES dcim_interface(id) ON DELETE SET NULL,
    FOREIGN KEY (lag_id) REFERENCES dcim_interface(id) ON DELETE SET NULL,
    FOREIGN KEY (primary_mac_address_id) REFERENCES dcim_macaddress(id) ON DELETE SET NULL,
    FOREIGN KEY (untagged_vlan_id) REFERENCES ipam_vlan(id) ON DELETE SET NULL,
    FOREIGN KEY (qinq_svlan_id) REFERENCES ipam_vlan(id) ON DELETE SET NULL,
    FOREIGN KEY (vlan_translation_policy_id) REFERENCES ipam_vlantranslation_policy(id) ON DELETE SET NULL,
    FOREIGN KEY (vrf_id) REFERENCES ipam_vrf(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_inventory_item_role (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    color VARCHAR(6),
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_inventory_item_template (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    device_type_id BIGINT NOT NULL,
    parent INT,
    name VARCHAR(64) NOT NULL,
    label VARCHAR(64),
    role_id BIGINT,
    manufacturer_id BIGINT,
    part_id VARCHAR(50),
    description VARCHAR(200),
    component_type VARCHAR(100),
    component_id BIGINT,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (device_type_id) REFERENCES dcim_device_type(id) ON DELETE RESTRICT,
    FOREIGN KEY (role_id) REFERENCES dcim_inventory_item_role(id) ON DELETE SET NULL,
    FOREIGN KEY (manufacturer_id) REFERENCES dcim_manufacturer(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_inventory_item (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(36) NOT NULL,
    parent INT,
    name VARCHAR(64) NOT NULL,
    label VARCHAR(64),
    status VARCHAR(32) CHECK (status IN ('offline', 'active', 'planned', 'staged', 'failed', 'decommissioning')),
    role_id BIGINT,
    manufacturer_id BIGINT,
    part_id VARCHAR(50),
    serial VARCHAR(50),
    asset_tag VARCHAR(50),
    discovered TINYINT(1) DEFAULT 0,
    description VARCHAR(200),
    component_type VARCHAR(100),
    component_id BIGINT,
    owner_id BIGINT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (device_id) REFERENCES dcim_device(id) ON DELETE RESTRICT,
    FOREIGN KEY (role_id) REFERENCES dcim_inventory_item_role(id) ON DELETE SET NULL,
    FOREIGN KEY (manufacturer_id) REFERENCES dcim_manufacturer(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_location (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    site_id BIGINT NOT NULL,
    parent_id BIGINT,
    status VARCHAR(32) CHECK (status IN ('planned', 'staging', 'active', 'decommissioning', 'retired')),
    tenant_id BIGINT,
    facility VARCHAR(50),
    description VARCHAR(200),
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    owner_id BIGINT,
    comments TEXT,
    FOREIGN KEY (site_id) REFERENCES dcim_site(id) ON DELETE RESTRICT,
    FOREIGN KEY (parent_id) REFERENCES dcim_location(id) ON DELETE SET NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenancy_tenant(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_macaddress (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    mac_address TEXT NOT NULL,
    assigned_object_type VARCHAR(100),
    assigned_object_id BIGINT,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_manufacturer (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_module_bay_template (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    device_type_id BIGINT,
    module_type_id BIGINT,
    name VARCHAR(64) NOT NULL,
    label VARCHAR(64),
    position VARCHAR(30),
    enabled TINYINT(1) DEFAULT 0,
    description VARCHAR(200),
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (device_type_id) REFERENCES dcim_device_type(id) ON DELETE SET NULL,
    FOREIGN KEY (module_type_id) REFERENCES dcim_module_type(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_module_bay (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(36) NOT NULL,
    module_id BIGINT,
    name VARCHAR(64) NOT NULL,
    label VARCHAR(64),
    position VARCHAR(30),
    enabled TINYINT(1) DEFAULT 0,
    description VARCHAR(200),
    installed_module_id BIGINT,
    owner_id BIGINT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (device_id) REFERENCES dcim_device(id) ON DELETE RESTRICT,
    FOREIGN KEY (module_id) REFERENCES dcim_module(id) ON DELETE SET NULL,
    FOREIGN KEY (installed_module_id) REFERENCES dcim_module(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_module_type_profile (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(200),
    schema JSON,
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_module_type (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    profile_id BIGINT,
    manufacturer_id BIGINT NOT NULL,
    model VARCHAR(100) NOT NULL,
    part_number VARCHAR(50),
    airflow VARCHAR(32) CHECK (airflow IN ('front-to-rear', 'rear-to-front', 'left-to-right', 'right-to-left', 'side-to-rear', 'passive')),
    weight DECIMAL(20,6),
    weight_unit VARCHAR(32) CHECK (weight_unit IN ('kg', 'g', 'lb', 'oz')),
    description VARCHAR(200),
    attributes JSON,
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (profile_id) REFERENCES dcim_module_type_profile(id) ON DELETE SET NULL,
    FOREIGN KEY (manufacturer_id) REFERENCES dcim_manufacturer(id) ON DELETE RESTRICT,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_module (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(36) NOT NULL,
    module_bay_id BIGINT NOT NULL,
    module_type_id BIGINT NOT NULL,
    status VARCHAR(32) CHECK (status IN ('offline', 'active', 'planned', 'staged', 'failed', 'decommissioning')),
    serial VARCHAR(50),
    asset_tag VARCHAR(50),
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    replicate_components TINYINT(1) DEFAULT 0,
    adopt_components TINYINT(1) DEFAULT 0,
    FOREIGN KEY (device_id) REFERENCES dcim_device(id) ON DELETE RESTRICT,
    FOREIGN KEY (module_bay_id) REFERENCES dcim_module_bay(id) ON DELETE RESTRICT,
    FOREIGN KEY (module_type_id) REFERENCES dcim_module_type(id) ON DELETE RESTRICT,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_platform (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    parent_id BIGINT,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    manufacturer_id BIGINT,
    config_template_id BIGINT,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (parent_id) REFERENCES dcim_platform(id) ON DELETE SET NULL,
    FOREIGN KEY (manufacturer_id) REFERENCES dcim_manufacturer(id) ON DELETE SET NULL,
    FOREIGN KEY (config_template_id) REFERENCES extras_config_template(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_power_feed (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    power_panel_id BIGINT NOT NULL,
    rack_id BIGINT,
    name VARCHAR(100) NOT NULL,
    status VARCHAR(32) CHECK (status IN ('offline', 'active', 'planned', 'failed')),
    type VARCHAR(32) CHECK (type IN ('primary', 'redundant')),
    supply VARCHAR(32) CHECK (supply IN ('ac', 'dc')),
    phase VARCHAR(32) CHECK (phase IN ('single-phase', 'three-phase')),
    voltage INT,
    amperage INT,
    max_utilization INT,
    mark_connected TINYINT(1) DEFAULT 0,
    description VARCHAR(200),
    tenant_id BIGINT,
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (power_panel_id) REFERENCES dcim_power_panel(id) ON DELETE RESTRICT,
    FOREIGN KEY (rack_id) REFERENCES dcim_rack(id) ON DELETE SET NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenancy_tenant(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_power_outlet_template (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    device_type_id BIGINT,
    module_type_id BIGINT,
    name VARCHAR(64) NOT NULL,
    label VARCHAR(64),
    type VARCHAR(32) CHECK (type IN ('iec-60320-c5', 'iec-60320-c7', 'iec-60320-c13', 'iec-60320-c15', 'iec-60320-c17', 'iec-60320-c19', 'iec-60320-c21', 'iec-60309-p-n-e-4h', 'iec-60309-p-n-e-6h', 'iec-60309-p-n-e-9h', 'iec-60309-2p-e-4h', 'iec-60309-2p-e-6h', 'iec-60309-2p-e-9h', 'iec-60309-3p-e-4h', 'iec-60309-3p-e-6h', 'iec-60309-3p-e-9h', 'iec-60309-3p-n-e-4h', 'iec-60309-3p-n-e-6h', 'iec-60309-3p-n-e-9h', 'iec-60906-1', 'nbr-14136-10a', 'nbr-14136-20a', 'nema-1-15r', 'nema-5-15r', 'nema-5-20r', 'nema-5-30r', 'nema-5-50r', 'nema-6-15r', 'nema-6-20r', 'nema-6-30r', 'nema-6-50r', 'nema-10-30r', 'nema-10-50r', 'nema-14-20r', 'nema-14-30r', 'nema-14-50r', 'nema-14-60r', 'nema-15-15r', 'nema-15-20r', 'nema-15-30r', 'nema-15-50r', 'nema-15-60r', 'nema-l1-15r', 'nema-l5-15r', 'nema-l5-20r', 'nema-l5-30r', 'nema-l5-50r', 'nema-l6-15r', 'nema-l6-20r', 'nema-l6-30r', 'nema-l6-50r', 'nema-l10-30r', 'nema-l14-20r', 'nema-l14-30r', 'nema-l14-50r', 'nema-l14-60r', 'nema-l15-20r', 'nema-l15-30r', 'nema-l15-50r', 'nema-l15-60r', 'nema-l21-20r', 'nema-l21-30r', 'nema-l22-20r', 'nema-l22-30r', 'CS6360C', 'CS6364C', 'CS8164C', 'CS8264C', 'CS8364C', 'CS8464C', 'ita-e', 'ita-f', 'ita-g', 'ita-h', 'ita-i', 'ita-j', 'ita-k', 'ita-l', 'ita-m', 'ita-n', 'ita-o', 'ita-multistandard', 'usb-a', 'usb-micro-b', 'usb-c', 'molex-micro-fit-1x2', 'molex-micro-fit-2x2', 'molex-micro-fit-2x3', 'molex-micro-fit-2x4', 'dc-terminal', 'eaton-c39', 'hdot-cx', 'saf-d-grid', 'neutrik-powercon-20a', 'neutrik-powercon-32a', 'neutrik-powercon-true1', 'neutrik-powercon-true1-top', 'ubiquiti-smartpower', 'hardwired', 'other')),
    color VARCHAR(6),
    power_port_id BIGINT,
    feed_leg VARCHAR(32) CHECK (feed_leg IN ('A', 'B', 'C')),
    description VARCHAR(200),
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (device_type_id) REFERENCES dcim_device_type(id) ON DELETE SET NULL,
    FOREIGN KEY (module_type_id) REFERENCES dcim_module_type(id) ON DELETE SET NULL,
    FOREIGN KEY (power_port_id) REFERENCES dcim_power_port_template(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_power_outlet (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(36) NOT NULL,
    module_id BIGINT,
    name VARCHAR(64) NOT NULL,
    label VARCHAR(64),
    type VARCHAR(32) CHECK (type IN ('iec-60320-c5', 'iec-60320-c7', 'iec-60320-c13', 'iec-60320-c15', 'iec-60320-c17', 'iec-60320-c19', 'iec-60320-c21', 'iec-60309-p-n-e-4h', 'iec-60309-p-n-e-6h', 'iec-60309-p-n-e-9h', 'iec-60309-2p-e-4h', 'iec-60309-2p-e-6h', 'iec-60309-2p-e-9h', 'iec-60309-3p-e-4h', 'iec-60309-3p-e-6h', 'iec-60309-3p-e-9h', 'iec-60309-3p-n-e-4h', 'iec-60309-3p-n-e-6h', 'iec-60309-3p-n-e-9h', 'iec-60906-1', 'nbr-14136-10a', 'nbr-14136-20a', 'nema-1-15r', 'nema-5-15r', 'nema-5-20r', 'nema-5-30r', 'nema-5-50r', 'nema-6-15r', 'nema-6-20r', 'nema-6-30r', 'nema-6-50r', 'nema-10-30r', 'nema-10-50r', 'nema-14-20r', 'nema-14-30r', 'nema-14-50r', 'nema-14-60r', 'nema-15-15r', 'nema-15-20r', 'nema-15-30r', 'nema-15-50r', 'nema-15-60r', 'nema-l1-15r', 'nema-l5-15r', 'nema-l5-20r', 'nema-l5-30r', 'nema-l5-50r', 'nema-l6-15r', 'nema-l6-20r', 'nema-l6-30r', 'nema-l6-50r', 'nema-l10-30r', 'nema-l14-20r', 'nema-l14-30r', 'nema-l14-50r', 'nema-l14-60r', 'nema-l15-20r', 'nema-l15-30r', 'nema-l15-50r', 'nema-l15-60r', 'nema-l21-20r', 'nema-l21-30r', 'nema-l22-20r', 'nema-l22-30r', 'CS6360C', 'CS6364C', 'CS8164C', 'CS8264C', 'CS8364C', 'CS8464C', 'ita-e', 'ita-f', 'ita-g', 'ita-h', 'ita-i', 'ita-j', 'ita-k', 'ita-l', 'ita-m', 'ita-n', 'ita-o', 'ita-multistandard', 'usb-a', 'usb-micro-b', 'usb-c', 'molex-micro-fit-1x2', 'molex-micro-fit-2x2', 'molex-micro-fit-2x3', 'molex-micro-fit-2x4', 'dc-terminal', 'eaton-c39', 'hdot-cx', 'saf-d-grid', 'neutrik-powercon-20a', 'neutrik-powercon-32a', 'neutrik-powercon-true1', 'neutrik-powercon-true1-top', 'ubiquiti-smartpower', 'hardwired', 'other')),
    status VARCHAR(32) CHECK (status IN ('enabled', 'disabled', 'faulty')),
    color VARCHAR(6),
    power_port_id BIGINT,
    feed_leg VARCHAR(32) CHECK (feed_leg IN ('A', 'B', 'C')),
    description VARCHAR(200),
    mark_connected TINYINT(1) DEFAULT 0,
    owner_id BIGINT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (device_id) REFERENCES dcim_device(id) ON DELETE RESTRICT,
    FOREIGN KEY (module_id) REFERENCES dcim_module(id) ON DELETE SET NULL,
    FOREIGN KEY (power_port_id) REFERENCES dcim_power_port(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_power_panel (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    site_id BIGINT NOT NULL,
    location_id BIGINT,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (site_id) REFERENCES dcim_site(id) ON DELETE RESTRICT,
    FOREIGN KEY (location_id) REFERENCES dcim_location(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_power_port_template (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    device_type_id BIGINT,
    module_type_id BIGINT,
    name VARCHAR(64) NOT NULL,
    label VARCHAR(64),
    type VARCHAR(32) CHECK (type IN ('iec-60320-c6', 'iec-60320-c8', 'iec-60320-c14', 'iec-60320-c16', 'iec-60320-c18', 'iec-60320-c20', 'iec-60320-c22', 'iec-60309-p-n-e-4h', 'iec-60309-p-n-e-6h', 'iec-60309-p-n-e-9h', 'iec-60309-2p-e-4h', 'iec-60309-2p-e-6h', 'iec-60309-2p-e-9h', 'iec-60309-3p-e-4h', 'iec-60309-3p-e-6h', 'iec-60309-3p-e-9h', 'iec-60309-3p-n-e-4h', 'iec-60309-3p-n-e-6h', 'iec-60309-3p-n-e-9h', 'iec-60906-1', 'nbr-14136-10a', 'nbr-14136-20a', 'nema-1-15p', 'nema-5-15p', 'nema-5-20p', 'nema-5-30p', 'nema-5-50p', 'nema-6-15p', 'nema-6-20p', 'nema-6-30p', 'nema-6-50p', 'nema-10-30p', 'nema-10-50p', 'nema-14-20p', 'nema-14-30p', 'nema-14-50p', 'nema-14-60p', 'nema-15-15p', 'nema-15-20p', 'nema-15-30p', 'nema-15-50p', 'nema-15-60p', 'nema-l1-15p', 'nema-l5-15p', 'nema-l5-20p', 'nema-l5-30p', 'nema-l5-50p', 'nema-l6-15p', 'nema-l6-20p', 'nema-l6-30p', 'nema-l6-50p', 'nema-l10-30p', 'nema-l14-20p', 'nema-l14-30p', 'nema-l14-50p', 'nema-l14-60p', 'nema-l15-20p', 'nema-l15-30p', 'nema-l15-50p', 'nema-l15-60p', 'nema-l21-20p', 'nema-l21-30p', 'nema-l22-20p', 'nema-l22-30p', 'cs6361c', 'cs6365c', 'cs8165c', 'cs8265c', 'cs8365c', 'cs8465c', 'ita-c', 'ita-e', 'ita-f', 'ita-ef', 'ita-g', 'ita-h', 'ita-i', 'ita-j', 'ita-k', 'ita-l', 'ita-m', 'ita-n', 'ita-o', 'usb-a', 'usb-b', 'usb-c', 'usb-mini-a', 'usb-mini-b', 'usb-micro-a', 'usb-micro-b', 'usb-micro-ab', 'usb-3-b', 'usb-3-micro-b', 'molex-micro-fit-1x2', 'molex-micro-fit-2x2', 'molex-micro-fit-2x3', 'molex-micro-fit-2x4', 'dc-terminal', 'saf-d-grid', 'neutrik-powercon-20', 'neutrik-powercon-32', 'neutrik-powercon-true1', 'neutrik-powercon-true1-top', 'ubiquiti-smartpower', 'hardwired', 'other')),
    maximum_draw INT,
    allocated_draw INT,
    description VARCHAR(200),
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (device_type_id) REFERENCES dcim_device_type(id) ON DELETE SET NULL,
    FOREIGN KEY (module_type_id) REFERENCES dcim_module_type(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_power_port (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(36) NOT NULL,
    module_id BIGINT,
    name VARCHAR(64) NOT NULL,
    label VARCHAR(64),
    type VARCHAR(32) CHECK (type IN ('iec-60320-c6', 'iec-60320-c8', 'iec-60320-c14', 'iec-60320-c16', 'iec-60320-c18', 'iec-60320-c20', 'iec-60320-c22', 'iec-60309-p-n-e-4h', 'iec-60309-p-n-e-6h', 'iec-60309-p-n-e-9h', 'iec-60309-2p-e-4h', 'iec-60309-2p-e-6h', 'iec-60309-2p-e-9h', 'iec-60309-3p-e-4h', 'iec-60309-3p-e-6h', 'iec-60309-3p-e-9h', 'iec-60309-3p-n-e-4h', 'iec-60309-3p-n-e-6h', 'iec-60309-3p-n-e-9h', 'iec-60906-1', 'nbr-14136-10a', 'nbr-14136-20a', 'nema-1-15p', 'nema-5-15p', 'nema-5-20p', 'nema-5-30p', 'nema-5-50p', 'nema-6-15p', 'nema-6-20p', 'nema-6-30p', 'nema-6-50p', 'nema-10-30p', 'nema-10-50p', 'nema-14-20p', 'nema-14-30p', 'nema-14-50p', 'nema-14-60p', 'nema-15-15p', 'nema-15-20p', 'nema-15-30p', 'nema-15-50p', 'nema-15-60p', 'nema-l1-15p', 'nema-l5-15p', 'nema-l5-20p', 'nema-l5-30p', 'nema-l5-50p', 'nema-l6-15p', 'nema-l6-20p', 'nema-l6-30p', 'nema-l6-50p', 'nema-l10-30p', 'nema-l14-20p', 'nema-l14-30p', 'nema-l14-50p', 'nema-l14-60p', 'nema-l15-20p', 'nema-l15-30p', 'nema-l15-50p', 'nema-l15-60p', 'nema-l21-20p', 'nema-l21-30p', 'nema-l22-20p', 'nema-l22-30p', 'cs6361c', 'cs6365c', 'cs8165c', 'cs8265c', 'cs8365c', 'cs8465c', 'ita-c', 'ita-e', 'ita-f', 'ita-ef', 'ita-g', 'ita-h', 'ita-i', 'ita-j', 'ita-k', 'ita-l', 'ita-m', 'ita-n', 'ita-o', 'usb-a', 'usb-b', 'usb-c', 'usb-mini-a', 'usb-mini-b', 'usb-micro-a', 'usb-micro-b', 'usb-micro-ab', 'usb-3-b', 'usb-3-micro-b', 'molex-micro-fit-1x2', 'molex-micro-fit-2x2', 'molex-micro-fit-2x3', 'molex-micro-fit-2x4', 'dc-terminal', 'saf-d-grid', 'neutrik-powercon-20', 'neutrik-powercon-32', 'neutrik-powercon-true1', 'neutrik-powercon-true1-top', 'ubiquiti-smartpower', 'hardwired', 'other')),
    maximum_draw INT,
    allocated_draw INT,
    description VARCHAR(200),
    mark_connected TINYINT(1) DEFAULT 0,
    owner_id BIGINT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (device_id) REFERENCES dcim_device(id) ON DELETE RESTRICT,
    FOREIGN KEY (module_id) REFERENCES dcim_module(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_rack_group (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_rack_reservation (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    rack_id BIGINT NOT NULL,
    units JSON NOT NULL,
    status VARCHAR(32) CHECK (status IN ('pending', 'active', 'stale')),
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    user_id BIGINT NOT NULL,
    tenant_id BIGINT,
    description VARCHAR(200) NOT NULL,
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    FOREIGN KEY (rack_id) REFERENCES dcim_rack(id) ON DELETE RESTRICT,
    FOREIGN KEY (user_id) REFERENCES users_user(id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id) REFERENCES tenancy_tenant(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_rack_role (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    color VARCHAR(6),
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_rack_type (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    manufacturer_id BIGINT NOT NULL,
    model VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description VARCHAR(200),
    form_factor VARCHAR(32) CHECK (form_factor IN ('2-post-frame', '4-post-frame', '4-post-cabinet', 'wall-frame', 'wall-frame-vertical', 'wall-cabinet', 'wall-cabinet-vertical')),
    width INT,
    u_height INT,
    starting_unit INT,
    desc_units TINYINT(1) DEFAULT 0,
    outer_width INT,
    outer_height INT,
    outer_depth INT,
    outer_unit VARCHAR(32) CHECK (outer_unit IN ('mm', 'in')),
    weight DECIMAL(20,6),
    max_weight INT,
    weight_unit VARCHAR(32) CHECK (weight_unit IN ('kg', 'g', 'lb', 'oz')),
    mounting_depth INT,
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (manufacturer_id) REFERENCES dcim_manufacturer(id) ON DELETE RESTRICT,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_rack (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    facility_id VARCHAR(50),
    site_id BIGINT NOT NULL,
    location_id BIGINT,
    group_id BIGINT,
    tenant_id BIGINT,
    status VARCHAR(32) CHECK (status IN ('reserved', 'available', 'planned', 'active', 'deprecated')),
    role_id BIGINT,
    serial VARCHAR(50),
    asset_tag VARCHAR(50),
    rack_type_id BIGINT,
    form_factor VARCHAR(32) CHECK (form_factor IN ('2-post-frame', '4-post-frame', '4-post-cabinet', 'wall-frame', 'wall-frame-vertical', 'wall-cabinet', 'wall-cabinet-vertical')),
    width INT,
    u_height INT,
    starting_unit INT,
    weight DECIMAL(20,6),
    max_weight INT,
    weight_unit VARCHAR(32) CHECK (weight_unit IN ('kg', 'g', 'lb', 'oz')),
    desc_units TINYINT(1) DEFAULT 0,
    outer_width INT,
    outer_height INT,
    outer_depth INT,
    outer_unit VARCHAR(32) CHECK (outer_unit IN ('mm', 'in')),
    mounting_depth INT,
    airflow VARCHAR(32) CHECK (airflow IN ('front-to-rear', 'rear-to-front')),
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (site_id) REFERENCES dcim_site(id) ON DELETE RESTRICT,
    FOREIGN KEY (location_id) REFERENCES dcim_location(id) ON DELETE SET NULL,
    FOREIGN KEY (group_id) REFERENCES dcim_rack_group(id) ON DELETE SET NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenancy_tenant(id) ON DELETE SET NULL,
    FOREIGN KEY (role_id) REFERENCES dcim_rack_role(id) ON DELETE SET NULL,
    FOREIGN KEY (rack_type_id) REFERENCES dcim_rack_type(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_rear_port_template (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    device_type_id BIGINT,
    module_type_id BIGINT,
    name VARCHAR(64) NOT NULL,
    label VARCHAR(64),
    type VARCHAR(32) NOT NULL CHECK (type IN ('8p8c', '8p6c', '8p4c', '8p2c', '6p6c', '6p4c', '6p2c', '4p4c', '4p2c', 'gg45', 'tera-4p', 'tera-2p', 'tera-1p', '110-punch', 'bnc', 'f', 'n', 'mrj21', 'fc', 'fc-pc', 'fc-upc', 'fc-apc', 'lc', 'lc-pc', 'lc-upc', 'lc-apc', 'lsh', 'lsh-pc', 'lsh-upc', 'lsh-apc', 'lx5', 'lx5-pc', 'lx5-upc', 'lx5-apc', 'mpo', 'mtrj', 'sc', 'sc-pc', 'sc-upc', 'sc-apc', 'st', 'cs', 'sn', 'sma-905', 'sma-906', 'urm-p2', 'urm-p4', 'urm-p8', 'splice', 'usb-a', 'usb-b', 'usb-c', 'usb-mini-a', 'usb-mini-b', 'usb-micro-a', 'usb-micro-b', 'usb-micro-ab', 'other')),
    color VARCHAR(6),
    positions INT,
    front_ports JSON,
    description VARCHAR(200),
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (device_type_id) REFERENCES dcim_device_type(id) ON DELETE SET NULL,
    FOREIGN KEY (module_type_id) REFERENCES dcim_module_type(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_rear_port (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(36) NOT NULL,
    module_id BIGINT,
    name VARCHAR(64) NOT NULL,
    label VARCHAR(64),
    type VARCHAR(32) NOT NULL CHECK (type IN ('8p8c', '8p6c', '8p4c', '8p2c', '6p6c', '6p4c', '6p2c', '4p4c', '4p2c', 'gg45', 'tera-4p', 'tera-2p', 'tera-1p', '110-punch', 'bnc', 'f', 'n', 'mrj21', 'fc', 'fc-pc', 'fc-upc', 'fc-apc', 'lc', 'lc-pc', 'lc-upc', 'lc-apc', 'lsh', 'lsh-pc', 'lsh-upc', 'lsh-apc', 'lx5', 'lx5-pc', 'lx5-upc', 'lx5-apc', 'mpo', 'mtrj', 'sc', 'sc-pc', 'sc-upc', 'sc-apc', 'st', 'cs', 'sn', 'sma-905', 'sma-906', 'urm-p2', 'urm-p4', 'urm-p8', 'splice', 'usb-a', 'usb-b', 'usb-c', 'usb-mini-a', 'usb-mini-b', 'usb-micro-a', 'usb-micro-b', 'usb-micro-ab', 'other')),
    color VARCHAR(6),
    positions INT,
    front_ports JSON,
    description VARCHAR(200),
    mark_connected TINYINT(1) DEFAULT 0,
    owner_id BIGINT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (device_id) REFERENCES dcim_device(id) ON DELETE RESTRICT,
    FOREIGN KEY (module_id) REFERENCES dcim_module(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_region (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    parent_id BIGINT,
    description VARCHAR(200),
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    owner_id BIGINT,
    comments TEXT,
    FOREIGN KEY (parent_id) REFERENCES dcim_region(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_site_group (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    parent_id BIGINT,
    description VARCHAR(200),
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    owner_id BIGINT,
    comments TEXT,
    FOREIGN KEY (parent_id) REFERENCES dcim_site_group(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_site (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    status VARCHAR(32) CHECK (status IN ('planned', 'staging', 'active', 'decommissioning', 'retired')),
    region_id BIGINT,
    group_id BIGINT,
    tenant_id BIGINT,
    facility VARCHAR(50),
    time_zone TEXT,
    description VARCHAR(200),
    physical_address VARCHAR(200),
    shipping_address VARCHAR(200),
    latitude DECIMAL(20,6),
    longitude DECIMAL(20,6),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (region_id) REFERENCES dcim_region(id) ON DELETE SET NULL,
    FOREIGN KEY (group_id) REFERENCES dcim_site_group(id) ON DELETE SET NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenancy_tenant(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_virtual_chassis (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    domain VARCHAR(30),
    master_id VARCHAR(36),
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (master_id) REFERENCES dcim_device(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_virtual_device_context (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    device_id VARCHAR(36) NOT NULL,
    identifier INT,
    tenant_id BIGINT,
    primary_ip4_id BIGINT,
    primary_ip6_id BIGINT,
    status VARCHAR(32) NOT NULL CHECK (status IN ('active', 'planned', 'offline')),
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (device_id) REFERENCES dcim_device(id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id) REFERENCES tenancy_tenant(id) ON DELETE SET NULL,
    FOREIGN KEY (primary_ip4_id) REFERENCES ipam_ipaddress(id) ON DELETE SET NULL,
    FOREIGN KEY (primary_ip6_id) REFERENCES ipam_ipaddress(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ipam_aggregate (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    prefix TEXT NOT NULL,
    rir_id BIGINT NOT NULL,
    tenant_id BIGINT,
    date_added DATE,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (rir_id) REFERENCES ipam_rir(id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id) REFERENCES tenancy_tenant(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ipam_asnrange (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    rir_id BIGINT NOT NULL,
    start BIGINT NOT NULL,
    end BIGINT NOT NULL,
    tenant_id BIGINT,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (rir_id) REFERENCES ipam_rir(id) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id) REFERENCES tenancy_tenant(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ipam_asn (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    asn BIGINT NOT NULL,
    rir_id BIGINT,
    role_id BIGINT,
    tenant_id BIGINT,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (rir_id) REFERENCES ipam_rir(id) ON DELETE SET NULL,
    FOREIGN KEY (role_id) REFERENCES ipam_role(id) ON DELETE SET NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenancy_tenant(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ipam_fhrpgroup_assignment (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    group_id BIGINT NOT NULL,
    interface_type VARCHAR(100) NOT NULL,
    interface_id BIGINT NOT NULL,
    priority INT NOT NULL,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (group_id) REFERENCES ipam_fhrpgroup(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ipam_fhrpgroup (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100),
    protocol VARCHAR(32) NOT NULL CHECK (protocol IN ('vrrp2', 'vrrp3', 'carp', 'clusterxl', 'hsrp', 'glbp', 'other')),
    group_id INT NOT NULL,
    auth_type VARCHAR(32) CHECK (auth_type IN ('plaintext', 'md5')),
    auth_key VARCHAR(255),
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ipam_ipaddress (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    address TEXT NOT NULL,
    vrf_id BIGINT,
    tenant_id BIGINT,
    status VARCHAR(32) CHECK (status IN ('active', 'reserved', 'deprecated', 'dhcp', 'slaac')),
    role VARCHAR(32) CHECK (role IN ('loopback', 'secondary', 'anycast', 'vip', 'vrrp', 'hsrp', 'glbp', 'carp')),
    assigned_object_type VARCHAR(100),
    assigned_object_id BIGINT,
    nat_inside_id BIGINT,
    dns_name VARCHAR(255),
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (vrf_id) REFERENCES ipam_vrf(id) ON DELETE SET NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenancy_tenant(id) ON DELETE SET NULL,
    FOREIGN KEY (nat_inside_id) REFERENCES ipam_ipaddress(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ipam_iprange (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    start_address TEXT NOT NULL,
    end_address TEXT NOT NULL,
    gateway TEXT,
    dhcp_relays JSON,
    vrf_id BIGINT,
    tenant_id BIGINT,
    status VARCHAR(32) CHECK (status IN ('active', 'reserved', 'deprecated')),
    role_id BIGINT,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    mark_populated TINYINT(1) DEFAULT 0,
    mark_utilized TINYINT(1) DEFAULT 0,
    FOREIGN KEY (vrf_id) REFERENCES ipam_vrf(id) ON DELETE SET NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenancy_tenant(id) ON DELETE SET NULL,
    FOREIGN KEY (role_id) REFERENCES ipam_role(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ipam_prefix (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    prefix TEXT NOT NULL,
    vrf_id BIGINT,
    scope_type VARCHAR(100),
    scope_id BIGINT,
    tenant_id BIGINT,
    vlan_id BIGINT,
    status VARCHAR(32) CHECK (status IN ('container', 'active', 'reserved', 'deprecated')),
    role_id BIGINT,
    is_pool TINYINT(1) DEFAULT 0,
    mark_utilized TINYINT(1) DEFAULT 0,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (vrf_id) REFERENCES ipam_vrf(id) ON DELETE SET NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenancy_tenant(id) ON DELETE SET NULL,
    FOREIGN KEY (vlan_id) REFERENCES ipam_vlan(id) ON DELETE SET NULL,
    FOREIGN KEY (role_id) REFERENCES ipam_role(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ipam_rir (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    is_private TINYINT(1) DEFAULT 0,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ipam_role (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    weight INT,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ipam_route_target (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(21) NOT NULL,
    tenant_id BIGINT,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (tenant_id) REFERENCES tenancy_tenant(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ipam_service_template (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    protocol VARCHAR(32) NOT NULL CHECK (protocol IN ('tcp', 'udp', 'sctp')),
    ports JSON NOT NULL,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ipam_service (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    parent_object_type VARCHAR(100) NOT NULL,
    parent_object_id BIGINT NOT NULL,
    name VARCHAR(100) NOT NULL,
    protocol VARCHAR(32) NOT NULL CHECK (protocol IN ('tcp', 'udp', 'sctp')),
    ports JSON NOT NULL,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ipam_vlangroup (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    scope_type VARCHAR(100),
    scope_id BIGINT,
    vid_ranges JSON,
    tenant_id BIGINT,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (tenant_id) REFERENCES tenancy_tenant(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ipam_vlantranslation_policy (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ipam_vlantranslation_rule (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    policy INT NOT NULL,
    local_vid INT NOT NULL,
    remote_vid INT NOT NULL,
    description VARCHAR(200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ipam_vlan (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    site_id BIGINT,
    group_id BIGINT,
    vid INT NOT NULL,
    name VARCHAR(64) NOT NULL,
    tenant_id BIGINT,
    status VARCHAR(32) CHECK (status IN ('active', 'reserved', 'deprecated')),
    role_id BIGINT,
    description VARCHAR(200),
    qinq_role VARCHAR(32) CHECK (qinq_role IN ('svlan', 'cvlan')),
    qinq_svlan_id BIGINT,
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (site_id) REFERENCES dcim_site(id) ON DELETE SET NULL,
    FOREIGN KEY (group_id) REFERENCES ipam_vlangroup(id) ON DELETE SET NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenancy_tenant(id) ON DELETE SET NULL,
    FOREIGN KEY (role_id) REFERENCES ipam_role(id) ON DELETE SET NULL,
    FOREIGN KEY (qinq_svlan_id) REFERENCES ipam_vlan(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ipam_vrf (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    rd VARCHAR(21),
    tenant_id BIGINT,
    enforce_unique TINYINT(1) DEFAULT 0,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (tenant_id) REFERENCES tenancy_tenant(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE virtualization_cluster_group (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE virtualization_cluster_type (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE virtualization_cluster (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type_id BIGINT NOT NULL,
    group_id BIGINT,
    status VARCHAR(32) CHECK (status IN ('planned', 'staging', 'active', 'decommissioning', 'offline')),
    tenant_id BIGINT,
    scope_type VARCHAR(100),
    scope_id BIGINT,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (type_id) REFERENCES virtualization_cluster_type(id) ON DELETE RESTRICT,
    FOREIGN KEY (group_id) REFERENCES virtualization_cluster_group(id) ON DELETE SET NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenancy_tenant(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE virtualization_vminterface (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    virtual_machine_id BIGINT NOT NULL,
    name VARCHAR(64) NOT NULL,
    enabled TINYINT(1) DEFAULT 0,
    parent_id BIGINT,
    bridge_id BIGINT,
    mtu INT,
    primary_mac_address_id BIGINT,
    description VARCHAR(200),
    mode VARCHAR(32) CHECK (mode IN ('access', 'tagged', 'tagged-all', 'q-in-q')),
    untagged_vlan_id BIGINT,
    qinq_svlan_id BIGINT,
    vlan_translation_policy_id BIGINT,
    vrf_id BIGINT,
    owner_id BIGINT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (virtual_machine_id) REFERENCES virtualization_virtual_machine(id) ON DELETE RESTRICT,
    FOREIGN KEY (parent_id) REFERENCES virtualization_vminterface(id) ON DELETE SET NULL,
    FOREIGN KEY (bridge_id) REFERENCES virtualization_vminterface(id) ON DELETE SET NULL,
    FOREIGN KEY (primary_mac_address_id) REFERENCES dcim_macaddress(id) ON DELETE SET NULL,
    FOREIGN KEY (untagged_vlan_id) REFERENCES ipam_vlan(id) ON DELETE SET NULL,
    FOREIGN KEY (qinq_svlan_id) REFERENCES ipam_vlan(id) ON DELETE SET NULL,
    FOREIGN KEY (vlan_translation_policy_id) REFERENCES ipam_vlantranslation_policy(id) ON DELETE SET NULL,
    FOREIGN KEY (vrf_id) REFERENCES ipam_vrf(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE virtualization_virtual_disk (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    virtual_machine_id BIGINT NOT NULL,
    name VARCHAR(64) NOT NULL,
    description VARCHAR(200),
    size INT NOT NULL,
    owner_id BIGINT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (virtual_machine_id) REFERENCES virtualization_virtual_machine(id) ON DELETE RESTRICT,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE virtualization_virtual_machine_type (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    default_platform_id BIGINT,
    default_vcpus DECIMAL(20,6),
    default_memory INT,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (default_platform_id) REFERENCES dcim_platform(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE virtualization_virtual_machine (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    virtual_machine_type_id BIGINT,
    role_id BIGINT,
    status VARCHAR(32) CHECK (status IN ('offline', 'active', 'planned', 'staged', 'failed', 'decommissioning', 'paused')),
    start_on_boot VARCHAR(32) CHECK (start_on_boot IN ('on', 'off', 'laststate')),
    site_id BIGINT,
    cluster_id BIGINT,
    device_id VARCHAR(36),
    platform_id BIGINT,
    image_id BIGINT,
    primary_ip4_id BIGINT,
    primary_ip6_id BIGINT,
    vcpus DECIMAL(20,6),
    memory INT,
    disk INT,
    description VARCHAR(200),
    serial VARCHAR(50),
    tenant_id BIGINT,
    owner_id BIGINT,
    comments TEXT,
    local_context_data JSON,
    config_template_id BIGINT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (virtual_machine_type_id) REFERENCES virtualization_virtual_machine_type(id) ON DELETE SET NULL,
    FOREIGN KEY (role_id) REFERENCES dcim_device_role(id) ON DELETE SET NULL,
    FOREIGN KEY (site_id) REFERENCES dcim_site(id) ON DELETE SET NULL,
    FOREIGN KEY (cluster_id) REFERENCES virtualization_cluster(id) ON DELETE SET NULL,
    FOREIGN KEY (device_id) REFERENCES dcim_device(id) ON DELETE SET NULL,
    FOREIGN KEY (platform_id) REFERENCES dcim_platform(id) ON DELETE SET NULL,
    FOREIGN KEY (image_id) REFERENCES virtualization_image(id) ON DELETE SET NULL,
    FOREIGN KEY (primary_ip4_id) REFERENCES ipam_ipaddress(id) ON DELETE SET NULL,
    FOREIGN KEY (primary_ip6_id) REFERENCES ipam_ipaddress(id) ON DELETE SET NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenancy_tenant(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL,
    FOREIGN KEY (config_template_id) REFERENCES extras_config_template(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE extras_tag (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    color VARCHAR(6),
    description VARCHAR(200),
    weight INT,
    object_types JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tenancy_tenant (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    group_id BIGINT,
    description VARCHAR(200),
    owner_id BIGINT,
    comments TEXT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (group_id) REFERENCES tenancy_tenant_group(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tenancy_tenant_group (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    parent_id BIGINT,
    description VARCHAR(200),
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    owner_id BIGINT,
    comments TEXT,
    FOREIGN KEY (parent_id) REFERENCES tenancy_tenant_group(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE users_owner (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    group_id BIGINT,
    description VARCHAR(200),
    FOREIGN KEY (group_id) REFERENCES users_owner_group(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE users_owner_group (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE users_user (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(150) NOT NULL,
    email VARCHAR(254),
    first_name VARCHAR(150),
    last_name VARCHAR(150),
    is_active TINYINT(1) DEFAULT 0,
    is_staff TINYINT(1) DEFAULT 0,
    date_joined DATETIME(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE users_group (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE extras_config_template (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(200),
    template_code TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE virtualization_ssh_key (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    public_key TEXT NOT NULL,
    description VARCHAR(200),
    owner_id BIGINT,
    source_type VARCHAR(100),
    source_id BIGINT,
    custom_fields JSON,
    created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (owner_id) REFERENCES users_user(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE vpn_l2_vpntermination (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    l2vpn_id BIGINT,
    assigned_object_type VARCHAR(100),
    assigned_object_id BIGINT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE wireless_wireless_lan (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    ssid VARCHAR(32) NOT NULL,
    description VARCHAR(200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE wireless_wireless_link (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    ssid VARCHAR(32),
    description VARCHAR(200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===== Polymorphic tagging =====
-- Polymorphic tagging: links any row (object_type + object_id) to a tag.
CREATE TABLE tagging_taggeditem (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    tag_id BIGINT NOT NULL,
    object_type VARCHAR(100) NOT NULL,
    object_id VARCHAR(64) NOT NULL,
    FOREIGN KEY (tag_id) REFERENCES extras_tag(id) ON DELETE CASCADE,
    UNIQUE (tag_id, object_type, object_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===== M2M join tables =====
CREATE TABLE dcim_interface_vdcs (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    interface_id BIGINT NOT NULL,
    virtual_device_context_id BIGINT NOT NULL,
    FOREIGN KEY (interface_id) REFERENCES dcim_interface(id) ON DELETE CASCADE,
    FOREIGN KEY (virtual_device_context_id) REFERENCES dcim_virtual_device_context(id) ON DELETE CASCADE,
    UNIQUE (interface_id, virtual_device_context_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_interface_tagged_vlans (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    interface_id BIGINT NOT NULL,
    vlan_id BIGINT NOT NULL,
    FOREIGN KEY (interface_id) REFERENCES dcim_interface(id) ON DELETE CASCADE,
    FOREIGN KEY (vlan_id) REFERENCES ipam_vlan(id) ON DELETE CASCADE,
    UNIQUE (interface_id, vlan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dcim_interface_wireless_lans (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    interface_id BIGINT NOT NULL,
    wireless_lan_id BIGINT NOT NULL,
    FOREIGN KEY (interface_id) REFERENCES dcim_interface(id) ON DELETE CASCADE,
    FOREIGN KEY (wireless_lan_id) REFERENCES wireless_wireless_lan(id) ON DELETE CASCADE,
    UNIQUE (interface_id, wireless_lan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ipam_asn_sites (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    asn_id BIGINT NOT NULL,
    site_id BIGINT NOT NULL,
    FOREIGN KEY (asn_id) REFERENCES ipam_asn(id) ON DELETE CASCADE,
    FOREIGN KEY (site_id) REFERENCES dcim_site(id) ON DELETE CASCADE,
    UNIQUE (asn_id, site_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ipam_service_ipaddresses (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    service_id BIGINT NOT NULL,
    ipaddress_id BIGINT NOT NULL,
    FOREIGN KEY (service_id) REFERENCES ipam_service(id) ON DELETE CASCADE,
    FOREIGN KEY (ipaddress_id) REFERENCES ipam_ipaddress(id) ON DELETE CASCADE,
    UNIQUE (service_id, ipaddress_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ipam_vrf_import_targets (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    vrf_id BIGINT NOT NULL,
    route_target_id BIGINT NOT NULL,
    FOREIGN KEY (vrf_id) REFERENCES ipam_vrf(id) ON DELETE CASCADE,
    FOREIGN KEY (route_target_id) REFERENCES ipam_route_target(id) ON DELETE CASCADE,
    UNIQUE (vrf_id, route_target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ipam_vrf_export_targets (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    vrf_id BIGINT NOT NULL,
    route_target_id BIGINT NOT NULL,
    FOREIGN KEY (vrf_id) REFERENCES ipam_vrf(id) ON DELETE CASCADE,
    FOREIGN KEY (route_target_id) REFERENCES ipam_route_target(id) ON DELETE CASCADE,
    UNIQUE (vrf_id, route_target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE virtualization_vminterface_tagged_vlans (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    vminterface_id BIGINT NOT NULL,
    vlan_id BIGINT NOT NULL,
    FOREIGN KEY (vminterface_id) REFERENCES virtualization_vminterface(id) ON DELETE CASCADE,
    FOREIGN KEY (vlan_id) REFERENCES ipam_vlan(id) ON DELETE CASCADE,
    UNIQUE (vminterface_id, vlan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE users_owner_user_groups (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    owner_id BIGINT NOT NULL,
    group_id BIGINT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES users_group(id) ON DELETE CASCADE,
    UNIQUE (owner_id, group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE users_owner_users (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    owner_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users_owner(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users_user(id) ON DELETE CASCADE,
    UNIQUE (owner_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ===== Unique constraints (indexes) =====
CREATE UNIQUE INDEX uq_dcim_cable_bundle_name ON dcim_cable_bundle (name);
CREATE UNIQUE INDEX uq_dcim_device_role_slug ON dcim_device_role (slug);
CREATE UNIQUE INDEX uq_dcim_device_role_parent_id_name ON dcim_device_role (parent_id, name);
CREATE UNIQUE INDEX uq_dcim_device_role_parent_id_slug ON dcim_device_role (parent_id, slug);
CREATE UNIQUE INDEX uq_dcim_device_type_slug ON dcim_device_type (slug);
CREATE UNIQUE INDEX uq_dcim_device_type_manufacturer_id_model ON dcim_device_type (manufacturer_id, model);
CREATE UNIQUE INDEX uq_dcim_device_type_manufacturer_id_slug ON dcim_device_type (manufacturer_id, slug);
CREATE UNIQUE INDEX uq_dcim_front_port_template_device_type_id_name ON dcim_front_port_template (device_type_id, name);
CREATE UNIQUE INDEX uq_dcim_front_port_template_module_type_id_name ON dcim_front_port_template (module_type_id, name);
CREATE UNIQUE INDEX uq_dcim_front_port_device_id_name ON dcim_front_port (device_id, name);
CREATE UNIQUE INDEX uq_dcim_inventory_item_role_slug ON dcim_inventory_item_role (slug);
CREATE UNIQUE INDEX uq_dcim_inventory_item_template_device_type_id_parent_name ON dcim_inventory_item_template (device_type_id, parent, name);
CREATE UNIQUE INDEX uq_dcim_inventory_item_asset_tag ON dcim_inventory_item (asset_tag);
CREATE UNIQUE INDEX uq_dcim_inventory_item_device_id_parent_name ON dcim_inventory_item (device_id, parent, name);
CREATE UNIQUE INDEX uq_dcim_location_slug ON dcim_location (slug);
CREATE UNIQUE INDEX uq_dcim_location_site_id_parent_id_name ON dcim_location (site_id, parent_id, name);
CREATE UNIQUE INDEX uq_dcim_location_site_id_parent_id_slug ON dcim_location (site_id, parent_id, slug);
CREATE UNIQUE INDEX uq_dcim_manufacturer_slug ON dcim_manufacturer (slug);
CREATE UNIQUE INDEX uq_dcim_module_bay_device_id_module_id_name ON dcim_module_bay (device_id, module_id, name);
CREATE UNIQUE INDEX uq_dcim_module_type_profile_name ON dcim_module_type_profile (name);
CREATE UNIQUE INDEX uq_dcim_module_type_manufacturer_id_model ON dcim_module_type (manufacturer_id, model);
CREATE UNIQUE INDEX uq_dcim_module_asset_tag ON dcim_module (asset_tag);
CREATE UNIQUE INDEX uq_dcim_platform_slug ON dcim_platform (slug);
CREATE UNIQUE INDEX uq_dcim_platform_manufacturer_id_name ON dcim_platform (manufacturer_id, name);
CREATE UNIQUE INDEX uq_dcim_platform_manufacturer_id_slug ON dcim_platform (manufacturer_id, slug);
CREATE UNIQUE INDEX uq_dcim_power_feed_power_panel_id_name ON dcim_power_feed (power_panel_id, name);
CREATE UNIQUE INDEX uq_dcim_power_panel_site_id_name ON dcim_power_panel (site_id, name);
CREATE UNIQUE INDEX uq_dcim_rack_group_slug ON dcim_rack_group (slug);
CREATE UNIQUE INDEX uq_dcim_rack_role_slug ON dcim_rack_role (slug);
CREATE UNIQUE INDEX uq_dcim_rack_type_slug ON dcim_rack_type (slug);
CREATE UNIQUE INDEX uq_dcim_rack_type_manufacturer_id_model ON dcim_rack_type (manufacturer_id, model);
CREATE UNIQUE INDEX uq_dcim_rack_type_manufacturer_id_slug ON dcim_rack_type (manufacturer_id, slug);
CREATE UNIQUE INDEX uq_dcim_rack_asset_tag ON dcim_rack (asset_tag);
CREATE UNIQUE INDEX uq_dcim_rack_location_id_name ON dcim_rack (location_id, name);
CREATE UNIQUE INDEX uq_dcim_rack_location_id_facility_id ON dcim_rack (location_id, facility_id);
CREATE UNIQUE INDEX uq_dcim_region_slug ON dcim_region (slug);
CREATE UNIQUE INDEX uq_dcim_region_parent_id_name ON dcim_region (parent_id, name);
CREATE UNIQUE INDEX uq_dcim_region_parent_id_slug ON dcim_region (parent_id, slug);
CREATE UNIQUE INDEX uq_dcim_site_group_slug ON dcim_site_group (slug);
CREATE UNIQUE INDEX uq_dcim_site_group_parent_id_name ON dcim_site_group (parent_id, name);
CREATE UNIQUE INDEX uq_dcim_site_group_parent_id_slug ON dcim_site_group (parent_id, slug);
CREATE UNIQUE INDEX uq_dcim_site_name ON dcim_site (name);
CREATE UNIQUE INDEX uq_dcim_site_slug ON dcim_site (slug);
CREATE UNIQUE INDEX uq_dcim_virtual_device_context_device_id_identifier ON dcim_virtual_device_context (device_id, identifier);
CREATE UNIQUE INDEX uq_dcim_virtual_device_context_device_id_name ON dcim_virtual_device_context (device_id, name);
CREATE UNIQUE INDEX uq_ipam_asnrange_name ON ipam_asnrange (name);
CREATE UNIQUE INDEX uq_ipam_asnrange_slug ON ipam_asnrange (slug);
CREATE UNIQUE INDEX uq_ipam_asn_asn ON ipam_asn (asn);
CREATE UNIQUE INDEX uq_ipam_fhrpgroup_assignment_interface_type_interface_id__292c88 ON ipam_fhrpgroup_assignment (interface_type, interface_id, group_id);
CREATE UNIQUE INDEX uq_ipam_rir_slug ON ipam_rir (slug);
CREATE UNIQUE INDEX uq_ipam_role_slug ON ipam_role (slug);
CREATE UNIQUE INDEX uq_ipam_route_target_name ON ipam_route_target (name);
CREATE UNIQUE INDEX uq_ipam_service_template_name ON ipam_service_template (name);
CREATE UNIQUE INDEX uq_ipam_vlangroup_slug ON ipam_vlangroup (slug);
CREATE UNIQUE INDEX uq_ipam_vlangroup_scope_type_scope_id_name ON ipam_vlangroup (scope_type, scope_id, name);
CREATE UNIQUE INDEX uq_ipam_vlangroup_scope_type_scope_id_slug ON ipam_vlangroup (scope_type, scope_id, slug);
CREATE UNIQUE INDEX uq_ipam_vlantranslation_policy_name ON ipam_vlantranslation_policy (name);
CREATE UNIQUE INDEX uq_ipam_vlantranslation_rule_policy_local_vid ON ipam_vlantranslation_rule (policy, local_vid);
CREATE UNIQUE INDEX uq_ipam_vlantranslation_rule_policy_remote_vid ON ipam_vlantranslation_rule (policy, remote_vid);
CREATE UNIQUE INDEX uq_ipam_vlan_group_id_vid ON ipam_vlan (group_id, vid);
CREATE UNIQUE INDEX uq_ipam_vlan_group_id_name ON ipam_vlan (group_id, name);
CREATE UNIQUE INDEX uq_ipam_vlan_qinq_svlan_id_vid ON ipam_vlan (qinq_svlan_id, vid);
CREATE UNIQUE INDEX uq_ipam_vlan_qinq_svlan_id_name ON ipam_vlan (qinq_svlan_id, name);
CREATE UNIQUE INDEX uq_ipam_vrf_rd ON ipam_vrf (rd);
CREATE UNIQUE INDEX uq_virtualization_cluster_group_slug ON virtualization_cluster_group (slug);
CREATE UNIQUE INDEX uq_virtualization_cluster_type_slug ON virtualization_cluster_type (slug);
CREATE UNIQUE INDEX uq_virtualization_cluster_group_id_name ON virtualization_cluster (group_id, name);
CREATE UNIQUE INDEX uq_virtualization_virtual_machine_type_slug ON virtualization_virtual_machine_type (slug);
CREATE UNIQUE INDEX uq_virtualization_virtual_machine_type_name ON virtualization_virtual_machine_type (name);
CREATE UNIQUE INDEX uq_virtualization_virtual_machine_name_cluster_id_tenant_id ON virtualization_virtual_machine (name, cluster_id, tenant_id);
CREATE UNIQUE INDEX uq_extras_tag_slug ON extras_tag (slug);
CREATE UNIQUE INDEX uq_tenancy_tenant_slug ON tenancy_tenant (slug);
CREATE UNIQUE INDEX uq_tenancy_tenant_group_id_name ON tenancy_tenant (group_id, name);
CREATE UNIQUE INDEX uq_tenancy_tenant_group_id_slug ON tenancy_tenant (group_id, slug);
CREATE UNIQUE INDEX uq_tenancy_tenant_group_name ON tenancy_tenant_group (name);
CREATE UNIQUE INDEX uq_tenancy_tenant_group_slug ON tenancy_tenant_group (slug);
CREATE UNIQUE INDEX uq_users_owner_name ON users_owner (name);
CREATE UNIQUE INDEX uq_users_owner_group_name ON users_owner_group (name);
CREATE UNIQUE INDEX uq_users_user_username ON users_user (username);
CREATE UNIQUE INDEX uq_users_group_name ON users_group (name);
CREATE UNIQUE INDEX uq_extras_config_template_name ON extras_config_template (name);
CREATE UNIQUE INDEX uq_virtualization_image_name ON virtualization_image (name);
CREATE UNIQUE INDEX uq_virtualization_ssh_key_name ON virtualization_ssh_key (name);

-- ----- constraints enforced in the application layer -----
-- SKIP unique on dcim_cable_termination (termination_type, termination_id): column not present in model
-- SKIP unique on dcim_cable_termination (cable, cable_end, connector): column not present in model
-- APP-ENFORCED unique on dcim_device_role (name) WHERE parent IS NULL (partial index unsupported in MariaDB)
-- APP-ENFORCED unique on dcim_device_role (slug) WHERE parent IS NULL (partial index unsupported in MariaDB)
-- APP-ENFORCED unique on dcim_location (site_id, name) WHERE parent IS NULL (partial index unsupported in MariaDB)
-- APP-ENFORCED unique on dcim_location (site_id, slug) WHERE parent IS NULL (partial index unsupported in MariaDB)
-- APP-ENFORCED unique on dcim_platform (name) WHERE manufacturer IS NULL (partial index unsupported in MariaDB)
-- APP-ENFORCED unique on dcim_platform (slug) WHERE manufacturer IS NULL (partial index unsupported in MariaDB)
-- APP-ENFORCED unique on dcim_region (name) WHERE parent IS NULL (partial index unsupported in MariaDB)
-- APP-ENFORCED unique on dcim_region (slug) WHERE parent IS NULL (partial index unsupported in MariaDB)
-- APP-ENFORCED unique on dcim_site_group (name) WHERE parent IS NULL (partial index unsupported in MariaDB)
-- APP-ENFORCED unique on dcim_site_group (slug) WHERE parent IS NULL (partial index unsupported in MariaDB)
-- SKIP unique on virtualization_cluster (_site, name): column not present in model
-- APP-ENFORCED unique on virtualization_virtual_machine (name, cluster_id) WHERE tenant IS NULL (partial index unsupported in MariaDB)
-- APP-ENFORCED unique on virtualization_virtual_machine (name, device_id, tenant_id) WHERE None None (partial index unsupported in MariaDB)
-- APP-ENFORCED unique on virtualization_virtual_machine (name, device_id) WHERE None None (partial index unsupported in MariaDB)
-- APP-ENFORCED unique on tenancy_tenant (name) WHERE group IS NULL (partial index unsupported in MariaDB)
-- APP-ENFORCED unique on tenancy_tenant (slug) WHERE group IS NULL (partial index unsupported in MariaDB)

SET FOREIGN_KEY_CHECKS = 1;
