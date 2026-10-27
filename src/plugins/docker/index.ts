// paashup-plugin-docker — manage Docker (hosts, registries, images, volumes,
// networks, containers) through paashup. A port of SaaShup/netbox-docker-plugin to
// the paashup plugin contract: it registers the six top-level entities (→ NetBox-shaped
// CRUD), ships dual-dialect DDL, overrides GET to embed the source's nested arrays,
// adds custom container write routes (inline nested children + cross-host validation),
// custom image write routes (cross-host validation),
// the Docker-agent proxy actions and the VM SSH keys (authorized_keys through the agent),
// and seeds a default registry on host creation.
import type { Plugin } from '../../plugins/types.js';
import { ENTITY_METAS, META, T } from './meta.js';
import {
  INITIAL_MIGRATION,
  HOST_SCOPE_MIGRATION,
  HOST_TOKEN_MIGRATION,
  VM_SSH_KEY_MIGRATION,
} from './migrations.js';
import { readRoutes } from './routes/crud.js';
import { containerWriteRoutes } from './routes/containers.js';
import { imageWriteRoutes } from './routes/images.js';
import { hostWriteRoutes } from './routes/hosts.js';
import { actionRoutes } from './routes/actions.js';
import { terminalWebSockets } from './routes/terminal.js';
import { serializeCatalogKey, sshKeyRoutes } from './sshkeys.js';
import { hooks } from './hooks.js';
import { DOCKER_WEBHOOKS } from './webhooks.js';
import {
  serializeContainer,
  serializeHost,
  serializeImage,
  serializeNetwork,
  serializeRegistry,
  serializeVolume,
} from './serialize.js';
import { registerSerializer } from '../../api/serializer.js';

// Use the nested serializers for the generic CRUD response + change/webhook payloads too,
// so EVERY write (create / single update / bulk update) emits the full entity — matching
// GET and NetBox — not just the routes the plugin overrides explicitly.
registerSerializer(T.host, serializeHost);
registerSerializer(T.image, serializeImage);
registerSerializer(T.volume, serializeVolume);
registerSerializer(T.network, serializeNetwork);
registerSerializer(T.registry, serializeRegistry);
registerSerializer(T.container, serializeContainer);
// SSH keys of the catalog: where each comes from (paashup, a cloud, an agent) and on how many VMs
registerSerializer('virtualization_ssh_key', serializeCatalogKey);

const dockerPlugin: Plugin = {
  name: 'docker',
  version: '0.1.0',
  entities: ENTITY_METAS.map((meta) => ({ meta })),
  migrations: [INITIAL_MIGRATION, HOST_SCOPE_MIGRATION, HOST_TOKEN_MIGRATION, VM_SSH_KEY_MIGRATION],
  routes: [
    // GET list/detail overrides that embed the source's nested arrays.
    ...readRoutes(T.host, META.host.endpoint, serializeHost),
    ...readRoutes(T.image, META.image.endpoint, serializeImage),
    ...readRoutes(T.volume, META.volume.endpoint, serializeVolume),
    ...readRoutes(T.network, META.network.endpoint, serializeNetwork),
    ...readRoutes(T.registry, META.registry.endpoint, serializeRegistry),
    ...readRoutes(T.container, META.container.endpoint, serializeContainer),
    // Host PUT/PATCH override: a refresh marks the host "refreshing" and purges its
    // discovered resources before storing (create + delete stay on generic CRUD).
    ...hostWriteRoutes,
    ...imageWriteRoutes,
    // Container writes accept inline nested children (override generic POST/PUT/PATCH).
    ...containerWriteRoutes,
    // Docker-agent proxy actions (force_pull / logs / exec).
    ...actionRoutes,
    // VM SSH keys: added/removed through the agent, the stored copy re-read after.
    ...sshKeyRoutes,
  ],
  // Interactive container terminal: browser ⇄ paashup ⇄ agent exec stream.
  websockets: terminalWebSockets,
  hooks,
  // Default agent-integration webhooks, created at startup if missing.
  seedWebhooks: DOCKER_WEBHOOKS,
};

export default dockerPlugin;
