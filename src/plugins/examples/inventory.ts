// Example paasbox plugin: a small "inventory" app that adds its own entity
// (auto-CRUD under /api/plugins/inventory/assets/), a custom stats endpoint, and
// a write hook. Demonstrates the full plugin surface in one file.
import type { TableMeta } from '../../model/meta-types.js';
import type { Plugin } from '../types.js';

const TABLE = 'plugin_inventory_asset';

const assetMeta: TableMeta = {
  model: 'InventoryAsset',
  table: TABLE,
  section: 'plugins',
  endpoint: '/api/plugins/inventory/assets/',
  origin: 'plugin',
  pk: 'id',
  objectType: 'plugins.inventoryasset',
  readOnly: false,
  relations: [],
  counts: [],
  columns: [
    {
      name: 'name',
      column: 'name',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: true,
      maxLength: 100,
    },
    {
      name: 'serial',
      column: 'serial',
      tsKind: 'string',
      nullable: true,
      writable: true,
      required: false,
      maxLength: 100,
    },
    {
      name: 'quantity',
      column: 'quantity',
      tsKind: 'number',
      nullable: false,
      writable: true,
      required: false,
    },
    {
      name: 'status',
      column: 'status',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: false,
      enum: ['in-stock', 'deployed', 'retired'],
      enumLabels: { 'in-stock': 'In stock', deployed: 'Deployed', retired: 'Retired' },
    },
    {
      name: 'description',
      column: 'description',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: false,
      maxLength: 200,
    },
    {
      name: 'created',
      column: 'created',
      tsKind: 'string',
      nullable: true,
      writable: false,
      required: false,
    },
    {
      name: 'last_updated',
      column: 'last_updated',
      tsKind: 'string',
      nullable: true,
      writable: false,
      required: false,
    },
  ],
};

const initial = {
  version: '0001_initial',
  sqlite: `
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      serial TEXT,
      quantity INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'in-stock',
      description TEXT NOT NULL DEFAULT '',
      created TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      last_updated TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );`,
  mariadb: `
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      serial VARCHAR(100),
      quantity INT NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'in-stock',
      description VARCHAR(200) NOT NULL DEFAULT '',
      created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
      last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
};

// A tiny piece of plugin-local state, surfaced via a custom route to prove hooks fire.
let createdCount = 0;

export const inventoryPlugin: Plugin = {
  name: 'inventory',
  version: '0.1.0',
  entities: [{ meta: assetMeta }],
  migrations: [initial],
  // Extend a CORE entity with custom fields (stored in its custom_fields column).
  customFields: [
    { tables: ['dcim_manufacturer'], name: 'owner_team', type: 'text', default: '' },
    {
      tables: ['dcim_manufacturer'],
      name: 'tier',
      type: 'select',
      choices: ['bronze', 'silver', 'gold'],
      default: 'bronze',
    },
    { tables: ['dcim_manufacturer'], name: 'monitored', type: 'boolean', default: false },
  ],
  routes: [
    {
      method: 'GET',
      path: '/api/plugins/inventory/stats/',
      handler: async ({ db }) => {
        const rows = await db.query<{ status: string; n: number }>(
          `SELECT status, COUNT(*) AS n FROM ${TABLE} GROUP BY status`,
        );
        const by_status: Record<string, number> = {};
        let total = 0;
        for (const r of rows) {
          by_status[r.status] = Number(r.n);
          total += Number(r.n);
        }
        return { status: 200, body: { total, by_status, created_via_hook: createdCount } };
      },
    },
  ],
  hooks: [
    {
      table: TABLE,
      event: 'created',
      handler: () => {
        createdCount++;
      },
    },
  ],
};

export default inventoryPlugin;
