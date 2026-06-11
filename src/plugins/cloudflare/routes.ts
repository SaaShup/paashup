// DnsRecord write routes. Mirrors the source's pre_save/pre_delete signals:
//   - create: append the zone suffix to the name, reject an opposite-`proxied`
//     conflict, create the record on Cloudflare (storing its id), then persist locally;
//   - delete: delete the record on Cloudflare, then locally.
// Reads (GET list/detail) stay on the generic CRUD path. The ZoneAccount entity is
// fully generic; its post-create import lives in hooks.ts.
import type { Db } from '../../db/types.js';
import type { PluginRoute } from '../../plugins/types.js';
import { Repository } from '../../repository/repository.js';
import { getTable } from '../../model/registry.js';
import { Serializer } from '../../api/serializer.js';
import { broadcast } from '../../realtime.js';
import { dispatchWebhooks } from '../../webhooks.js';
import { ApiError, ValidationError } from '../../errors.js';
import { META, T } from './meta.js';
import { createDnsRecord, deleteDnsRecord } from './cloudflare.js';

type Obj = Record<string, unknown>;
const base = (): string => process.env.BASE_URL ?? '';

/** Broadcast to the realtime feed AND fire webhooks, like generic CRUD does. */
function emit(db: Db, event: 'created' | 'deleted', id: number, data?: Obj): void {
  broadcast({
    type: 'change',
    event,
    object_type: META.dnsRecord.objectType,
    table: T.dnsRecord,
    id,
    data,
  });
  void dispatchWebhooks(db, META.dnsRecord, event, id, data);
}

export const recordWriteRoutes: PluginRoute[] = [
  {
    method: 'POST',
    path: META.dnsRecord.endpoint,
    handler: async ({ db, body }) => {
      const b = (body ?? {}) as Obj;
      const account = await db.get<{
        id: number;
        zone_name: string;
        zone_id: string;
        token: string;
      }>('SELECT id, zone_name, zone_id, token FROM plugin_cloudflare_zoneaccount WHERE id = ?', [
        Number(b.zone),
      ]);
      if (!account)
        throw new ValidationError('Invalid zone', { zone: ['Zone account does not exist.'] });
      if (!b.name)
        throw new ValidationError('name required', { name: ['This field is required.'] });
      if (!b.content)
        throw new ValidationError('content required', { content: ['This field is required.'] });

      const type = String(b.type ?? 'CNAME');
      const proxied = !!b.proxied;
      const ttl = b.ttl === undefined ? 3600 : Number(b.ttl);
      let name = String(b.name);
      if (!name.endsWith(`.${account.zone_name}`)) name = `${name}.${account.zone_name}`;

      // A name/type can be proxied OR not, not both (mirrors the source's unique constraint).
      const conflict = await db.get<{ id: number }>(
        'SELECT id FROM plugin_cloudflare_dnsrecord WHERE zone_id = ? AND name = ? AND type = ? AND proxied = ?',
        [account.id, name, type, proxied ? 0 : 1],
      );
      if (conflict) {
        throw new ValidationError('conflict', {
          proxied: ['A record with this name and type but the opposite "proxied" setting exists.'],
        });
      }

      let recordId: string;
      try {
        recordId = await createDnsRecord(
          { zone_id: account.zone_id, token: account.token },
          { name, type, content: String(b.content), ttl, proxied },
        );
      } catch {
        throw new ApiError(502, 'Unable to create DNS Record on Cloudflare');
      }

      const created = await db.transaction((tx) =>
        new Repository<Obj>(tx, getTable(T.dnsRecord)!).create({
          zone: account.id,
          record_id: recordId,
          name,
          type,
          content: b.content,
          ttl,
          proxied,
        }),
      );
      const out = await new Serializer(db, base()).object(T.dnsRecord, created);
      emit(db, 'created', Number((created as { id: number }).id), out);
      return { status: 201, body: out };
    },
  },
  {
    method: 'DELETE',
    path: `${META.dnsRecord.endpoint}{id}/`,
    handler: async ({ db, params }) => {
      const id = Number(params.id);
      const row = await db.get<{ record_id: string | null; zone_id: string; token: string }>(
        `SELECT r.record_id AS record_id, z.zone_id AS zone_id, z.token AS token
           FROM plugin_cloudflare_dnsrecord r
           JOIN plugin_cloudflare_zoneaccount z ON z.id = r.zone_id
          WHERE r.id = ?`,
        [id],
      );
      if (!row) return { status: 404, body: { detail: 'Not found' } };
      if (row.record_id) {
        try {
          await deleteDnsRecord({ zone_id: row.zone_id, token: row.token }, row.record_id);
        } catch {
          throw new ApiError(502, 'Unable to delete DNS Record on Cloudflare');
        }
      }
      await new Repository<Obj>(db, getTable(T.dnsRecord)!).destroy(id);
      emit(db, 'deleted', id);
      return { status: 204 };
    },
  },
];
