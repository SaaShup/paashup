// Write hooks. Mirrors the source `post_save` signal that seeds a default "dockerhub"
// registry whenever a host is created. Hooks fire after a successful generic-CRUD
// write — which is why host create is left on the generic path (see routes/crud.ts).
import type { Hook } from '../../plugins/types.js';
import { T } from './meta.js';
import { deleteHost } from './routes/hosts.js';

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
];
