// Create and delete VMs on OpenStack from paasbox.
//
// Create: validate the request, check the quotas, make sure the chosen SSH key exists as a
// Nova keypair of the region or uploaded, then boot the server from an image, stamped
// with the `managed-by=paasbox` metadata.
//
// Delete: only for VMs paasbox created. The server is deleted on OpenStack, the VM is marked
// "decommissioning", and it is removed once Nova no longer has the server.
import type { Db } from '../../db/types.js';
import { ApiError, ValidationError } from '../../errors.js';
import { NOVA_KEYPAIR_NAME } from '../../repository/validate.js';
import {
  authenticate,
  computeRegions,
  createKeypair,
  createServer,
  deleteServer,
  getComputeLimits,
  getServerState,
  listFlavors,
  listKeypairs,
  type CloudConfig,
} from './openstack.js';
import { emitVm } from './events.js';
import { journal, journalVm } from './journal.js';
import { T } from './meta.js';
import { dropServer, importServer, MANAGED_BY } from './sync.js';

interface CloudRow extends CloudConfig {
  id: number;
  name: string;
}

export type SshKeyChoice = { source: 'cloud'; name: string } | { source: 'paasbox'; id: number };

export interface CreateInput {
  region: string;
  name: string;
  flavorId: string;
  imageId: string;
  networkIds: string[];
  securityGroups: string[];
  sshKey: SshKeyChoice;
}

const POLL_MS = Number(process.env.PB_OPENSTACK_POLL_MS) || 5000;
const POLL_LIMIT_MS = 10 * 60_000;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const fieldError = (field: string, msg: string): ValidationError =>
  new ValidationError('Invalid request', { [field]: [msg] });

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];

/** Check the body of a create request; throws the field-level 400 the form displays. */
export function parseCreate(body: unknown): CreateInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const errors: Record<string, string[]> = {};
  const need = (field: string, ok: boolean, msg = 'This field is required.') => {
    if (!ok) errors[field] = [msg];
  };
  const str = (v: unknown): string => (v == null ? '' : String(v)).trim();

  const name = str(b.name);
  need('name', !!name);
  need('name', name.length <= 64, 'Ensure this value has at most 64 characters.');
  const region = str(b.region);
  need('region', !!region);
  const flavorId = str(b.flavor_id);
  need('flavor_id', !!flavorId);
  const imageId = str(b.image_id);
  need('image_id', !!imageId);
  const networkIds = strings(b.network_ids);
  need('network_ids', networkIds.length > 0, 'Choose at least one network.');

  const k = (b.ssh_key ?? {}) as Record<string, unknown>;
  let sshKey: SshKeyChoice | undefined;
  if (k.source === 'cloud' && str(k.name)) sshKey = { source: 'cloud', name: str(k.name) };
  else if (k.source === 'paasbox' && Number.isInteger(Number(k.id)) && Number(k.id) > 0) {
    sshKey = { source: 'paasbox', id: Number(k.id) };
  }
  need('ssh_key', !!sshKey, 'Choose the SSH key to launch the VM with.');

  if (Object.keys(errors).length || !sshKey) throw new ValidationError('Invalid request', errors);
  return {
    region,
    name,
    flavorId,
    imageId,
    networkIds,
    securityGroups: strings(b.security_groups),
    sshKey,
  };
}

const samePublicKey = (a: string, b: string): boolean => {
  const material = (k: string) => k.trim().split(/\s+/).slice(0, 2).join(' ');
  return material(a) === material(b);
};

interface ResolvedKey {
  name: string;
  publicKey: string;
}

/**
 * The Nova keypair to launch with. A key of the cloud must exist in the region; a paasbox
 * key is registered there first. Nothing is renamed: a keypair of that name holding another
 * key is an error.
 */
async function resolveKey(
  db: Db,
  cloud: CloudRow,
  region: string,
  choice: SshKeyChoice,
): Promise<ResolvedKey> {
  const existing = await listKeypairs(cloud, region);
  if (choice.source === 'cloud') {
    const found = existing.find((k) => k.name === choice.name && k.publicKey);
    if (!found) {
      throw fieldError('ssh_key', `No SSH keypair named "${choice.name}" in region ${region}.`);
    }
    return { name: found.name, publicKey: found.publicKey };
  }

  const row = await db.get<{ name: string; public_key: string }>(
    `SELECT name, public_key FROM virtualization_ssh_key WHERE id = ?`,
    [choice.id],
  );
  if (!row) throw fieldError('ssh_key', 'This SSH key does not exist.');
  if (!NOVA_KEYPAIR_NAME.test(row.name)) {
    throw fieldError(
      'ssh_key',
      `The key name "${row.name}" cannot be used as an OpenStack keypair name (letters, digits, "-", "_" and spaces only). Rename the key first.`,
    );
  }
  const same = existing.find((k) => k.name === row.name);
  if (same) {
    if (!samePublicKey(same.publicKey, row.public_key)) {
      throw fieldError(
        'ssh_key',
        `A keypair named "${row.name}" already exists in region ${region} with a different public key. Rename the key in paasbox, or delete that keypair in OpenStack.`,
      );
    }
    return { name: row.name, publicKey: row.public_key };
  }
  await createKeypair(cloud, region, row.name, row.public_key);
  return { name: row.name, publicKey: row.public_key };
}

