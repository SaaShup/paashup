// General Cinder volume management for a cloud: create (blank, optionally type-picked, and
// optionally attached to a VM right away), attach an existing unattached volume to a VM,
// detach one (kept by default — OpenStack never deletes a volume just because it is
// detached — or deleted if asked), and delete an unattached one outright.
//
// Independent of the single-slot "data volume" convenience flow in servers.ts (create a VM
// with one data disk, then resize/detach it): that one tracks its volume on
// `plugin_openstack_server.data_volume_id`; this one operates on any Cinder volume by id and,
// once attached, mirrors it as a virtual disk the same way the sync does (`upsertVolumeDisk`),
// so both flows show up the same way once a volume is attached to a VM.
import type { Db } from '../../db/types.js';
import { ApiError, ValidationError } from '../../errors.js';
import {
  attachVolume,
  authenticate,
  computeRegions,
  createVolume,
  deleteVolume,
  detachVolume,
  getVolumeState,
  listVolumes,
  resizeVolume,
  type CloudConfig,
} from './openstack.js';
import { journal, journalDisk, journalVm } from './journal.js';
import { emitVolumeDisk } from './events.js';
import { T } from './meta.js';
import { detachVolumeDisk, removeVolumeDisk, upsertVolumeDisk } from './sync.js';

interface CloudRow extends CloudConfig {
  id: number;
  name: string;
}

const POLL_MS = Number(process.env.PB_OPENSTACK_POLL_MS) || 5000;
const POLL_LIMIT_MS = 10 * 60_000;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const fieldError = (field: string, msg: string): ValidationError =>
  new ValidationError('Invalid request', { [field]: [msg] });

const MIN_GB = 1;
const MAX_GB = 2000;

export interface CreateVolumeInput {
  region: string;
  name: string;
  sizeGb: number;
  volumeType?: string;
  /** attach it to this VM once it is available */
  virtualMachineId?: number;
}

/** Validate a create-volume request; throws the field-level 400 the form displays. */
export function parseCreateVolume(body: unknown): CreateVolumeInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const errors: Record<string, string[]> = {};
  const str = (v: unknown): string => (v == null ? '' : String(v)).trim();

  const region = str(b.region);
  if (!region) errors.region = ['This field is required.'];
  const name = str(b.name);
  if (!name) errors.name = ['This field is required.'];
  else if (name.length > 64) errors.name = ['Ensure this value has at most 64 characters.'];

  const sizeGb = Number(b.size_gb);
  if (!Number.isInteger(sizeGb) || sizeGb < MIN_GB || sizeGb > MAX_GB) {
    errors.size_gb = [`Must be a whole number of GB between ${MIN_GB} and ${MAX_GB}.`];
  }
  const volumeType = str(b.volume_type) || undefined;

  let virtualMachineId: number | undefined;
  if (b.virtual_machine_id != null && b.virtual_machine_id !== '') {
    const n = Number(b.virtual_machine_id);
    if (!Number.isInteger(n) || n <= 0) errors.virtual_machine_id = ['Invalid VM.'];
    else virtualMachineId = n;
  }

  if (Object.keys(errors).length) throw new ValidationError('Invalid request', errors);
  return { region, name, sizeGb: Number(b.size_gb), volumeType, virtualMachineId };
}

/** The server id and name of a VM of this cloud, or the field-level 400. */
async function serverOf(
  db: Db,
  cloud: CloudRow,
  region: string,
  vmId: number,
): Promise<{ serverId: string; name: string }> {
  const row = await db.get<{ server_id: string; region: string; name: string }>(
    `SELECT s.server_id, s.region, v.name
       FROM ${T.server} s JOIN virtualization_virtual_machine v ON v.id = s.virtual_machine_id
      WHERE s.cloud_id = ? AND s.virtual_machine_id = ?`,
    [cloud.id, vmId],
  );
  if (!row) throw fieldError('virtual_machine_id', 'This VM is not a server of this cloud.');
  if (row.region !== region) {
    throw fieldError('virtual_machine_id', `This VM is in region ${row.region}, not ${region}.`);
  }
  return { serverId: row.server_id, name: row.name };
}

/**
 * Create a Cinder volume. The Cinder call itself (and, with a VM chosen, the mirrored disk
 * row) are done before this resolves, so it's visible right away — no need to wait for a
 * cloud resync. Attaching it (when a VM was chosen) still finishes in the background: Cinder
 * only accepts an attach once the volume leaves "creating".
 */
