// Dual-dialect DDL for the OpenStack plugin. Applied (and tracked in `schema_migrations`
// as `plugin:openstack:0001_initial`) by paashup's `loadPlugins`.
//
// Only `plugin_openstack_cloud` is an exposed entity. The other tables map OpenStack ids
// (region, Nova server id, Cinder volume id) to the core Cluster / VirtualMachine /
// VirtualDisk rows the sync writes. Flavors have no link table: a VM type is matched by name.
import type { PluginMigration } from '../../plugins/types.js';

const sqlite = `
CREATE TABLE IF NOT EXISTS plugin_openstack_cloud (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  auth_url TEXT NOT NULL,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  user_domain_name TEXT NOT NULL DEFAULT 'Default',
  project_name TEXT NOT NULL,
  project_domain_name TEXT NOT NULL DEFAULT 'Default',
  region TEXT NOT NULL,
  cluster_id INTEGER REFERENCES virtualization_cluster(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'created',
  error TEXT,
  operation TEXT NOT NULL DEFAULT 'none',
  last_synced TEXT,
  custom_fields TEXT,
  created TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_updated TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS plugin_openstack_server (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cloud_id INTEGER NOT NULL REFERENCES plugin_openstack_cloud(id) ON DELETE CASCADE,
  server_id TEXT NOT NULL,
  virtual_machine_id INTEGER NOT NULL REFERENCES virtualization_virtual_machine(id) ON DELETE CASCADE,
  managed INTEGER NOT NULL DEFAULT 0,
  UNIQUE (cloud_id, server_id)
);
`;

