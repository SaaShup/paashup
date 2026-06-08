// Dual-dialect DDL for the Docker plugin's 15 tables, ported from the Django
// migrations of netbox_docker_plugin. Applied (and tracked in `schema_migrations`
// as `plugin:docker:0001_initial`) by paasbox's `loadPlugins`.
//
// FK on-delete mirrors the source models: hosts cascade to their registries/images/
// volumes/networks/containers; containers cascade to their child rows; container→image,
// mount→volume and network_setting→network are RESTRICT.
import type { PluginMigration } from '../../plugins/types.js';

const sqlite = `
CREATE TABLE IF NOT EXISTS plugin_docker_host (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL,
  name TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'created',
  netbox_base_url TEXT,
  agent_version TEXT,
  docker_api_version TEXT,
  operation TEXT NOT NULL DEFAULT 'none',
  custom_fields TEXT,
  created TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_updated TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS plugin_docker_registry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER NOT NULL REFERENCES plugin_docker_host(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  serveraddress TEXT NOT NULL,
  username TEXT,
  password TEXT,
  email TEXT,
  custom_fields TEXT,
  created TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_updated TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (host_id, name)
);

CREATE TABLE IF NOT EXISTS plugin_docker_volume (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER NOT NULL REFERENCES plugin_docker_host(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  max_size INTEGER,
  driver TEXT NOT NULL DEFAULT 'local',
  custom_fields TEXT,
  created TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_updated TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (host_id, name)
);

CREATE TABLE IF NOT EXISTS plugin_docker_network (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER NOT NULL REFERENCES plugin_docker_host(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  driver TEXT,
  network_id TEXT,
  state TEXT NOT NULL DEFAULT 'creating',
  custom_fields TEXT,
  created TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_updated TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (host_id, name),
  UNIQUE (host_id, network_id)
);

CREATE TABLE IF NOT EXISTS plugin_docker_image (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER NOT NULL REFERENCES plugin_docker_host(id) ON DELETE CASCADE,
  registry_id INTEGER NOT NULL REFERENCES plugin_docker_registry(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT 'latest',
  size INTEGER NOT NULL DEFAULT 0,
  image_id TEXT,
  digest TEXT,
  custom_fields TEXT,
  created TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_updated TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (host_id, registry_id, name, version),
  UNIQUE (host_id, image_id)
);

CREATE TABLE IF NOT EXISTS plugin_docker_container (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER NOT NULL REFERENCES plugin_docker_host(id) ON DELETE CASCADE,
  image_id INTEGER NOT NULL REFERENCES plugin_docker_image(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'none',
  status TEXT,
  container_id TEXT,
  operation TEXT NOT NULL DEFAULT 'create',
  hostname TEXT,
  restart_policy TEXT NOT NULL DEFAULT 'no',
  cap_add TEXT,
  cap_drop TEXT,
  log_driver TEXT,
  sec_opt TEXT,
  pid_mode TEXT,
  extra_hosts TEXT,
  cmd TEXT,
  custom_fields TEXT,
  created TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_updated TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (host_id, name),
  UNIQUE (host_id, container_id)
);

CREATE TABLE IF NOT EXISTS plugin_docker_port (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id INTEGER NOT NULL REFERENCES plugin_docker_container(id) ON DELETE CASCADE,
  private_port INTEGER NOT NULL,
  public_port INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'tcp',
  UNIQUE (private_port, public_port, type, container_id)
);

CREATE TABLE IF NOT EXISTS plugin_docker_label (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id INTEGER NOT NULL REFERENCES plugin_docker_container(id) ON DELETE CASCADE,
  \`key\` TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  UNIQUE (\`key\`, container_id)
);

CREATE TABLE IF NOT EXISTS plugin_docker_env (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id INTEGER NOT NULL REFERENCES plugin_docker_container(id) ON DELETE CASCADE,
  var_name TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  UNIQUE (var_name, container_id)
);

CREATE TABLE IF NOT EXISTS plugin_docker_log_driver_option (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id INTEGER NOT NULL REFERENCES plugin_docker_container(id) ON DELETE CASCADE,
  option_name TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  UNIQUE (option_name, container_id)
);

CREATE TABLE IF NOT EXISTS plugin_docker_mount (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id INTEGER NOT NULL REFERENCES plugin_docker_container(id) ON DELETE CASCADE,
  volume_id INTEGER NOT NULL REFERENCES plugin_docker_volume(id) ON DELETE RESTRICT,
  source TEXT NOT NULL,
  read_only INTEGER NOT NULL DEFAULT 0,
  UNIQUE (container_id, source, volume_id)
);

CREATE TABLE IF NOT EXISTS plugin_docker_bind (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id INTEGER NOT NULL REFERENCES plugin_docker_container(id) ON DELETE CASCADE,
  host_path TEXT NOT NULL,
  container_path TEXT NOT NULL,
  read_only INTEGER NOT NULL DEFAULT 0,
  UNIQUE (container_id, container_path, host_path)
);

CREATE TABLE IF NOT EXISTS plugin_docker_network_setting (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id INTEGER NOT NULL REFERENCES plugin_docker_container(id) ON DELETE CASCADE,
  network_id INTEGER NOT NULL REFERENCES plugin_docker_network(id) ON DELETE RESTRICT,
  UNIQUE (container_id, network_id)
);

CREATE TABLE IF NOT EXISTS plugin_docker_device (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id INTEGER NOT NULL REFERENCES plugin_docker_container(id) ON DELETE CASCADE,
  host_path TEXT NOT NULL,
  container_path TEXT NOT NULL,
  UNIQUE (container_id, container_path, host_path)
);

CREATE TABLE IF NOT EXISTS plugin_docker_sysctl (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id INTEGER NOT NULL REFERENCES plugin_docker_container(id) ON DELETE CASCADE,
  \`key\` TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  UNIQUE (\`key\`, container_id)
)
`;

