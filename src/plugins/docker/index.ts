// paasbox-plugin-docker — manage Docker (hosts, registries, images, volumes,
// networks, containers) through paasbox. A port of SaaShup/netbox-docker-plugin to
// the paasbox plugin contract: it registers the six top-level entities (→ NetBox-shaped
// CRUD), ships dual-dialect DDL, overrides GET to embed the source's nested arrays,
// adds custom container write routes (inline nested children + cross-host validation)
// and the Docker-agent proxy actions, and seeds a default registry on host creation.
import type { Plugin } from '../../plugins/types.js';
import { ENTITY_METAS, META, T } from './meta.js';
import { INITIAL_MIGRATION } from './migrations.js';
import { readRoutes } from './routes/crud.js';
import { containerWriteRoutes } from './routes/containers.js';
import { actionRoutes } from './routes/actions.js';
import { hooks } from './hooks.js';
import {
  serializeContainer,
  serializeHost,
  serializeImage,
  serializeNetwork,
  serializeRegistry,
  serializeVolume,
} from './serialize.js';

const dockerPlugin: Plugin = {
  name: 'docker',
  version: '0.1.0',
  entities: ENTITY_METAS.map((meta) => ({ meta })),
  migrations: [INITIAL_MIGRATION],
  routes: [
    // GET list/detail overrides that embed the source's nested arrays.
    ...readRoutes(T.host, META.host.endpoint, serializeHost),
    ...readRoutes(T.image, META.image.endpoint, serializeImage),
    ...readRoutes(T.volume, META.volume.endpoint, serializeVolume),
    ...readRoutes(T.network, META.network.endpoint, serializeNetwork),
    ...readRoutes(T.registry, META.registry.endpoint, serializeRegistry),
    ...readRoutes(T.container, META.container.endpoint, serializeContainer),
    // Container writes accept inline nested children (override generic POST/PUT/PATCH).
    ...containerWriteRoutes,
    // Docker-agent proxy actions (force_pull / logs / exec).
    ...actionRoutes,
  ],
  hooks,
};

export default dockerPlugin;
