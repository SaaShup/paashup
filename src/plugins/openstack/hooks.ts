// Write hooks. Creating a Cloud connects to it and imports its flavors, servers and
// IPs; PATCHing `operation: "refresh"` does the same again on demand. The work runs in
// the background so the API call returns immediately — the outcome lands on the cloud's
// `state` / `error` and is pushed to the realtime feed.
import type { Hook } from '../../plugins/types.js';
import { T } from './meta.js';
import { linkDockerHosts, syncCloud } from './sync.js';

// A Docker host registered (or re-pointed) after its VM was imported gets linked right away.
const linkHost = ({ db, id }: { db: Parameters<typeof linkDockerHosts>[0]; id: number | string }) =>
  linkDockerHosts(db, Number(id));

export const hooks: Hook[] = [
  { table: 'plugin_docker_host', event: 'created', handler: linkHost },
  { table: 'plugin_docker_host', event: 'updated', handler: linkHost },
  {
    table: T.cloud,
    event: 'created',
    handler: ({ db, id }) => {
      void syncCloud(db, Number(id));
    },
  },
  {
    table: T.cloud,
    event: 'updated',
    handler: async ({ db, id }) => {
      const cloud = await db.get<{ operation: string }>(
        `SELECT operation FROM ${T.cloud} WHERE id = ?`,
        [Number(id)],
      );
      if (cloud?.operation === 'refresh') void syncCloud(db, Number(id));
    },
  },
];
