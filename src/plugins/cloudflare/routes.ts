// DnsRecord write routes — each syncs to the Cloudflare API:
//   - create: append the zone suffix to the name, reject an opposite-`proxied`
//     conflict, create the record on Cloudflare (storing its id), then persist locally;
//   - update (PATCH/PUT): merge the change over the current record, overwrite it on
//     Cloudflare (PUT /dns_records/{id}), then persist locally;
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
import { createDnsRecord, updateDnsRecord, deleteDnsRecord } from './cloudflare.js';

type Obj = Record<string, unknown>;
const base = (): string => process.env.BASE_URL ?? '';

/** Broadcast to the realtime feed AND fire webhooks, like generic CRUD does. */
function emit(db: Db, event: 'created' | 'updated' | 'deleted', id: number, data?: Obj): void {
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
  // Update (PATCH/PUT): merge the change over the current record, sync to Cloudflare,
  // then persist locally. Without this, edits would only touch the local DB.
  ...(['PATCH', 'PUT'] as const).map((method): PluginRoute => ({
    method,
    path: `${META.dnsRecord.endpoint}{id}/`,
    handler: async ({ db, params, body }) => {
      const id = Number(params.id);
      const cur = await db.get<{
        record_id: string | null;
        name: string;
        type: string;
        content: string;
        ttl: number;
        proxied: number;
        zone_pk: number;
        zone_name: string;
        cf_zone_id: string;
        token: string;
      }>(
        `SELECT r.record_id AS record_id, r.name AS name, r.type AS type, r.content AS content,
                  r.ttl AS ttl, r.proxied AS proxied, r.zone_id AS zone_pk,
                  z.zone_name AS zone_name, z.zone_id AS cf_zone_id, z.token AS token
             FROM plugin_cloudflare_dnsrecord r
             JOIN plugin_cloudflare_zoneaccount z ON z.id = r.zone_id
            WHERE r.id = ?`,
        [id],
      );
      if (!cur) return { status: 404, body: { detail: 'Not found' } };

      const b = (body ?? {}) as Obj;
      let name = cur.name;
      if (b.name !== undefined) {
        name = String(b.name);
        if (!name.endsWith(`.${cur.zone_name}`)) name = `${name}.${cur.zone_name}`;
      }
      const type = b.type !== undefined ? String(b.type) : cur.type;
      const content = b.content !== undefined ? String(b.content) : cur.content;
      const ttl = b.ttl !== undefined ? Number(b.ttl) : Number(cur.ttl);
      const proxied = b.proxied !== undefined ? !!b.proxied : !!cur.proxied;

      const conflict = await db.get<{ id: number }>(
        `SELECT id FROM plugin_cloudflare_dnsrecord
            WHERE zone_id = ? AND name = ? AND type = ? AND proxied = ? AND id != ?`,
        [cur.zone_pk, name, type, proxied ? 0 : 1, id],
      );
      if (conflict) {
        throw new ValidationError('conflict', {
          proxied: ['A record with this name and type but the opposite "proxied" setting exists.'],
        });
      }

      if (cur.record_id) {
        try {
          await updateDnsRecord({ zone_id: cur.cf_zone_id, token: cur.token }, cur.record_id, {
            name,
            type,
            content,
            ttl,
            proxied,
          });
        } catch {
          throw new ApiError(502, 'Unable to update DNS Record on Cloudflare');
        }
      }

      const updated = await new Repository<Obj>(db, getTable(T.dnsRecord)!).update(id, {
        name,
        type,
        content,
        ttl,
        proxied,
      });
      const out = await new Serializer(db, base()).object(T.dnsRecord, updated as Obj);
      emit(db, 'updated', id, out);
      return { status: 200, body: out };
    },
  })),
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
