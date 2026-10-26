// Write hooks. Mirrors the source `post_save` signal that seeds a default "dockerhub"
// registry whenever a host is created. Hooks fire after a successful generic-CRUD
// write — which is why host create is left on the generic path (see routes/crud.ts).
import type { Hook } from '../../plugins/types.js';
import { T } from './meta.js';
import { deleteHost } from './routes/hosts.js';
import { pruneAgentKeys, relinkCatalogKey, scanCloud } from './sshkeys.js';

export const hooks: Hook[] = [
  // a host lives on a machine: when its VM is deleted, the host goes with it
  {
    table: 'virtualization_virtual_machine',
    event: 'deleting',
    handler: async ({ db, id }) => {
      const hosts = await db.query<{ id: number }>(
        `SELECT id FROM ${T.host} WHERE virtual_machine_id = ?`,
        [id],
      );
      for (const h of hosts) await deleteHost(db, Number(h.id));
    },
  },
  {
    table: T.host,
    event: 'created',
    handler: async ({ db, id }) => {
      await db.execute(
        `INSERT INTO ${T.registry} (host_id, name, serveraddress) VALUES (?, ?, ?)`,
        [id, 'dockerhub', 'https://registry.hub.docker.com/v2/'],
      );
    },
  },
  // a VM deleted (its SSH keys with it): drop the agent keys no VM has any more
  {
    table: 'virtualization_virtual_machine',
    event: 'deleted',
    handler: ({ db }) => pruneAgentKeys(db),
  },
  // an OpenStack cloud synced: read the SSH keys of its VMs, in the background
  {
    table: 'plugin_openstack_cloud',
    event: 'synced',
    handler: ({ db, id }) => void scanCloud(db, Number(id)),
  },
  // a catalog key saved: the host keys with its fingerprint now point to it
  ...(['created', 'updated'] as const).map((event): Hook => ({
    table: 'virtualization_ssh_key',
    event,
    handler: ({ db, id }) => relinkCatalogKey(db, Number(id)),
  })),
];
