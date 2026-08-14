/**
 * Database schema for the Keycloak plugin.
 * Dual-dialect DDL (SQLite & MariaDB).
 *
 * Hierarchy: server → realm → client → redirect_url (all cascade on delete).
 */

import type { PluginMigration } from '../../plugins/types.js';

export const migrations: readonly PluginMigration[] = [
  {
    version: '0001_initial',
    sqlite: `
      CREATE TABLE plugin_keycloak_server (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        url TEXT NOT NULL,
        admin_username TEXT NOT NULL,
        admin_password TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE plugin_keycloak_realm (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER NOT NULL REFERENCES plugin_keycloak_server(id) ON DELETE CASCADE,
        realm_name TEXT NOT NULL,
        UNIQUE(server_id, realm_name)
      );

      CREATE TABLE plugin_keycloak_client (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        realm_id INTEGER NOT NULL REFERENCES plugin_keycloak_realm(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL,
        kc_uuid TEXT,
        secret TEXT,
        UNIQUE(realm_id, client_id)
      );

      CREATE TABLE plugin_keycloak_redirect_url (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL REFERENCES plugin_keycloak_client(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'callback',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(client_id, url, kind)
      );
    `,
    mariadb: `
      CREATE TABLE plugin_keycloak_server (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        url TEXT NOT NULL,
        admin_username VARCHAR(255) NOT NULL,
        admin_password VARCHAR(1024) NOT NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE plugin_keycloak_realm (
        id INT AUTO_INCREMENT PRIMARY KEY,
        server_id INT NOT NULL,
        realm_name VARCHAR(255) NOT NULL,
        UNIQUE KEY uk_server_realm (server_id, realm_name),
        FOREIGN KEY (server_id) REFERENCES plugin_keycloak_server(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE plugin_keycloak_client (
        id INT AUTO_INCREMENT PRIMARY KEY,
        realm_id INT NOT NULL,
        client_id VARCHAR(255) NOT NULL,
        kc_uuid VARCHAR(64),
        secret VARCHAR(512),
        UNIQUE KEY uk_realm_client (realm_id, client_id),
        FOREIGN KEY (realm_id) REFERENCES plugin_keycloak_realm(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE plugin_keycloak_redirect_url (
        id INT AUTO_INCREMENT PRIMARY KEY,
        client_id INT NOT NULL,
        -- 750 + kind(16) keeps UNIQUE(client_id, url, kind) under InnoDB's
        -- 3072-byte key limit (utf8mb4: 4 bytes/char)
        url VARCHAR(750) NOT NULL,
        kind VARCHAR(16) NOT NULL DEFAULT 'callback',
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE KEY uk_client_url_kind (client_id, url, kind),
        FOREIGN KEY (client_id) REFERENCES plugin_keycloak_client(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
  },
];
