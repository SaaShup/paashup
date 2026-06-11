// Dual-dialect DDL for the Cloudflare plugin, ported from the Django models of
// netbox_cloudflare_plugin. Applied (and tracked in `schema_migrations` as
// `plugin:cloudflare:0001_initial`) by paasbox's `loadPlugins`.
import type { PluginMigration } from '../../plugins/types.js';

const sqlite = `
CREATE TABLE IF NOT EXISTS plugin_cloudflare_zoneaccount (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_name TEXT NOT NULL UNIQUE,
  zone_id TEXT NOT NULL,
  token TEXT NOT NULL,
  custom_fields TEXT,
  created TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_updated TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS plugin_cloudflare_dnsrecord (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id INTEGER NOT NULL REFERENCES plugin_cloudflare_zoneaccount(id) ON DELETE CASCADE,
  record_id TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'CNAME',
  content TEXT NOT NULL,
  ttl INTEGER NOT NULL DEFAULT 3600,
  proxied INTEGER NOT NULL DEFAULT 0,
  custom_fields TEXT,
  created TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_updated TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (zone_id, name, type, content)
);
`;

const mariadb = `
CREATE TABLE IF NOT EXISTS plugin_cloudflare_zoneaccount (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  zone_name VARCHAR(255) NOT NULL UNIQUE,
  zone_id VARCHAR(255) NOT NULL,
  token VARCHAR(255) NOT NULL,
  custom_fields LONGTEXT,
  created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
  last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plugin_cloudflare_dnsrecord (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  zone_id BIGINT NOT NULL,
  record_id VARCHAR(32),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(64) NOT NULL DEFAULT 'CNAME',
  content VARCHAR(255) NOT NULL,
  ttl INT NOT NULL DEFAULT 3600,
  proxied TINYINT(1) NOT NULL DEFAULT 0,
  custom_fields LONGTEXT,
  created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
  last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_cf_dnsrecord_zone FOREIGN KEY (zone_id)
    REFERENCES plugin_cloudflare_zoneaccount(id) ON DELETE CASCADE,
  UNIQUE KEY uq_cf_dnsrecord_zone_name_type_content (zone_id, name, type, content)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

export const INITIAL_MIGRATION: PluginMigration = { version: '0001_initial', sqlite, mariadb };
