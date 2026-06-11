// paasbox-plugin-cloudflare — manage Cloudflare DNS (zone accounts + A/CNAME records)
// through paasbox. A port of SaaShup/netbox-cloudflare-plugin to the paasbox plugin
// contract: it registers two entities (→ NetBox-shaped CRUD), ships dual-dialect DDL,
// adds custom DnsRecord write routes that sync to the Cloudflare API (create/delete),
// and imports a zone's existing records when a ZoneAccount is created.
//
// Config: PB_CLOUDFLARE_BASE_URL (default https://api.cloudflare.com/client/v4).
import type { Plugin } from '../../plugins/types.js';
import { ENTITY_METAS } from './meta.js';
import { INITIAL_MIGRATION } from './migrations.js';
import { recordWriteRoutes } from './routes.js';
import { hooks } from './hooks.js';

const cloudflarePlugin: Plugin = {
  name: 'cloudflare',
  version: '0.1.0',
  entities: ENTITY_METAS.map((meta) => ({ meta })),
  migrations: [INITIAL_MIGRATION],
  routes: recordWriteRoutes, // record create/delete sync to Cloudflare; reads stay generic
  hooks,
};

export default cloudflarePlugin;