export async function createCloudVolume(
  db: Db,
  cloud: CloudRow,
  input: CreateVolumeInput,
): Promise<{ diskId: number }> {
  const session = await authenticate(cloud);
  if (!computeRegions(session).includes(input.region)) {
    throw fieldError('region', `Region "${input.region}" has no compute service.`);
  }
  const target =
    input.virtualMachineId != null
      ? await serverOf(db, cloud, input.region, input.virtualMachineId)
      : null;

  const volumeId = await createVolume(cloud, input.region, {
    name: input.name,
    sizeGb: input.sizeGb,
    volumeType: input.volumeType,
  });
  await journal(
    db,
    cloud.id,
    'success',
    `Volume "${input.name}" (${input.sizeGb} GB) created in ${input.region}.`,
  );
  const diskId = await upsertVolumeDisk(db, cloud, input.region, input.virtualMachineId ?? null, {
    id: volumeId,
    name: input.name,
    size: input.sizeGb,
  });
  await emitVolumeDisk(db, diskId, 'created');
  await journalDisk(
    db,
    diskId,
    'success',
    `Created (${input.sizeGb} GB, OpenStack volume ${volumeId}) in ${input.region}.`,
  );

  if (target) {
    void finishAttach(db, cloud, input.region, target.serverId, input.virtualMachineId!, diskId, {
      id: volumeId,
      name: input.name,
      size: input.sizeGb,
    });
  }
  return { diskId };
}

/** Wait for a just-created volume to leave "creating", then attach it (background). */
async function finishAttach(
  db: Db,
  cloud: CloudRow,
  region: string,
  serverId: string,
  vmId: number,
  diskId: number,
  v: { id: string; name: string; size: number },
): Promise<void> {
  try {
    let status = await getVolumeState(cloud, region, v.id);
    for (let waited = 0; status === 'creating' && waited < POLL_LIMIT_MS; waited += POLL_MS) {
      await sleep(POLL_MS);
      status = await getVolumeState(cloud, region, v.id);
    }
    if (status !== 'available') {
      throw new Error(`volume ${v.id} ended up "${status ?? 'gone'}" instead of "available"`);
    }
    await mirrorAttach(db, cloud, region, serverId, vmId, diskId, v);
  } catch (e) {
    await detachVolumeDisk(db, cloud.id, v.id); // the optimistic VM assignment didn't happen
    const msg = `Volume "${v.name}" in ${region}: ${messageOf(e)}`;
    await journalVm(db, vmId, 'danger', msg);
    await journal(db, cloud.id, 'danger', msg);
    await journalDisk(db, diskId, 'danger', msg); // also broadcasts the reverted state
  }
}

/** Attach it for real on the cloud; reverts the mirrored disk back to unattached on failure. */
async function mirrorAttach(
  db: Db,
  cloud: CloudRow,
  region: string,
  serverId: string,
  vmId: number,
  diskId: number,
  v: { id: string; name: string; size: number },
): Promise<void> {
  try {
    const { device } = await attachVolume(cloud, region, serverId, v.id);
    await upsertVolumeDisk(db, cloud, region, vmId, v, device);
    await journalVm(
      db,
      vmId,
      'success',
      `Volume "${v.name}" (${v.size} GB, OpenStack volume ${v.id}) attached.`,
    );
    await journal(db, cloud.id, 'success', `Volume "${v.name}" attached to a server in ${region}.`);
    await journalDisk(db, diskId, 'success', 'Attached.'); // also broadcasts the new state
  } catch (e) {
    await detachVolumeDisk(db, cloud.id, v.id); // the optimistic VM assignment didn't happen
    const msg = `Attaching volume "${v.name}" in ${region}: ${messageOf(e)}`;
    await journalVm(db, vmId, 'danger', msg);
    await journal(db, cloud.id, 'danger', msg);
    await journalDisk(db, diskId, 'danger', msg); // also broadcasts the reverted state
  }
}

/** Attach an existing, currently unattached Cinder volume to a VM. */
export async function attachCloudVolume(
  db: Db,
  cloud: CloudRow,
  region: string,
  volumeId: string,
  vmId: number,
): Promise<void> {
  const target = await serverOf(db, cloud, region, vmId);
  const volume = (await listVolumes(cloud, region)).find((v) => v.id === volumeId);
  if (!volume) throw new ApiError(404, 'This volume does not exist in this region.');
  if (volume.attachments.length) {
    throw fieldError('volume_id', 'This volume is already attached.');
  }
  await journal(
    db,
    cloud.id,
    'warning',
    `Attaching volume "${volume.name || volumeId}" in ${region} requested.`,
  );
  // show it assigned to the VM right away; mirrorAttach reverts it if the real attach fails
  const v = { id: volumeId, name: volume.name || volumeId, size: volume.size };
  const diskId = await upsertVolumeDisk(db, cloud, region, vmId, v);
  await journalDisk(db, diskId, 'warning', `Attachment requested in ${region}.`);
  void mirrorAttach(db, cloud, region, target.serverId, vmId, diskId, v);
}