const mariadb = `
CREATE TABLE IF NOT EXISTS plugin_openstack_cloud (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  auth_url VARCHAR(1024) NOT NULL,
  username VARCHAR(255) NOT NULL,
  password VARCHAR(255) NOT NULL,
  user_domain_name VARCHAR(255) NOT NULL DEFAULT 'Default',
  project_name VARCHAR(255) NOT NULL,
  project_domain_name VARCHAR(255) NOT NULL DEFAULT 'Default',
  region VARCHAR(255) NOT NULL,
  cluster_id BIGINT NULL,
  state VARCHAR(32) NOT NULL DEFAULT 'created',
  error LONGTEXT,
  operation VARCHAR(32) NOT NULL DEFAULT 'none',
  last_synced DATETIME(6) NULL,
  custom_fields LONGTEXT,
  created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
  last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_os_cloud_cluster FOREIGN KEY (cluster_id)
    REFERENCES virtualization_cluster(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plugin_openstack_server (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cloud_id BIGINT NOT NULL,
  server_id VARCHAR(64) NOT NULL,
  virtual_machine_id BIGINT NOT NULL,
  managed TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT fk_os_server_cloud FOREIGN KEY (cloud_id)
    REFERENCES plugin_openstack_cloud(id) ON DELETE CASCADE,
  CONSTRAINT fk_os_server_vm FOREIGN KEY (virtual_machine_id)
    REFERENCES virtualization_virtual_machine(id) ON DELETE CASCADE,
  UNIQUE KEY uq_os_server_cloud_server (cloud_id, server_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

export const INITIAL_MIGRATION: PluginMigration = { version: '0001_initial', sqlite, mariadb };

// 0002: a Cloud is now one set of credentials spanning every region of the project, so
// the region (and the cluster) move off the cloud into a per-region table. The server
// links remember their region, and Cinder volumes get a link to their virtual disk. Existing rows keep their region and cluster. (`cloud.cluster_id` stays as an
// unused legacy column: SQLite can't drop a column that carries a foreign key.)
const sqlite2 = `
CREATE TABLE IF NOT EXISTS plugin_openstack_region (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cloud_id INTEGER NOT NULL REFERENCES plugin_openstack_cloud(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cluster_id INTEGER REFERENCES virtualization_cluster(id) ON DELETE SET NULL,
  error TEXT,
  last_synced TEXT,
  UNIQUE (cloud_id, name)
);
INSERT INTO plugin_openstack_region (cloud_id, name, cluster_id)
  SELECT id, region, cluster_id FROM plugin_openstack_cloud WHERE region <> '';

ALTER TABLE plugin_openstack_server ADD COLUMN region TEXT NOT NULL DEFAULT '';
UPDATE plugin_openstack_server
   SET region = (SELECT region FROM plugin_openstack_cloud c WHERE c.id = plugin_openstack_server.cloud_id);
ALTER TABLE plugin_openstack_cloud DROP COLUMN region;

CREATE TABLE IF NOT EXISTS plugin_openstack_volume (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cloud_id INTEGER NOT NULL REFERENCES plugin_openstack_cloud(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  volume_id TEXT NOT NULL,
  virtual_disk_id INTEGER NOT NULL REFERENCES virtualization_virtual_disk(id) ON DELETE CASCADE,
  UNIQUE (cloud_id, volume_id)
);
`;

const mariadb2 = `
CREATE TABLE IF NOT EXISTS plugin_openstack_region (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cloud_id BIGINT NOT NULL,
  name VARCHAR(255) NOT NULL,
  cluster_id BIGINT NULL,
  error LONGTEXT,
  last_synced DATETIME(6) NULL,
  CONSTRAINT fk_os_region_cloud FOREIGN KEY (cloud_id)
    REFERENCES plugin_openstack_cloud(id) ON DELETE CASCADE,
  CONSTRAINT fk_os_region_cluster FOREIGN KEY (cluster_id)
    REFERENCES virtualization_cluster(id) ON DELETE SET NULL,
  UNIQUE KEY uq_os_region_cloud_name (cloud_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO plugin_openstack_region (cloud_id, name, cluster_id)
  SELECT id, region, cluster_id FROM plugin_openstack_cloud WHERE region <> '';

ALTER TABLE plugin_openstack_server ADD COLUMN region VARCHAR(255) NOT NULL DEFAULT '';
UPDATE plugin_openstack_server s
   JOIN plugin_openstack_cloud c ON c.id = s.cloud_id SET s.region = c.region;
ALTER TABLE plugin_openstack_cloud DROP COLUMN region;

CREATE TABLE IF NOT EXISTS plugin_openstack_volume (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cloud_id BIGINT NOT NULL,
  region VARCHAR(255) NOT NULL,
  volume_id VARCHAR(64) NOT NULL,
  virtual_disk_id BIGINT NOT NULL,
  CONSTRAINT fk_os_volume_cloud FOREIGN KEY (cloud_id)
    REFERENCES plugin_openstack_cloud(id) ON DELETE CASCADE,
  CONSTRAINT fk_os_volume_disk FOREIGN KEY (virtual_disk_id)
    REFERENCES virtualization_virtual_disk(id) ON DELETE CASCADE,
  UNIQUE KEY uq_os_volume_cloud_volume (cloud_id, volume_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

export const REGIONS_MIGRATION: PluginMigration = {
  version: '0002_regions',
  sqlite: sqlite2,
  mariadb: mariadb2,
};

// 0003: the metadata (key → value, as JSON text) of each server, as Nova last reported it. Filled
// by every import; rows imported before this migration get theirs at the next sync.
export const METADATA_MIGRATION: PluginMigration = {
  version: '0003_server_metadata',
  sqlite: `ALTER TABLE plugin_openstack_server ADD COLUMN metadata TEXT;`,
  mariadb: `ALTER TABLE plugin_openstack_server ADD COLUMN metadata LONGTEXT NULL;`,
};

// 0004: a VM of a cloud is deleted from paashup whoever created it, so the `managed` mark
// (set on the servers paashup created) is no longer used.
export const DROP_MANAGED_MIGRATION: PluginMigration = {
  version: '0004_drop_managed',
  sqlite: `ALTER TABLE plugin_openstack_server DROP COLUMN managed;`,
  mariadb: `ALTER TABLE plugin_openstack_server DROP COLUMN managed;`,
};