const mariadb = `
CREATE TABLE IF NOT EXISTS plugin_docker_host (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  endpoint VARCHAR(1024) NOT NULL,
  name VARCHAR(255) NOT NULL UNIQUE,
  state VARCHAR(32) NOT NULL DEFAULT 'created',
  netbox_base_url VARCHAR(1024),
  agent_version VARCHAR(32),
  docker_api_version VARCHAR(32),
  operation VARCHAR(32) NOT NULL DEFAULT 'none',
  custom_fields JSON,
  created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
  last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plugin_docker_registry (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  host_id BIGINT NOT NULL,
  name VARCHAR(255) NOT NULL,
  serveraddress VARCHAR(200) NOT NULL,
  username VARCHAR(2048),
  password VARCHAR(512),
  email VARCHAR(512),
  custom_fields JSON,
  created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
  last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_registry_host_name (host_id, name),
  FOREIGN KEY (host_id) REFERENCES plugin_docker_host(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plugin_docker_volume (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  host_id BIGINT NOT NULL,
  name VARCHAR(255) NOT NULL,
  max_size INT,
  driver VARCHAR(32) NOT NULL DEFAULT 'local',
  custom_fields JSON,
  created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
  last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_volume_host_name (host_id, name),
  FOREIGN KEY (host_id) REFERENCES plugin_docker_host(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plugin_docker_network (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  host_id BIGINT NOT NULL,
  name VARCHAR(255) NOT NULL,
  driver VARCHAR(32),
  network_id VARCHAR(128),
  state VARCHAR(32) NOT NULL DEFAULT 'creating',
  custom_fields JSON,
  created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
  last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_network_host_name (host_id, name),
  UNIQUE KEY uq_network_host_nid (host_id, network_id),
  FOREIGN KEY (host_id) REFERENCES plugin_docker_host(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plugin_docker_image (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  host_id BIGINT NOT NULL,
  registry_id BIGINT NOT NULL,
  name VARCHAR(255) NOT NULL,
  version VARCHAR(256) NOT NULL DEFAULT 'latest',
  size INT NOT NULL DEFAULT 0,
  image_id VARCHAR(128),
  digest VARCHAR(512),
  custom_fields JSON,
  created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
  last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_image_h_r_n_v (host_id, registry_id, name, version),
  UNIQUE KEY uq_image_host_iid (host_id, image_id),
  FOREIGN KEY (host_id) REFERENCES plugin_docker_host(id) ON DELETE CASCADE,
  FOREIGN KEY (registry_id) REFERENCES plugin_docker_registry(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plugin_docker_container (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  host_id BIGINT NOT NULL,
  image_id BIGINT NOT NULL,
  name VARCHAR(255) NOT NULL,
  state VARCHAR(32) NOT NULL DEFAULT 'none',
  status VARCHAR(1024),
  container_id VARCHAR(128),
  operation VARCHAR(32) NOT NULL DEFAULT 'create',
  hostname VARCHAR(256),
  restart_policy VARCHAR(32) NOT NULL DEFAULT 'no',
  cap_add JSON,
  cap_drop JSON,
  log_driver VARCHAR(32),
  sec_opt JSON,
  pid_mode VARCHAR(512),
  extra_hosts JSON,
  cmd JSON,
  custom_fields JSON,
  created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
  last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_container_host_name (host_id, name),
  UNIQUE KEY uq_container_host_cid (host_id, container_id),
  FOREIGN KEY (host_id) REFERENCES plugin_docker_host(id) ON DELETE CASCADE,
  FOREIGN KEY (image_id) REFERENCES plugin_docker_image(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plugin_docker_port (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  container_id BIGINT NOT NULL,
  private_port INT NOT NULL,
  public_port INT NOT NULL,
  type VARCHAR(3) NOT NULL DEFAULT 'tcp',
  UNIQUE KEY uq_port (private_port, public_port, type, container_id),
  FOREIGN KEY (container_id) REFERENCES plugin_docker_container(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plugin_docker_label (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  container_id BIGINT NOT NULL,
  \`key\` VARCHAR(255) NOT NULL,
  value VARCHAR(4095) NOT NULL DEFAULT '',
  UNIQUE KEY uq_label (\`key\`, container_id),
  FOREIGN KEY (container_id) REFERENCES plugin_docker_container(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plugin_docker_env (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  container_id BIGINT NOT NULL,
  var_name VARCHAR(255) NOT NULL,
  value VARCHAR(32768) NOT NULL DEFAULT '',
  UNIQUE KEY uq_env (var_name, container_id),
  FOREIGN KEY (container_id) REFERENCES plugin_docker_container(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plugin_docker_log_driver_option (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  container_id BIGINT NOT NULL,
  option_name VARCHAR(255) NOT NULL,
  value VARCHAR(4096) NOT NULL DEFAULT '',
  UNIQUE KEY uq_ldo (option_name, container_id),
  FOREIGN KEY (container_id) REFERENCES plugin_docker_container(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plugin_docker_mount (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  container_id BIGINT NOT NULL,
  volume_id BIGINT NOT NULL,
  source VARCHAR(1024) NOT NULL,
  read_only TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_mount (container_id, source, volume_id),
  FOREIGN KEY (container_id) REFERENCES plugin_docker_container(id) ON DELETE CASCADE,
  FOREIGN KEY (volume_id) REFERENCES plugin_docker_volume(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plugin_docker_bind (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  container_id BIGINT NOT NULL,
  host_path VARCHAR(1024) NOT NULL,
  container_path VARCHAR(1024) NOT NULL,
  read_only TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_bind (container_id, container_path, host_path),
  FOREIGN KEY (container_id) REFERENCES plugin_docker_container(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plugin_docker_network_setting (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  container_id BIGINT NOT NULL,
  network_id BIGINT NOT NULL,
  UNIQUE KEY uq_netset (container_id, network_id),
  FOREIGN KEY (container_id) REFERENCES plugin_docker_container(id) ON DELETE CASCADE,
  FOREIGN KEY (network_id) REFERENCES plugin_docker_network(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plugin_docker_device (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  container_id BIGINT NOT NULL,
  host_path VARCHAR(1024) NOT NULL,
  container_path VARCHAR(1024) NOT NULL,
  UNIQUE KEY uq_device (container_id, container_path, host_path),
  FOREIGN KEY (container_id) REFERENCES plugin_docker_container(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plugin_docker_sysctl (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  container_id BIGINT NOT NULL,
  \`key\` VARCHAR(255) NOT NULL,
  value VARCHAR(4095) NOT NULL DEFAULT '',
  UNIQUE KEY uq_sysctl (\`key\`, container_id),
  FOREIGN KEY (container_id) REFERENCES plugin_docker_container(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

export const INITIAL_MIGRATION: PluginMigration = { version: '0001_initial', sqlite, mariadb };