/** Refuse, with a readable message, a server the project's quotas cannot hold. */
async function checkQuota(
  cloud: CloudRow,
  region: string,
  flavor: { vcpus: number; ram: number },
): Promise<void> {
  const limits = await getComputeLimits(cloud, region);
  const left = (q: { max: number; used: number }): number =>
    q.max < 0 ? Infinity : q.max - q.used;
  const refuse = (what: string, q: { max: number; used: number }) =>
    new ValidationError('Quota exceeded', {
      detail: `Quota reached in ${region}: ${what} (${q.used} used of ${q.max}).`,
    });
  if (left(limits.instances) < 1) throw refuse('no instance left', limits.instances);
  if (left(limits.cores) < flavor.vcpus) {
    throw refuse(`not enough vCPUs for this flavor (${flavor.vcpus} needed)`, limits.cores);
  }
  if (left(limits.ram) < flavor.ram) {
    throw refuse(`not enough memory for this flavor (${flavor.ram} MB needed)`, limits.ram);
  }
}

export interface Launched {
  server_id: string;
  /** the VM it became in paasbox; null if it could not be imported right away */
  vm_id: number | null;
  region: string;
  ssh_key: string;
}

/** Validate, then ask OpenStack to boot the server. Resolves once it is requested. */
export async function launchServer(db: Db, cloud: CloudRow, input: CreateInput): Promise<Launched> {
  const session = await authenticate(cloud);
  if (!computeRegions(session).includes(input.region)) {
    throw fieldError('region', `Region "${input.region}" has no compute service.`);
  }
  const flavor = (await listFlavors(cloud, input.region)).find((f) => f.id === input.flavorId);
  if (!flavor) throw fieldError('flavor_id', 'This flavor does not exist in the region.');

  await checkQuota(cloud, input.region, flavor);
  const key = await resolveKey(db, cloud, input.region, input.sshKey);

  const serverId = await createServer(cloud, input.region, {
    name: input.name,
    flavorId: input.flavorId,
    imageId: input.imageId,
    networkIds: input.networkIds,
    keyName: key.name,
    securityGroups: input.securityGroups,
    metadata: { [MANAGED_BY.key]: MANAGED_BY.value },
  });
  await journal(
    db,
    cloud.id,
    'info',
    `Server "${input.name}" requested in ${input.region} (flavor ${flavor.name}, SSH key "${key.name}").`,
  );

  // the VM exists in paasbox as soon as the request is answered, still building
  let vmId: number | null = null;
  try {
    vmId = await importServer(db, cloud.id, input.region, serverId);
    if (vmId != null) await journalVm(db, vmId, 'info', launchedWith(cloud, input.region, key));
  } catch (e) {
    await journal(
      db,
      cloud.id,
      'warning',
      `Server "${input.name}" was requested but could not be imported yet: ${messageOf(e)}`,
    );
  }
  void followCreate(db, cloud, input, serverId, key, vmId != null);
  return { server_id: serverId, vm_id: vmId, region: input.region, ssh_key: key.name };
}

/** The permanent record of what a VM was launched with: the key's name and the whole key. */
const launchedWith = (cloud: CloudRow, region: string, key: ResolvedKey): string =>
  `Launched through paasbox on OpenStack cloud "${cloud.name}" (region ${region}) with SSH key "${key.name}":\n${key.publicKey}`;

