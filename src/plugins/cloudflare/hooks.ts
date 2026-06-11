// Write hooks. Mirrors the source `post_save` signal on ZoneAccount: when an account
// is created, page through its existing Cloudflare A/CNAME records and import them as
// DnsRecords. Best-effort — if Cloudflare is unreachable, the account is still created.
import type { Hook } from '../../plugins/types.js';
import { T } from './meta.js';
import { listDnsRecords } from './cloudflare.js';

export const hooks: Hook[] = [
  {
    table: T.zoneAccount,
    event: 'created',
    handler: async ({ db, id }) => {
      const acct = await db.get<{ zone_id: string; token: string }>(
        'SELECT zone_id, token FROM plugin_cloudflare_zoneaccount WHERE id = ?',
        [id as number],
      );
      if (!acct) return;
      try {
        for (let page = 1; ; page++) {
          const { records, totalPages } = await listDnsRecords({
            zone_id: acct.zone_id,
            token: acct.token,
          });
          for (const r of records) {
            await db.execute(
              `INSERT INTO ${T.dnsRecord} (zone_id, record_id, name, type, content, ttl, proxied)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [id as number, r.record_id, r.name, r.type, r.content, r.ttl, r.proxied ? 1 : 0],
            );
          }
          if (page >= totalPages) break;
        }
      } catch {
        /* Cloudflare unreachable / bad token — leave the account without imported records */
      }
    },
  },
];
