// Routes of the OpenStack cloud entity.
//
// Create and update (POST / PUT / PATCH) first test the credentials against Keystone: on
// failure nothing is saved and the error is shown in the form. On success, a background
// sync imports the cloud's regions, VMs, images and SSH keys.
//
// Read-only routes under /clouds/{id}/:
//   region-status/                       result of the last sync per region (from the database)
//   flavors|images|keypairs|volumes|networks|security-groups|limits/?region=<name>
//                                        live read from OpenStack, for the "create VM" form
//
// Create / delete a VM on OpenStack (see servers.ts):
//   POST   /clouds/{id}/servers/         boot a server (202); the VM is imported by a sync
//   GET    /servers/[?virtual_machine_id=]  the OpenStack server behind each VM, managed or not
//   DELETE /servers/{vm_id}/             delete the server of a VM paasbox created
//   GET|PUT /servers/{vm_id}/metadata/   read / edit the metadata of the server behind a VM
import type { Db } from '../../db/types.js';
import type { PluginRoute } from '../../plugins/types.js';
import { Repository } from '../../repository/repository.js';
import { getTable } from '../../model/registry.js';
import { Serializer } from '../../api/serializer.js';
import { broadcast } from '../../realtime.js';
import { dispatchWebhooks } from '../../webhooks.js';
import { ValidationError } from '../../errors.js';
import {
  authenticate,
  computeRegions,
  OpenStackError,
  READS,
  testConnection,
  type CloudConfig,
} from './openstack.js';
import { journal } from './journal.js';
import { isSyncing, purgeCloud, syncCloud } from './sync.js';
import {
  deleteManagedVm,
  launchServer,
  listLinks,
  parseCreate,
  readVmMetadata,
  writeVmMetadata,
} from './servers.js';
import { META, T } from './meta.js';

type Obj = Record<string, unknown>;
const base = (): string => process.env.BASE_URL ?? '';

const CONNECTION_FIELDS = [
  'auth_url',
  'username',
  'password',
  'user_domain_name',
  'project_name',
  'project_domain_name',
] as const;
const REQUIRED = ['name', 'auth_url', 'username', 'password'] as const;

const str = (v: unknown): string => (v == null ? '' : String(v)).trim();

/** Empty domains mean Keystone's "Default" domain. */
function normalise(data: Obj): void {
  for (const f of ['user_domain_name', 'project_domain_name'] as const) {
    if (f in data) data[f] = str(data[f]) || 'Default';
  }
}

function emit(db: Db, event: 'created' | 'updated', id: number, data: Obj): void {
  broadcast({
    type: 'change',
    event,
    object_type: META.cloud.objectType,
    table: T.cloud,
    id,
    data,
  });
  void dispatchWebhooks(db, META.cloud, event, id, data);
}

/** Test the connection; on failure throw the 400 the form displays (nothing is saved). */
async function verify(cfg: CloudConfig): Promise<{ regions: string[]; project: string }> {
  try {
    return await testConnection(cfg);
  } catch (e) {
    const detail = e instanceof OpenStackError ? e.message : 'Unable to reach the OpenStack cloud';
    throw new ValidationError(detail, { detail: `Connection test failed. ${detail}` });
  }
}

const describe = (c: CloudConfig, regions: string[]): string =>
  `project ${c.project_name}, user ${c.username}, region${regions.length === 1 ? '' : 's'} ${regions.join(', ')}`;

const createRoute: PluginRoute = {
  method: 'POST',
  path: META.cloud.endpoint,
  handler: async ({ db, body }) => {
    const data: Obj = { ...((body ?? {}) as Obj) };
    const missing: Record<string, string[]> = {};
    for (const f of REQUIRED) if (!str(data[f])) missing[f] = ['This field is required.'];
    if (Object.keys(missing).length) throw new ValidationError('Missing fields', missing);
    normalise(data);
    data.user_domain_name ??= 'Default';
    data.project_domain_name ??= 'Default';
    data.project_name = str(data.project_name);

    const cfg = data as unknown as CloudConfig;
    const { regions, project } = await verify(cfg);
    if (!data.project_name) data.project_name = project; // the user's default project

    data.state = 'created';
    data.operation = 'none';
    data.error = null;
    const created = await db.transaction((tx) =>
      new Repository<Obj>(tx, getTable(T.cloud)!).create(data),
    );
    const id = Number((created as { id: number }).id);
    await journal(db, id, 'success', `Connection verified (${describe(cfg, regions)}).`);
    const out = await new Serializer(db, base()).object(T.cloud, created);
    emit(db, 'created', id, out);
    void syncCloud(db, id);
    return { status: 201, body: out };
  },
};

