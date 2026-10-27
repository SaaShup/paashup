// paashup-plugin-openstack — connect paashup to an OpenStack cloud. A Cloud entity holds
// the Keystone credentials + region; creating it (or PATCHing operation=refresh) imports
// the cloud's flavors, servers and IPs into the core virtualization / IPAM tables.
// Saving tests the connection first (a failure is shown in the form); read routes expose flavors, volumes, networks, security groups and quotas for pickers.
//
import type { Plugin } from '../../plugins/types.js';
import { ENTITY_METAS } from './meta.js';
import {
  DROP_MANAGED_MIGRATION,
  INITIAL_MIGRATION,
  METADATA_MIGRATION,
  REGIONS_MIGRATION,
} from './migrations.js';
import { cloudRoutes } from './routes.js';
import { hooks } from './hooks.js';

const openstackPlugin: Plugin = {
  name: 'openstack',
  version: '0.1.0',
  entities: ENTITY_METAS.map((meta) => ({ meta })),
  migrations: [INITIAL_MIGRATION, REGIONS_MIGRATION, METADATA_MIGRATION, DROP_MANAGED_MIGRATION],
  routes: cloudRoutes,
  hooks,
};

export default openstackPlugin;