async function followCreate(
  db: Db,
  cloud: CloudRow,
  input: CreateInput,
  serverId: string,
  key: ResolvedKey,
  launchTraced: boolean,
): Promise<void> {
  let traced = launchTraced;
  // import (or update) just this server; the first call makes the VM appear, still building
  const importIt = async (): Promise<number | null> => {
    const vmId = await importServer(db, cloud.id, input.region, serverId);
    // the journal of the VM is the permanent record of what it was launched with
    if (vmId != null && !traced) {
      traced = true;
      await journalVm(db, vmId, 'info', launchedWith(cloud, input.region, key));
    }
    return vmId;
  };

  try {
    await importIt();

    let state = await getServerState(cloud, input.region, serverId);
    for (
      let waited = 0;
      state && state.status === 'BUILD' && waited < POLL_LIMIT_MS;
      waited += POLL_MS
    ) {
      await sleep(POLL_MS);
      state = await getServerState(cloud, input.region, serverId);
    }

    const vmId = await importIt(); // its final status, and the addresses it got
    if (!state) {
      await journal(db, cloud.id, 'warning', `Server "${input.name}" disappeared while building.`);
    } else if (state.status === 'ERROR') {
      const why = state.fault ? `: ${state.fault}` : '';
      if (vmId != null)
        await journalVm(db, vmId, 'danger', `OpenStack failed to build the server${why}`);
      await journal(db, cloud.id, 'danger', `Server "${input.name}" failed to build${why}`);
    } else if (state.status === 'BUILD') {
      await journal(
        db,
        cloud.id,
        'warning',
        `Server "${input.name}" is still building after ${POLL_LIMIT_MS / 60_000} minutes.`,
      );
    } else {
      if (vmId != null) await journalVm(db, vmId, 'success', `Server is ${state.status}.`);
      await journal(db, cloud.id, 'success', `Server "${input.name}" is ${state.status}.`);
    }
  } catch (e) {
    await journal(db, cloud.id, 'danger', `Following server "${input.name}": ${messageOf(e)}`);
  }
}

interface Link {
  cloud_id: number;
  region: string;
  server_id: string;
  managed: number | boolean;
  name: string;
}

/**
 * Delete the OpenStack server behind a VM. Only a VM paasbox created may be deleted this
 * way; the others are refused (403), and a VM with no server behind it is a 404.
 */
export async function deleteManagedVm(db: Db, vmId: number): Promise<void> {
  const link = await db.get<Link>(
    `SELECT s.cloud_id, s.region, s.server_id, s.managed, v.name
       FROM ${T.server} s JOIN virtualization_virtual_machine v ON v.id = s.virtual_machine_id
      WHERE s.virtual_machine_id = ?`,
    [vmId],
  );
  if (!link) {
    throw new ApiError(404, 'This VM is not a server of an OpenStack cloud known to paasbox.');
  }
  if (!link.managed) {
    throw new ApiError(
      403,
      'Only VMs created by paasbox can be deleted from here. This one already existed on the cloud: delete it in OpenStack.',
    );
  }
  const cloud = await db.get<CloudRow>(`SELECT * FROM ${T.cloud} WHERE id = ?`, [link.cloud_id]);
  if (!cloud) throw new ApiError(404, 'The OpenStack cloud of this VM is gone.');

  await deleteServer(cloud, link.region, link.server_id);
  await db.execute(
    `UPDATE virtualization_virtual_machine SET status = 'decommissioning' WHERE id = ?`,
    [vmId],
  );
  await emitVm(db, vmId, 'updated'); // its new status
  await journalVm(db, vmId, 'warning', `Deletion requested on OpenStack (region ${link.region}).`);
  await journal(
    db,
    cloud.id,
    'warning',
    `Deletion of server "${link.name}" requested in ${link.region}.`,
  );
  void followDelete(db, cloud, link);
}

async function followDelete(db: Db, cloud: CloudRow, link: Link): Promise<void> {
  try {
    let gone = false;
    for (let waited = 0; waited < POLL_LIMIT_MS; waited += POLL_MS) {
      if (!(await getServerState(cloud, link.region, link.server_id))) {
        gone = true;
        break;
      }
      await sleep(POLL_MS);
    }
    if (!gone) {
      await journal(
        db,
        cloud.id,
        'warning',
        `Server "${link.name}" is still on OpenStack ${POLL_LIMIT_MS / 60_000} minutes after its deletion was requested.`,
      );
      return;
    }
    await dropServer(db, cloud.id, link.server_id); // the VM goes with its server
    await journal(db, cloud.id, 'success', `Server "${link.name}" deleted in ${link.region}.`);
  } catch (e) {
    await journal(
      db,
      cloud.id,
      'danger',
      `Following the deletion of "${link.name}": ${messageOf(e)}`,
    );
  }
}

/** The OpenStack server behind each VM (or one VM's), for the UI to tell managed VMs apart. */
export async function listLinks(db: Db, vmId?: number): Promise<Record<string, unknown>[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT s.virtual_machine_id, s.cloud_id, c.name AS cloud, s.region, s.server_id, s.managed
       FROM ${T.server} s JOIN ${T.cloud} c ON c.id = s.cloud_id
      ${vmId != null ? 'WHERE s.virtual_machine_id = ?' : ''} ORDER BY s.id`,
    vmId != null ? [vmId] : [],
  );
  return rows.map((r) => ({ ...r, managed: !!r.managed }));
}