/**
 * Detach a volume from the VM it is mirrored under; kept on the cloud unless `alsoDelete` is
 * true (OpenStack never deletes a volume just because it was detached).
 */
export async function detachCloudVolume(
  db: Db,
  cloud: CloudRow,
  region: string,
  volumeId: string,
  vmId: number,
  alsoDelete: boolean,
): Promise<void> {
  const target = await serverOf(db, cloud, region, vmId);
  const link = await db.get<{ virtual_disk_id: number }>(
    `SELECT virtual_disk_id FROM ${T.volume} WHERE cloud_id = ? AND volume_id = ?`,
    [cloud.id, volumeId],
  );
  const diskId = link?.virtual_disk_id ?? null;
  await journalVm(db, vmId, 'warning', `Volume detachment requested in ${region}.`);
  if (diskId != null)
    await journalDisk(db, diskId, 'warning', `Detachment requested in ${region}.`);
  void (async () => {
    const done = alsoDelete ? 'detached and deleted' : 'detached (kept)';
    try {
      await detachVolume(cloud, region, target.serverId, volumeId);
      let status = await getVolumeState(cloud, region, volumeId);
      for (let waited = 0; status === 'detaching' && waited < POLL_LIMIT_MS; waited += POLL_MS) {
        await sleep(POLL_MS);
        status = await getVolumeState(cloud, region, volumeId);
      }
      if (alsoDelete && status != null) await deleteVolume(cloud, region, volumeId);
      if (diskId != null) await journalDisk(db, diskId, 'success', `${done}.`);
      if (alsoDelete) await removeVolumeDisk(db, cloud.id, volumeId);
      else await detachVolumeDisk(db, cloud.id, volumeId);
      await journalVm(db, vmId, 'success', `Volume ${volumeId} ${done} in ${region}.`);
      await journal(db, cloud.id, 'success', `Volume ${volumeId} ${done} in ${region}.`);
    } catch (e) {
      const msg = `Detaching volume ${volumeId}: ${messageOf(e)}`;
      await journalVm(db, vmId, 'danger', msg);
      await journal(db, cloud.id, 'danger', msg);
      if (diskId != null) await journalDisk(db, diskId, 'danger', msg);
    }
  })();
}

/** Delete an unattached Cinder volume outright; a volume already gone is not an error. */
export async function deleteCloudVolume(
  cloud: CloudRow,
  region: string,
  volumeId: string,
): Promise<void> {
  const volume = (await listVolumes(cloud, region)).find((v) => v.id === volumeId);
  if (!volume) return; // already gone
  if (volume.attachments.length) {
    throw fieldError('volume_id', 'This volume is attached: detach it first.');
  }
  await deleteVolume(cloud, region, volumeId);
}

/**
 * Reconcile an OpenStack-mirrored Volume with the cloud after it was edited directly (its VM
 * reassigned/cleared, or its size changed) — called from the plugin's 'updated' hook on
 * virtualization_virtual_disk. A disk with no Cinder link is a plain record paashup doesn't
 * manage on any cloud, and is left alone. Cinder's own live state is the ground truth for what
 * actually changed, since a post-write hook has no "before" snapshot to compare against.
 */