const updateRoutes: PluginRoute[] = (['PUT', 'PATCH'] as const).map((method): PluginRoute => ({
  method,
  path: `${META.cloud.endpoint}{id}/`,
  handler: async ({ db, params, body }) => {
    const id = Number(params.id);
    const repo = new Repository<Obj>(db, getTable(T.cloud)!);
    const current = await db.get<Obj>(`SELECT * FROM ${T.cloud} WHERE id = ?`, [id]);
    if (!current) return { status: 404, body: { detail: 'Not found' } };

    const data: Obj = { ...((body ?? {}) as Obj) };
    normalise(data);
    const merged = { ...current, ...data } as Obj;
    const connectionChanged = CONNECTION_FIELDS.some(
      (f) => f in data && str(data[f]) !== str(current[f]),
    );

    if (connectionChanged) {
      const cfg = merged as unknown as CloudConfig;
      try {
        const { regions, project } = await verify(cfg);
        if (!str(merged.project_name)) {
          data.project_name = project; // the user's default project
          cfg.project_name = project;
        }
        await journal(db, id, 'success', `Connection verified (${describe(cfg, regions)}).`);
      } catch (e) {
        await journal(
          db,
          id,
          'danger',
          `Connection test failed, changes not saved: ${(e as Error).message}`,
        );
        throw e;
      }
    }

    await db.transaction((tx) => new Repository<Obj>(tx, getTable(T.cloud)!).update(id, data));
    const out = await new Serializer(db, base()).object(T.cloud, (await repo.retrieve(id))!);
    emit(db, 'updated', id, out);
    if (connectionChanged || data.operation === 'refresh') void syncCloud(db, id);
    return { status: 200, body: out };
  },
}));

const deleteRoute: PluginRoute = {
  method: 'DELETE',
  path: `${META.cloud.endpoint}{id}/`,
  handler: async ({ db, params }) => {
    const id = Number(params.id);
    const existing = await new Repository<Obj>(db, getTable(T.cloud)!).retrieve(id);
    if (!existing) return { status: 404, body: { detail: 'Not found' } };
    if (isSyncing(id)) {
      throw new ValidationError('Synchronization running', {
        detail: 'A synchronization is running for this cloud. Try again in a moment.',
      });
    }
    const prechange = await new Serializer(db, base()).object(T.cloud, existing);
    await purgeCloud(db, id); // its VMs, types and clusters go with it
    broadcast({
      type: 'change',
      event: 'deleted',
      object_type: META.cloud.objectType,
      table: T.cloud,
      id,
    });
    void dispatchWebhooks(db, META.cloud, 'deleted', id, prechange);
    return { status: 204 };
  },
};

// ---- read-only listings -----------------------------------------------------------

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; rows: unknown[] }>();
const page = (results: unknown[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});

const fail = (e: unknown) => ({
  status: 502,
  body: { detail: e instanceof OpenStackError ? e.message : 'OpenStack request failed' },
});

const regionStatusRoute: PluginRoute = {
  method: 'GET',
  path: `${META.cloud.endpoint}{id}/region-status/`,
  handler: async ({ db, params }) => {
    const id = Number(params.id);
    if (!(await db.get(`SELECT id FROM ${T.cloud} WHERE id = ?`, [id]))) {
      return { status: 404, body: { detail: 'Not found' } };
    }
    const rows = await db.query(
      `SELECT r.name, r.cluster_id, c.name AS cluster, r.error, r.last_synced,
              (SELECT COUNT(*) FROM ${T.server} s
                WHERE s.cloud_id = r.cloud_id AND s.region = r.name) AS servers
         FROM ${T.region} r LEFT JOIN virtualization_cluster c ON c.id = r.cluster_id
        WHERE r.cloud_id = ? ORDER BY r.name`,
      [id],
    );
    return { status: 200, body: page(rows) };
  },
};

