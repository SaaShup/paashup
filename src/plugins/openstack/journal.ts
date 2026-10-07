// Journal entries (extras_journalentry) attached to a Cloud, so connection tests and
// synchronisations leave a trace in the UI's Logs. Messages never contain credentials.
import type { Db } from '../../db/types.js';
import { META } from './meta.js';

export type JournalKind = 'info' | 'success' | 'warning' | 'danger';

export async function journal(
  db: Db,
  cloudId: number,
  kind: JournalKind,
  comments: string,
): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO extras_journalentry (assigned_object_type, assigned_object_id, kind, comments)
       VALUES (?, ?, ?, ?)`,
      [META.cloud.objectType, cloudId, kind, comments.slice(0, 4000)],
    );
  } catch {
    /* journal table absent → nothing to log to */
  }
}
