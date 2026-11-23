// Journal entries (extras_journalentry) attached to a Docker host, so TLS CA pinning —
// trust-on-first-use, a re-pin on an endpoint edit, a pin that failed — leaves a trace in
// the UI's Logs instead of only the server console. Also attached to a VM, for its SSH key
// scan. Mirrors the OpenStack plugin's journal.ts.
import type { Db } from '../../db/types.js';
import { Repository } from '../../repository/repository.js';
import { getTable } from '../../model/registry.js';
import { Serializer } from '../../api/serializer.js';
import { broadcast } from '../../realtime.js';
import { META, T } from './meta.js';
import { serializeHost } from './serialize.js';

export type JournalKind = 'info' | 'success' | 'warning' | 'danger';

const VM_OBJECT_TYPE = 'virtualization.virtualmachine';
const VM_TABLE = 'virtualization_virtual_machine';

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
  await write(db, META.host.objectType, hostId, kind, comments);
  await emitHostUpdated(db, hostId);
}

/** Push the VM's current state so an open page showing its journal reloads it. */
async function emitVmUpdated(db: Db, vmId: number): Promise<void> {
  try {
    const meta = getTable(VM_TABLE);
    if (!meta) return;
    const row = await new Repository<Record<string, unknown>>(db, meta).retrieve(vmId);
    if (!row) return;
    const data = await new Serializer(db, process.env.BASE_URL ?? '').object(VM_TABLE, row);
    broadcast({
      type: 'change',
      event: 'updated',
      object_type: meta.objectType,
      table: VM_TABLE,
      id: vmId,
      data,
    });
  } catch {
    /* a missed notification only means the page refreshes later */
  }
}

/** A journal entry on a VM (e.g. its SSH key scan failed); open pages reload it. */
export async function journalVm(
  db: Db,
  vmId: number,
  kind: JournalKind,
  comments: string,
): Promise<void> {
  await write(db, VM_OBJECT_TYPE, vmId, kind, comments);
  await emitVmUpdated(db, vmId);
}