const readRoutes: PluginRoute[] = Object.keys(READS).map((kind) => ({
  method: 'GET',
  path: `${META.cloud.endpoint}{id}/${kind}/`,
  handler: async ({ db, params, query }) => {
    const id = Number(params.id);
    const cloud = await db.get<CloudConfig>(`SELECT * FROM ${T.cloud} WHERE id = ?`, [id]);
    if (!cloud) return { status: 404, body: { detail: 'Not found' } };
    try {
      const region = query.get('region') || computeRegions(await authenticate(cloud))[0];
      if (!region) throw new OpenStackError('No region with a compute service found');
      const key = `${id}:${kind}:${region}:${cloud.auth_url}:${cloud.project_name}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < TTL_MS) return { status: 200, body: page(hit.rows) };
      const rows = await READS[kind]!(cloud, region);
      cache.set(key, { at: Date.now(), rows });
      return { status: 200, body: page(rows) };
    } catch (e) {
      return fail(e);
    }
  },
}));

const OPENSTACK_API = '/api/plugins/openstack';

const createServerRoute: PluginRoute = {
  method: 'POST',
  path: `${META.cloud.endpoint}{id}/servers/`,
  handler: async ({ db, params, body }) => {
    const cloud = await db.get<CloudConfig & { id: number; name: string }>(
      `SELECT * FROM ${T.cloud} WHERE id = ?`,
      [Number(params.id)],
    );
    if (!cloud) return { status: 404, body: { detail: 'Not found' } };
    const input = parseCreate(body);
    try {
      return { status: 202, body: await launchServer(db, cloud, input) };
    } catch (e) {
      if (e instanceof OpenStackError) return fail(e);
      throw e;
    }
  },
};

const listServersRoute: PluginRoute = {
  method: 'GET',
  path: `${OPENSTACK_API}/servers/`,
  handler: async ({ db, query }) => {
    const vm = query.get('virtual_machine_id');
    return { status: 200, body: page(await listLinks(db, vm ? Number(vm) : undefined)) };
  },
};

const deleteServerRoute: PluginRoute = {
  method: 'DELETE',
  path: `${OPENSTACK_API}/servers/{vm_id}/`,
  handler: async ({ db, params }) => {
    try {
      await deleteManagedVm(db, Number(params.vm_id));
      return { status: 202, body: { detail: 'Deletion requested on OpenStack.' } };
    } catch (e) {
      if (e instanceof OpenStackError) return fail(e);
      throw e;
    }
  },
};

const getMetadataRoute: PluginRoute = {
  method: 'GET',
  path: `${OPENSTACK_API}/servers/{vm_id}/metadata/`,
  handler: async ({ db, params }) => {
    try {
      return { status: 200, body: await readVmMetadata(db, Number(params.vm_id)) };
    } catch (e) {
      if (e instanceof OpenStackError) return fail(e);
      throw e;
    }
  },
};

const putMetadataRoute: PluginRoute = {
  method: 'PUT',
  path: `${OPENSTACK_API}/servers/{vm_id}/metadata/`,
  handler: async ({ db, params, body }) => {
    try {
      const wanted = ((body ?? {}) as { metadata?: unknown }).metadata;
      return { status: 200, body: await writeVmMetadata(db, Number(params.vm_id), wanted) };
    } catch (e) {
      if (e instanceof OpenStackError) return fail(e);
      throw e;
    }
  },
};

export const cloudRoutes: PluginRoute[] = [
  getMetadataRoute,
  putMetadataRoute,
  createServerRoute,
  listServersRoute,
  deleteServerRoute,
  createRoute,
  ...updateRoutes,
  deleteRoute,
  regionStatusRoute,
  ...readRoutes,
];
