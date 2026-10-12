// Realtime notifications for the VMs the OpenStack plugin creates, updates and removes
// outside the generic API (which broadcasts its own writes), so open pages follow them.
import type { Db } from '../../db/types.js';
import { Repository } from '../../repository/repository.js';
import { getTable } from '../../model/registry.js';
import { Serializer } from '../../api/serializer.js';
import { broadcast } from '../../realtime.js';

const VM_TABLE = 'virtualization_virtual_machine';

/** Push a VM's current state (or its removal) to the connected clients. Never throws. */
export async function emitVm(
  db: Db,
  vmId: number,
  event: 'created' | 'updated' | 'deleted',
): Promise<void> {
  try {
    const meta = getTable(VM_TABLE);
    if (!meta) return;
    const base = {
      type: 'change' as const,
      object_type: meta.objectType,
      table: VM_TABLE,
      id: vmId,
    };
    if (event === 'deleted') {
      broadcast({ ...base, event });
      return;
    }
    const row = await new Repository<Record<string, unknown>>(db, meta).retrieve(vmId);
    if (!row) return;
    const data = await new Serializer(db, process.env.BASE_URL ?? '').object(VM_TABLE, row);
    broadcast({ ...base, event, data });
  } catch {
    /* a missed notification only means a page refreshes later */
  }
}
