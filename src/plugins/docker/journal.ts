// Journal entries (extras_journalentry) attached to a Docker host, so TLS CA pinning —
// trust-on-first-use, a re-pin on an endpoint edit, a pin that failed — leaves a trace in
// the UI's Logs instead of only the server console. Mirrors the OpenStack plugin's journal.ts.
import type { Db } from '../../db/types.js';
import { Repository } from '../../repository/repository.js';
import { getTable } from '../../model/registry.js';
import { broadcast } from '../../realtime.js';
import { META, T } from './meta.js';
import { serializeHost } from './serialize.js';

export type JournalKind = 'info' | 'success' | 'warning' | 'danger';

async function write(db: Db, hostId: number, kind: JournalKind, comments: string): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO extras_journalentry (assigned_object_type, assigned_object_id, kind, comments)
       VALUES (?, ?, ?, ?)`,
      [META.host.objectType, hostId, kind, comments.slice(0, 4000)],
    );
  } catch {
    /* journal table absent → nothing to log to */
  }
}

/** Push the host's current state so an open page showing its journal reloads it. */
async function emitHostUpdated(db: Db, hostId: number): Promise<void> {
  try {
    const row = await new Repository<Record<string, unknown>>(db, getTable(T.host)!).retrieve(
      hostId,
    );
    if (!row) return;
    const data = await serializeHost(db, row);
    broadcast({
      type: 'change',
      event: 'updated',
      object_type: META.host.objectType,
      table: T.host,
      id: hostId,
      data,
    });
  } catch {
    /* a missed notification only means the page refreshes later */
  }
}

/** A journal entry on a Docker host; open pages showing it are told so they reload its journal. */
export async function journalHost(
  db: Db,
  hostId: number,
  kind: JournalKind,
  comments: string,
): Promise<void> {
  await write(db, hostId, kind, comments);
  await emitHostUpdated(db, hostId);
}