export async function reconcileVolumeAttachment(db: Db, diskId: number): Promise<void> {
  const link = await db.get<{ cloud_id: number; region: string; volume_id: string }>(
    `SELECT cloud_id, region, volume_id FROM ${T.volume} WHERE virtual_disk_id = ?`,
    [diskId],
  );
  if (!link) return; // a plain record, not a Cinder volume paashup tracks

  const disk = await db.get<{ virtual_machine_id: number | null; name: string; size: number }>(
    `SELECT virtual_machine_id, name, size FROM virtualization_virtual_disk WHERE id = ?`,
    [diskId],
  );
  if (!disk) return; // deleted since the hook fired

  const cloud = await db.get<CloudRow>(`SELECT * FROM ${T.cloud} WHERE id = ?`, [link.cloud_id]);
  if (!cloud) return;

  try {
    const volume = (await listVolumes(cloud, link.region)).find((v) => v.id === link.volume_id);
    if (!volume) return; // deleted on the cloud; the next sync will notice

    const currentServerId = volume.attachments[0]?.serverId ?? null;
    let wantedServerId: string | null = null;
    if (disk.virtual_machine_id != null) {
      const server = await db.get<{ server_id: string }>(
        `SELECT server_id FROM ${T.server} WHERE cloud_id = ? AND virtual_machine_id = ?`,
        [link.cloud_id, disk.virtual_machine_id],
      );
      if (!server) {
        const msg = `Was assigned to a VM that is not a server of this cloud; left as is on OpenStack.`;
        await journal(db, link.cloud_id, 'danger', `Volume "${disk.name}" ${msg}`);
        await journalDisk(db, diskId, 'danger', msg);
        return;
      }
      wantedServerId = server.server_id;
    }

    if (currentServerId !== wantedServerId) {
      if (currentServerId) {
        await detachVolume(cloud, link.region, currentServerId, link.volume_id);
        let status = await getVolumeState(cloud, link.region, link.volume_id);
        for (let waited = 0; status === 'detaching' && waited < POLL_LIMIT_MS; waited += POLL_MS) {
          await sleep(POLL_MS);
          status = await getVolumeState(cloud, link.region, link.volume_id);
        }
      }
      if (wantedServerId) {
        await attachVolume(cloud, link.region, wantedServerId, link.volume_id);
        await journal(
          db,
          link.cloud_id,
          'success',
          `Volume "${disk.name}" attached in ${link.region}.`,
        );
        await journalDisk(db, diskId, 'success', `Attached in ${link.region}.`);
      } else {
        await journal(
          db,
          link.cloud_id,
          'success',
          `Volume "${disk.name}" detached in ${link.region}.`,
        );
        await journalDisk(db, diskId, 'success', `Detached in ${link.region}.`);
      }
    }

    // size: only Cinder is allowed to grow it; a shrink attempt, or a grow it refuses (e.g.
    // the volume isn't "available" yet right after an attach requested in the same edit), is
    // reverted — paashup's own size must never claim a bigger one than the cloud actually has.
    if (disk.size > volume.size) {
      try {
        await resizeVolume(cloud, link.region, link.volume_id, disk.size);
        await journal(
          db,
          link.cloud_id,
          'success',
          `Volume "${disk.name}" resize to ${disk.size} GB requested in ${link.region}.`,
        );
        await journalDisk(db, diskId, 'success', `Resize to ${disk.size} GB requested.`);
      } catch (e) {
        await db.execute(`UPDATE virtualization_virtual_disk SET size = ? WHERE id = ?`, [
          volume.size,
          diskId,
        ]);
        const msg = `Resize refused by OpenStack; its size was reverted to ${volume.size} GB (${messageOf(e)}).`;
        await journal(db, link.cloud_id, 'danger', `Volume "${disk.name}" ${msg}`);
        await journalDisk(db, diskId, 'danger', msg);
      }
    } else if (disk.size < volume.size) {
      await db.execute(`UPDATE virtualization_virtual_disk SET size = ? WHERE id = ?`, [
        volume.size,
        diskId,
      ]);
      const msg = `Cannot be shrunk on OpenStack; its size was reverted to ${volume.size} GB.`;
      await journal(db, link.cloud_id, 'warning', `Volume "${disk.name}" ${msg}`);
      await journalDisk(db, diskId, 'warning', msg);
    }
  } catch (e) {
    const msg = `Reconciling volume "${disk.name}": ${messageOf(e)}`;
    await journal(db, link.cloud_id, 'danger', msg);
    await journalDisk(db, diskId, 'danger', msg);
  }
}

/**
 * Called from the plugin's 'deleting' hook on virtualization_virtual_disk, before the row is
 * destroyed: if it mirrors a Cinder volume, detach it (if attached) and delete it for real —
 * deleting the paashup record must not leave an orphaned, still-billed volume behind. Throws
 * (aborting the deletion, record kept) if the cloud call fails.
 */
export async function deleteLinkedCloudVolume(db: Db, diskId: number): Promise<void> {
  const link = await db.get<{ cloud_id: number; region: string; volume_id: string }>(
    `SELECT cloud_id, region, volume_id FROM ${T.volume} WHERE virtual_disk_id = ?`,
    [diskId],
  );
  if (!link) return; // a plain record, not a Cinder volume paashup tracks

  const cloud = await db.get<CloudRow>(`SELECT * FROM ${T.cloud} WHERE id = ?`, [link.cloud_id]);
  if (!cloud) return; // the cloud itself is gone; nothing left to call

  const volume = (await listVolumes(cloud, link.region)).find((v) => v.id === link.volume_id);
  if (!volume) return; // already gone on the cloud

  if (volume.attachments.length) {
    const serverId = volume.attachments[0]!.serverId;
    await detachVolume(cloud, link.region, serverId, link.volume_id);
    let status = await getVolumeState(cloud, link.region, link.volume_id);
    for (let waited = 0; status === 'detaching' && waited < POLL_LIMIT_MS; waited += POLL_MS) {
      await sleep(POLL_MS);
      status = await getVolumeState(cloud, link.region, link.volume_id);
    }
  }
  await deleteVolume(cloud, link.region, link.volume_id);
  await journal(
    db,
    link.cloud_id,
    'success',
    `Volume ${link.volume_id} deleted in ${link.region} (its paashup record was deleted).`,
  );
}
