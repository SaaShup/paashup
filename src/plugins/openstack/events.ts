// Realtime notifications for the rows the OpenStack plugin creates, updates and removes
// outside the generic API (which broadcasts its own writes), so open pages follow them.
import type { Db } from '../../db/types.js';
import { Repository } from '../../repository/repository.js';
import { getTable } from '../../model/registry.js';
import { Serializer } from '../../api/serializer.js';
import { broadcast } from '../../realtime.js';

const VM_TABLE = 'virtualization_virtual_machine';
const DISK_TABLE = 'virtualization_virtual_disk';

/**
 * Push a row's current state (or its removal) to the connected clients. Never throws.
 * `extra` is merged onto the serialized object for transient, unpersisted hints (e.g. a
 * reboot in progress) that a page can show without them ever living in the database.
 */
async function emit(
  db: Db,
  table: string,
  id: number,
  event: 'created' | 'updated' | 'deleted',
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    const meta = getTable(table);
    if (!meta) return;
    const base = { type: 'change' as const, object_type: meta.objectType, table, id };
    if (event === 'deleted') {
      broadcast({ ...base, event });
      return;
    }
    const row = await new Repository<Record<string, unknown>>(db, meta).retrieve(id);
    if (!row) return;
    const data = await new Serializer(db, process.env.BASE_URL ?? '').object(table, row);
    broadcast({ ...base, event, data: extra ? { ...data, ...extra } : data });
  } catch {
    /* a missed notification only means a page refreshes later */
  }
}

export const emitVm = (
  db: Db,
  vmId: number,
  event: 'created' | 'updated' | 'deleted',
  extra?: Record<string, unknown>,
): Promise<void> => emit(db, VM_TABLE, vmId, event, extra);

/** Push a Volume's current state right after it is created/changed outside the generic API
 *  (created, attached, detached, or a background reconciliation correcting it) — open Volumes
 *  pages follow it without a manual refresh or a cloud resync. */
export const emitVolumeDisk = (
  db: Db,
  diskId: number,
  event: 'created' | 'updated' = 'updated',
): Promise<void> => emit(db, DISK_TABLE, diskId, event);
