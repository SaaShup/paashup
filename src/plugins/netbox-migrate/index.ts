// paasbox-plugin-netbox-migrate — one-shot migration of core objects from a NetBox
// instance into paasbox over the REST API. Because paasbox is NetBox-API-compatible,
// each entity is read from the same endpoint on NetBox and written locally, with
// dependency ordering + id remapping handled by the engine (see migrate.ts).
//
// It contributes no entities/tables — just the /api/plugins/netbox-migrate/ routes.
import type { Plugin } from '../../plugins/types.js';
import { routes } from './routes.js';
import { UI_PREFIX, UI_DIR } from './ui.js';

const netboxMigratePlugin: Plugin = {
  name: 'netbox-migrate',
  version: '0.1.0',
  routes,
  assets: [{ urlPrefix: UI_PREFIX, dir: UI_DIR }], // serves the migration UI page
};

export default netboxMigratePlugin;
