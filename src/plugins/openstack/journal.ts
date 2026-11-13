// Journal entries (extras_journalentry) attached to a Cloud, so connection tests and
// synchronisations leave a trace in the UI's Logs — to a VM, for what was done to it through
// paashup — and to a Volume, for what happened to the Cinder volume it mirrors (attach,
// detach, resize, a shrink refused and reverted…). Messages never contain credentials.
import type { Db } from '../../db/types.js';
import { emitVm, emitVolumeDisk } from './events.js';
import { META } from './meta.js';

export type JournalKind = 'info' | 'success' | 'warning' | 'danger';

const VM_OBJECT_TYPE = 'virtualization.virtualmachine';
const DISK_OBJECT_TYPE = 'virtualization.virtualdisk';

async function write(
  db: Db,
  objectType: string,
  objectId: number,
  kind: JournalKind,
  comments: string,
): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO extras_journalentry (assigned_object_type, assigned_object_id, kind, comments)
       VALUES (?, ?, ?, ?)`,
      [objectType, objectId, kind, comments.slice(0, 4000)],
    );
  } catch {
    /* journal table absent → nothing to log to */
  }
}

export const journal = (db: Db, cloudId: number, kind: JournalKind, comments: string) =>
  write(db, META.cloud.objectType, cloudId, kind, comments);

/** A journal entry on a VM; open pages showing the VM are told so they reload its journal. */
export async function journalVm(
  db: Db,
  vmId: number,
  kind: JournalKind,
  comments: string,
): Promise<void> {
  await write(db, VM_OBJECT_TYPE, vmId, kind, comments);
  await emitVm(db, vmId, 'updated');
}

/** A journal entry on a Volume; open pages showing it are told so they reload its journal. */
export async function journalDisk(
  db: Db,
  diskId: number,
  kind: JournalKind,
  comments: string,
): Promise<void> {
  await write(db, DISK_OBJECT_TYPE, diskId, kind, comments);
  await emitVolumeDisk(db, diskId);
}
