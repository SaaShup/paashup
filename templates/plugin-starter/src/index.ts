// A paas2box plugin: one default-exported `Plugin` object. The host paas2box loads
// it (via PB_PLUGINS or the package.json discovery convention) and turns your
// entity metadata into a full NetBox-shaped CRUD API automatically.
//
// Rename "example" throughout to your plugin's name, and replace the Widget entity
// with your own (see docs/PLUGIN-PORTING.md for the NetBox → paas2box mapping).
import type { Plugin, TableMeta } from 'paas2box';

const NAME = 'example';
const TABLE = `plugin_${NAME}_widget`;

// 1) Entity metadata → automatic CRUD at /api/plugins/example/widgets/
const widget: TableMeta = {
  model: 'Widget',
  table: TABLE,
  section: 'plugins',
  endpoint: `/api/plugins/${NAME}/widgets/`,
  origin: 'plugin',
  pk: 'id',
  objectType: `plugins.widget`,
  readOnly: false,
  relations: [],
  counts: [],
  columns: [
    { name: 'name', column: 'name', tsKind: 'string', nullable: false, writable: true, required: true, maxLength: 100 },
    { name: 'quantity', column: 'quantity', tsKind: 'number', nullable: false, writable: true, required: false },
    {
      name: 'status',
      column: 'status',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: false,
      enum: ['active', 'retired'],
      enumLabels: { active: 'Active', retired: 'Retired' },
    },
    { name: 'description', column: 'description', tsKind: 'string', nullable: false, writable: true, required: false, maxLength: 200 },
    { name: 'created', column: 'created', tsKind: 'string', nullable: true, writable: false, required: false },
    { name: 'last_updated', column: 'last_updated', tsKind: 'string', nullable: true, writable: false, required: false },
  ],
};

// 2) Versioned migration (per dialect). Ship later changes as 0002_…, 0003_…
const initial = {
  version: '0001_initial',
  sqlite: `
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      description TEXT NOT NULL DEFAULT '',
      created TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      last_updated TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );`,
  mariadb: `
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      quantity INT NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      description VARCHAR(200) NOT NULL DEFAULT '',
      created DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
      last_updated DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
};

const plugin: Plugin = {
  name: NAME,
  version: '0.1.0',
  entities: [{ meta: widget }],
  migrations: [initial],

  // 3) Custom (non-CRUD) endpoints
  routes: [
    {
      method: 'GET',
      path: `/api/plugins/${NAME}/summary/`,
      handler: async ({ db }) => {
        const [{ n }] = await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${TABLE}`);
        return { status: 200, body: { widgets: Number(n) } };
      },
    },
  ],

  // 4) React to writes (fired after a successful API change)
  hooks: [
    {
      table: TABLE,
      event: 'created',
      handler: ({ id }) => console.log(`[${NAME}] widget #${id} created`),
    },
  ],

  // 5) Extend a CORE entity with custom fields (stored in its custom_fields column).
  //    Uncomment and point at a real core table, e.g. "dcim_device".
  // customFields: [
  //   { tables: ['dcim_device'], name: 'asset_owner', type: 'text', default: '' },
  // ],
};

export default plugin;
