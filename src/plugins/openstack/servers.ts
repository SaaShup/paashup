// Create and delete VMs on OpenStack from paashup.
//
// Create: validate the request, check the quotas, make sure the chosen SSH key exists as a
// Nova keypair of the region or uploaded, then boot the server from an image.
//
// Delete: any VM of a cloud. The server is deleted on OpenStack, the VM is marked
// "decommissioning", and it is removed once Nova no longer has the server.
import type { Db } from '../../db/types.js';
import { ApiError, ValidationError } from '../../errors.js';
import { checkScript, renderScript } from '../../initscripts.js';
import { NOVA_KEYPAIR_NAME } from '../../repository/validate.js';
import {
  attachVolume,
  authenticate,
  computeRegions,
  confirmResize,
  createKeypair,
  createServer,
  createVolume,
  deleteServer,
  deleteVolume,
  detachVolume,
  getComputeLimits,
  getServerMetadata,
  getServerState,
  getVolumeInfo,
  getVolumeState,
  rebootServer,
  renameServer,
  resizeServer,
  resizeVolume,
  updateServerMetadata,
  listFlavors,
  listKeypairs,
  type CloudConfig,
} from './openstack.js';
import { emitVm } from './events.js';
import { journal, journalDisk, journalVm } from './journal.js';
import { T } from './meta.js';
import { attachCloudVolume } from './volumes.js';
import {
  detachVolumeDisk,
  dropServer,
  importServer,
  removeVolumeDisk,
  upsertVolumeDisk,
  vmStatus,
} from './sync.js';

interface CloudRow extends CloudConfig {
  id: number;
  name: string;
}

export type SshKeyChoice = { source: 'cloud'; name: string } | { source: 'paashup'; id: number };

export interface CreateInput {
  region: string;
  name: string;
  flavorId: string;
  imageId: string;
  networkIds: string[];
  securityGroups: string[];
  sshKey: SshKeyChoice;
  /** metadata (key → value) of the server */
  metadata: Record<string, string>;
  /** an init script of the library, with the values given to its variables */
  script?: { id: number; variables: Record<string, string> };
  /** size (GB) of an extra Cinder volume created and attached once the server is up */
  dataVolumeGb?: number;
  /** id of an existing, currently unattached Cinder volume to attach once the server is up */
  existingVolumeId?: string;
}

const DATA_VOLUME_MIN_GB = 1;
const DATA_VOLUME_MAX_GB = 2000;

const POLL_MS = Number(process.env.PB_OPENSTACK_POLL_MS) || 5000;
const POLL_LIMIT_MS = 10 * 60_000;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** Like messageOf, but prefers a field-level detail message (e.g. a ValidationError's). */
const detailOf = (e: unknown): string => {
  const d = e && typeof e === 'object' ? (e as { detail?: unknown }).detail : undefined;
  if (d && typeof d === 'object') {
    const first = Object.values(d as Record<string, unknown>)[0];
    if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
  }
  return messageOf(e);
};
const fieldError = (field: string, msg: string): ValidationError =>
  new ValidationError('Invalid request', { [field]: [msg] });

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];

/** What Nova accepts as server metadata: at most 255 characters for a key and for a value. */
const METADATA_MAX = 255;
const METADATA_ITEMS = 100;

/** The metadata of a request as key → value, or the field-level 400. */
export function parseMetadata(raw: unknown): Record<string, string> {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw fieldError('metadata', 'Metadata must be an object of key → value.');
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > METADATA_ITEMS) {
    throw fieldError('metadata', `At most ${METADATA_ITEMS} metadata keys.`);
  }
  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!key.trim() || key !== key.trim()) {
      throw fieldError('metadata', 'A key cannot be empty or start or end with a space.');
    }
    if (key.length > METADATA_MAX) {
      throw fieldError(
        'metadata',
        `Key "${key.slice(0, 20)}…" is longer than ${METADATA_MAX} characters.`,
      );
    }
    if (value != null && typeof value === 'object') {
      throw fieldError('metadata', `The value of "${key}" must be text.`);
    }
    const text = value == null ? '' : String(value);
    if (text.length > METADATA_MAX) {
      throw fieldError(
        'metadata',
        `The value of "${key}" is longer than ${METADATA_MAX} characters.`,
      );
    }
    out[key] = text;
  }
  return out;
}

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
  else if (k.source === 'paashup' && Number.isInteger(Number(k.id)) && Number(k.id) > 0) {
    sshKey = { source: 'paashup', id: Number(k.id) };
  }
  need('ssh_key', !!sshKey, 'Choose the SSH key to launch the VM with.');

  let metadata: Record<string, string> = {};
  try {
    metadata = parseMetadata(b.metadata);
  } catch (e) {
    if (!(e instanceof ValidationError) || !e.detail) throw e;
    Object.assign(errors, e.detail);
  }

  let script: CreateInput['script'];
  const sc = b.init_script;
  if (sc != null) {
    const o = (typeof sc === 'object' ? sc : {}) as Record<string, unknown>;
    const vars = (o.variables ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(Number(o.id)) || Number(o.id) <= 0) {
      errors.init_script = ['Choose an init script.'];
    } else if (typeof vars !== 'object' || Array.isArray(vars)) {
      errors.init_script = ['Variables must be an object of name → value.'];
    } else {
      script = {
        id: Number(o.id),
        variables: Object.fromEntries(
          Object.entries(vars)
            .filter(([, v]) => v != null)
            .map(([k, v]) => [k, String(v)]),
        ),
      };
    }
  }

  let dataVolumeGb: number | undefined;
  if (b.data_volume_gb != null && b.data_volume_gb !== '') {
    const n = Number(b.data_volume_gb);
    if (!Number.isInteger(n) || n < DATA_VOLUME_MIN_GB || n > DATA_VOLUME_MAX_GB) {
      errors.data_volume_gb = [
        `Must be a whole number of GB between ${DATA_VOLUME_MIN_GB} and ${DATA_VOLUME_MAX_GB}.`,
      ];
    } else {
      dataVolumeGb = n;
    }
  }

  const existingVolumeId = str(b.existing_volume_id) || undefined;
  if (existingVolumeId && dataVolumeGb != null) {
    errors.data_volume_gb = ['Choose either a new disk or an existing volume, not both.'];
  }

  if (Object.keys(errors).length || !sshKey) throw new ValidationError('Invalid request', errors);
  return {
    region,
    name,
    flavorId,
    imageId,
    networkIds,
    securityGroups: strings(b.security_groups),
    sshKey,
    metadata,
    script,
    dataVolumeGb,
    existingVolumeId,
  };
}

interface ResolvedScript {
  name: string;
  /** the script with the changed variables exported, ready to be the server's user_data */
  userData: string;
  /** the variables whose value differs from the script's default */
  changed: Record<string, string>;
  /** the variables marked secret: their values are never written to a journal */
  secret: string[];
}

/** The chosen init script rendered with its variables, or the field-level 400. */
async function resolveScript(
  db: Db,
  choice: NonNullable<CreateInput['script']>,
): Promise<ResolvedScript> {
  const row = await db.get<{ name: string; content: string; secret_variables: unknown }>(
    `SELECT name, content, secret_variables FROM virtualization_init_script WHERE id = ?`,
    [choice.id],
  );
  if (!row) throw fieldError('init_script', 'This init script does not exist.');
  let rendered: ReturnType<typeof renderScript>;
  try {
    rendered = renderScript(row.content, choice.variables);
  } catch (e) {
    throw fieldError('init_script', messageOf(e));
  }
  const problem = checkScript(rendered.script);
  if (problem) throw fieldError('init_script', problem);
  const raw = row.secret_variables; // JSON text (SQLite) or already parsed (MariaDB); NULL before any is set
  const secret: string[] = (typeof raw === 'string' ? JSON.parse(raw) : raw) ?? [];
  return { name: row.name, userData: rendered.script, changed: rendered.changed, secret };
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
 * The Nova keypair to launch with. A key of the cloud must exist in the region; a paashup
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
        `A keypair named "${row.name}" already exists in region ${region} with a different public key. Rename the key in paashup, or delete that keypair in OpenStack.`,
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
  /** the VM it became in paashup; null if it could not be imported right away */
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

  const script = input.script ? await resolveScript(db, input.script) : null;
  await checkQuota(cloud, input.region, flavor);
  const key = await resolveKey(db, cloud, input.region, input.sshKey);

  const serverId = await createServer(cloud, input.region, {
    name: input.name,
    flavorId: input.flavorId,
    imageId: input.imageId,
    networkIds: input.networkIds,
    keyName: key.name,
    securityGroups: input.securityGroups,
    userData: script?.userData,
    metadata: input.metadata,
  });
  await journal(
    db,
    cloud.id,
    'info',
    `Server "${input.name}" requested in ${input.region} (flavor ${flavor.name}, SSH key "${key.name}").`,
  );

  // the VM exists in paashup as soon as the request is answered, still building
  let vmId: number | null = null;
  try {
    vmId = await importServer(db, cloud.id, input.region, serverId);
    if (vmId != null) {
      await journalVm(db, vmId, 'info', launchedWith(cloud, input.region, key));
      if (script) await journalVm(db, vmId, 'info', scriptNote(script));
      const keys = Object.keys(input.metadata);
      if (keys.length) await journalVm(db, vmId, 'info', `Metadata set: ${keys.join(', ')}.`);
    }
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
  `Launched through paashup on OpenStack cloud "${cloud.name}" (region ${region}) with SSH key "${key.name}":\n${key.publicKey}`;

/**
 * What a VM's journal says of its init script: its name and the variables that were changed,
 * a secret one as *** instead of its value.
 */
const scriptNote = (s: ResolvedScript): string => {
  const changed = Object.entries(s.changed).map(
    ([k, v]) => `${k}=${s.secret.includes(k) ? '***' : JSON.stringify(v)}`,
  );
  return `Init script "${s.name}"${changed.length ? ` with ${changed.join(', ')}` : ' with its default values'}.`;
};

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
      if (input.dataVolumeGb) {
        await provisionDataVolume(
          db,
          cloud,
          input.region,
          serverId,
          vmId,
          input.name,
          input.dataVolumeGb,
        );
      } else if (input.existingVolumeId) {
        if (vmId != null) {
          try {
            await attachCloudVolume(db, cloud, input.region, input.existingVolumeId, vmId);
          } catch (e) {
            const msg = `Attaching the chosen volume to server "${input.name}": ${detailOf(e)}`;
            await journalVm(db, vmId, 'danger', msg);
            await journal(db, cloud.id, 'danger', msg);
          }
        } else {
          await journal(
            db,
            cloud.id,
            'warning',
            `Server "${input.name}" built, but the chosen volume could not be attached: the VM was not imported yet.`,
          );
        }
      }
    }
  } catch (e) {
    await journal(db, cloud.id, 'danger', `Following server "${input.name}": ${messageOf(e)}`);
  }
}

/**
 * Create a Cinder volume and attach it to a server as an extra (non-boot) disk — at launch,
 * or on demand for a server that is already up. Its id is kept on the server's row so it can
 * be deleted along with the server, and it is mirrored right away as a virtual disk (no need
 * to wait for the next sync).
 */
async function provisionDataVolume(
  db: Db,
  cloud: CloudRow,
  region: string,
  serverId: string,
  vmId: number | null,
  serverName: string,
  sizeGb: number,
): Promise<void> {
  try {
    const name = `${serverName}-data`;
    const volumeId = await createVolume(cloud, region, { name, sizeGb });
    let status = await getVolumeState(cloud, region, volumeId);
    for (let waited = 0; status === 'creating' && waited < POLL_LIMIT_MS; waited += POLL_MS) {
      await sleep(POLL_MS);
      status = await getVolumeState(cloud, region, volumeId);
    }
    if (status !== 'available') {
      throw new Error(`volume ${volumeId} ended up "${status ?? 'gone'}" instead of "available"`);
    }
    const { device } = await attachVolume(cloud, region, serverId, volumeId);
    await db.execute(
      `UPDATE ${T.server} SET data_volume_id = ? WHERE cloud_id = ? AND server_id = ?`,
      [volumeId, cloud.id, serverId],
    );
    if (vmId != null) {
      const diskId = await upsertVolumeDisk(
        db,
        cloud,
        region,
        vmId,
        { id: volumeId, name, size: sizeGb },
        device,
      );
      await journalVm(
        db,
        vmId,
        'success',
        `Data volume attached (${sizeGb} GB, OpenStack volume ${volumeId}).`,
      );
      await journalDisk(
        db,
        diskId,
        'success',
        `Created and attached (${sizeGb} GB, OpenStack volume ${volumeId}).`,
      );
      await emitVm(db, vmId, 'updated');
    }
    await journal(
      db,
      cloud.id,
      'success',
      `Data volume of ${sizeGb} GB attached to server "${serverName}" in ${region}.`,
    );
  } catch (e) {
    const msg = `Data volume for server "${serverName}" failed in ${region}: ${messageOf(e)}`;
    if (vmId != null) await journalVm(db, vmId, 'danger', msg);
    await journal(db, cloud.id, 'danger', msg);
  }
}

/**
 * Create and attach a data volume to a VM that is already up. A VM that already has one, or a
 * bad size, is the field-level 400.
 */
export async function addDataVolume(db: Db, vmId: number, sizeGb: number): Promise<void> {
  if (!Number.isInteger(sizeGb) || sizeGb < DATA_VOLUME_MIN_GB || sizeGb > DATA_VOLUME_MAX_GB) {
    throw fieldError(
      'size_gb',
      `Must be a whole number of GB between ${DATA_VOLUME_MIN_GB} and ${DATA_VOLUME_MAX_GB}.`,
    );
  }
  const { link, cloud } = await serverOfVm(db, vmId);
  if (link.data_volume_id) throw fieldError('size_gb', 'This VM already has a data volume.');
  await journalVm(db, vmId, 'warning', `Data volume of ${sizeGb} GB requested in ${link.region}.`);
  void provisionDataVolume(db, cloud, link.region, link.server_id, vmId, link.name, sizeGb);
}

interface Link {
  cloud_id: number;
  region: string;
  server_id: string;
  metadata?: unknown;
  name: string;
  data_volume_id: string | null;
}

/** The OpenStack server behind a VM and its cloud, or the 404 when there is none. */
async function serverOfVm(db: Db, vmId: number): Promise<{ link: Link; cloud: CloudRow }> {
  const link = await db.get<Link>(
    `SELECT s.cloud_id, s.region, s.server_id, s.metadata, s.data_volume_id, v.name
       FROM ${T.server} s JOIN virtualization_virtual_machine v ON v.id = s.virtual_machine_id
      WHERE s.virtual_machine_id = ?`,
    [vmId],
  );
  if (!link) {
    throw new ApiError(404, 'This VM is not a server of an OpenStack cloud known to paashup.');
  }
  const cloud = await db.get<CloudRow>(`SELECT * FROM ${T.cloud} WHERE id = ?`, [link.cloud_id]);
  if (!cloud) throw new ApiError(404, 'The OpenStack cloud of this VM is gone.');
  return { link, cloud };
}

/** The metadata column as an object: JSON text, or already parsed, or null when empty. */
function storedMetadata(raw: unknown): Record<string, string> | null {
  if (raw == null || raw === '') return null;
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : null;
  } catch {
    return null;
  }
}

const saveMetadata = (db: Db, vmId: number, metadata: Record<string, string>): Promise<unknown> =>
  db.execute(`UPDATE ${T.server} SET metadata = ? WHERE virtual_machine_id = ?`, [
    JSON.stringify(metadata),
    vmId,
  ]);

/** The metadata of the server behind a VM, as stored at the last import or refresh. */
export async function readVmMetadata(
  db: Db,
  vmId: number,
): Promise<{ metadata: Record<string, string> }> {
  const { link } = await serverOfVm(db, vmId);
  return { metadata: storedMetadata(link.metadata) ?? {} };
}

/**
 * Make the metadata of the server behind a VM what `wanted` says: keys that differ are set,
 * keys that are missing are deleted. What OpenStack then holds is stored, and the VM's open pages
 * are told. Only the key names go to the VM's journal.
 */
export async function writeVmMetadata(
  db: Db,
  vmId: number,
  raw: unknown,
): Promise<{ metadata: Record<string, string> }> {
  const { link, cloud } = await serverOfVm(db, vmId);
  const current = await getServerMetadata(cloud, link.region, link.server_id);
  const wanted = parseMetadata(raw);
  const set = Object.fromEntries(Object.entries(wanted).filter(([k, v]) => current[k] !== v));
  const remove = Object.keys(current).filter((k) => !(k in wanted));
  if (Object.keys(set).length || remove.length) {
    await updateServerMetadata(cloud, link.region, link.server_id, set, remove);
    const parts = [
      Object.keys(set).length ? `set ${Object.keys(set).join(', ')}` : '',
      remove.length ? `removed ${remove.join(', ')}` : '',
    ].filter(Boolean);
    await journalVm(db, vmId, 'info', `Metadata updated: ${parts.join('; ')}.`);
  }
  const metadata = await getServerMetadata(cloud, link.region, link.server_id);
  await saveMetadata(db, vmId, metadata);
  await emitVm(db, vmId, 'updated');
  return { metadata };
}

/**
 * Push a VM's name to its OpenStack server. Paashup's name is the source of truth (set by the
 * generic edit of the VM); this only syncs Nova's own display name to match, so
 * `openstack server list` doesn't drift from it. It never touches the guest OS's own hostname.
 */
export async function renameVm(db: Db, vmId: number, name: string): Promise<void> {
  const { link, cloud } = await serverOfVm(db, vmId);
  await renameServer(cloud, link.region, link.server_id, name);
  await journalVm(db, vmId, 'info', `Renamed to "${name}" on OpenStack (region ${link.region}).`);
  await journal(db, cloud.id, 'info', `Server renamed to "${name}" in ${link.region}.`);
}

/**
 * Delete the OpenStack server behind a VM, whoever created it. A VM with no server behind it
 * is a 404.
 */
export async function deleteVm(db: Db, vmId: number, deleteVolumes = false): Promise<void> {
  const { link, cloud } = await serverOfVm(db, vmId);
  // every Cinder volume mirrored under this VM (the quick-flow one and any attached later from
  // the Volumes page): Nova detaches them when the server is deleted, but OpenStack never
  // deletes a volume on its own, so this is the one chance to also ask for that, if wanted.
  const volumeIds = (
    await db.query<{ volume_id: string }>(
      `SELECT DISTINCT v.volume_id FROM ${T.volume} v
         JOIN virtualization_virtual_disk d ON d.id = v.virtual_disk_id
        WHERE d.virtual_machine_id = ? AND v.cloud_id = ?`,
      [vmId, cloud.id],
    )
  ).map((r) => r.volume_id);

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
  void followDelete(db, cloud, link, volumeIds, deleteVolumes);
}

async function followDelete(
  db: Db,
  cloud: CloudRow,
  link: Link,
  volumeIds: string[],
  deleteVolumes: boolean,
): Promise<void> {
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
    if (!deleteVolumes) {
      // detach them from this VM in paashup's own records first: `dropServer` below deletes
      // every disk still pointing at this VM, and these should survive it, unattached
      for (const volumeId of volumeIds) await detachVolumeDisk(db, cloud.id, volumeId);
    }
    await dropServer(db, cloud.id, link.server_id); // the VM goes with its server
    await journal(db, cloud.id, 'success', `Server "${link.name}" deleted in ${link.region}.`);
    if (deleteVolumes) {
      for (const volumeId of volumeIds) await deleteDetachedVolume(db, cloud, link, volumeId);
    } else if (volumeIds.length) {
      await journal(
        db,
        cloud.id,
        'info',
        `${volumeIds.length} data volume(s) of "${link.name}" kept (detached, not deleted) in ${link.region}.`,
      );
    }
  } catch (e) {
    await journal(
      db,
      cloud.id,
      'danger',
      `Following the deletion of "${link.name}": ${messageOf(e)}`,
    );
  }
}

/**
 * Delete a volume once it is detached (Nova detaches it when its server is deleted, but
 * doesn't delete it on its own), so this waits for it to leave "in-use" first.
 */
async function deleteDetachedVolume(
  db: Db,
  cloud: CloudRow,
  link: Link,
  volumeId: string,
): Promise<void> {
  try {
    let status = await getVolumeState(cloud, link.region, volumeId);
    for (let waited = 0; status === 'in-use' && waited < POLL_LIMIT_MS; waited += POLL_MS) {
      await sleep(POLL_MS);
      status = await getVolumeState(cloud, link.region, volumeId);
    }
    if (status == null) return; // already gone
    await deleteVolume(cloud, link.region, volumeId);
    await journal(
      db,
      cloud.id,
      'success',
      `Data volume ${volumeId} of "${link.name}" deleted in ${link.region}.`,
    );
  } catch (e) {
    await journal(
      db,
      cloud.id,
      'warning',
      `Could not delete data volume ${volumeId} of "${link.name}": ${messageOf(e)}`,
    );
  }
}

/**
 * Grow the data volume of a VM to `sizeGb`. OpenStack (Cinder) can only grow a volume, never
 * shrink it: a size that is not strictly larger than the current one is the field-level 400.
 */
export async function resizeDataVolume(db: Db, vmId: number, sizeGb: number): Promise<void> {
  if (!Number.isInteger(sizeGb) || sizeGb < DATA_VOLUME_MIN_GB || sizeGb > DATA_VOLUME_MAX_GB) {
    throw fieldError(
      'size_gb',
      `Must be a whole number of GB between ${DATA_VOLUME_MIN_GB} and ${DATA_VOLUME_MAX_GB}.`,
    );
  }
  const { link, cloud } = await serverOfVm(db, vmId);
  if (!link.data_volume_id) throw fieldError('size_gb', 'This VM has no data volume.');
  const info = await getVolumeInfo(cloud, link.region, link.data_volume_id);
  if (!info) throw fieldError('size_gb', 'The data volume no longer exists on OpenStack.');
  if (sizeGb <= info.size) {
    throw fieldError(
      'size_gb',
      `Must be larger than the current size (${info.size} GB); OpenStack cannot shrink a volume.`,
    );
  }
  await resizeVolume(cloud, link.region, link.data_volume_id, sizeGb);
  await journalVm(
    db,
    vmId,
    'warning',
    `Data volume resize to ${sizeGb} GB requested in ${link.region}.`,
  );
  void followVolumeResize(db, cloud, link, vmId);
}

async function followVolumeResize(
  db: Db,
  cloud: CloudRow,
  link: Link,
  vmId: number,
): Promise<void> {
  const volumeId = link.data_volume_id!;
  try {
    let info = await getVolumeInfo(cloud, link.region, volumeId);
    for (
      let waited = 0;
      info?.status === 'extending' && waited < POLL_LIMIT_MS;
      waited += POLL_MS
    ) {
      await sleep(POLL_MS);
      info = await getVolumeInfo(cloud, link.region, volumeId);
    }
    if (!info) throw new Error(`volume ${volumeId} is gone`);
    if (info.status !== 'available' && info.status !== 'in-use') {
      throw new Error(`volume ${volumeId} ended up "${info.status}" instead of resized`);
    }
    const diskId = await upsertVolumeDisk(db, cloud, link.region, vmId, {
      id: volumeId,
      name: info.name,
      size: info.size,
    });
    await journalVm(db, vmId, 'success', `Data volume resized to ${info.size} GB.`);
    await journal(
      db,
      cloud.id,
      'success',
      `Data volume of "${link.name}" resized to ${info.size} GB in ${link.region}.`,
    );
    await journalDisk(db, diskId, 'success', `Resized to ${info.size} GB.`);
    await emitVm(db, vmId, 'updated');
  } catch (e) {
    const msg = `Resizing the data volume of "${link.name}": ${messageOf(e)}`;
    await journalVm(db, vmId, 'danger', msg);
    await journal(db, cloud.id, 'danger', msg);
  }
}

/**
 * Detach the data volume of a VM and delete it (paashup only ever created it to be that VM's
 * extra disk, so there is nothing useful left to keep once it is detached). A VM with none is
 * a 404.
 */
export async function removeDataVolume(db: Db, vmId: number, deleteVolume_ = false): Promise<void> {
  const { link, cloud } = await serverOfVm(db, vmId);
  if (!link.data_volume_id) throw new ApiError(404, 'This VM has no data volume.');
  await journalVm(db, vmId, 'warning', `Data volume detachment requested in ${link.region}.`);
  void followVolumeDetach(db, cloud, link, vmId, deleteVolume_);
}

async function followVolumeDetach(
  db: Db,
  cloud: CloudRow,
  link: Link,
  vmId: number,
  deleteVolume_: boolean,
): Promise<void> {
  const volumeId = link.data_volume_id!;
  const done = deleteVolume_ ? 'detached and deleted' : 'detached (kept)';
  const diskLink = await db.get<{ virtual_disk_id: number }>(
    `SELECT virtual_disk_id FROM ${T.volume} WHERE cloud_id = ? AND volume_id = ?`,
    [cloud.id, volumeId],
  );
  const diskId = diskLink?.virtual_disk_id ?? null;
  try {
    await detachVolume(cloud, link.region, link.server_id, volumeId);
    let status = await getVolumeState(cloud, link.region, volumeId);
    for (let waited = 0; status === 'detaching' && waited < POLL_LIMIT_MS; waited += POLL_MS) {
      await sleep(POLL_MS);
      status = await getVolumeState(cloud, link.region, volumeId);
    }
    if (deleteVolume_ && status != null) await deleteVolume(cloud, link.region, volumeId);
    await db.execute(
      `UPDATE ${T.server} SET data_volume_id = NULL WHERE cloud_id = ? AND server_id = ?`,
      [cloud.id, link.server_id],
    );
    if (diskId != null && !deleteVolume_) await journalDisk(db, diskId, 'success', `${done}.`);
    if (deleteVolume_) await removeVolumeDisk(db, cloud.id, volumeId);
    else await detachVolumeDisk(db, cloud.id, volumeId);
    await journalVm(db, vmId, 'success', `Data volume ${volumeId} ${done} in ${link.region}.`);
    await journal(
      db,
      cloud.id,
      'success',
      `Data volume ${volumeId} of "${link.name}" ${done} in ${link.region}.`,
    );
    await emitVm(db, vmId, 'updated');
  } catch (e) {
    const msg = `Detaching the data volume of "${link.name}": ${messageOf(e)}`;
    await journalVm(db, vmId, 'danger', msg);
    await journal(db, cloud.id, 'danger', msg);
    if (diskId != null) await journalDisk(db, diskId, 'danger', msg);
  }
}

/**
 * Reboot the OpenStack server behind a VM: "soft" asks the guest OS to shut down then boots it
 * again, "hard" power-cycles it without asking the guest (use when a soft reboot is stuck).
 */
export async function rebootVm(db: Db, vmId: number, type: 'soft' | 'hard'): Promise<void> {
  const { link, cloud } = await serverOfVm(db, vmId);

  await rebootServer(cloud, link.region, link.server_id, type.toUpperCase() as 'SOFT' | 'HARD');
  await journalVm(
    db,
    vmId,
    'warning',
    `${type === 'hard' ? 'Hard' : 'Soft'} reboot requested on OpenStack (region ${link.region}).`,
  );
  await journal(
    db,
    cloud.id,
    'warning',
    `${type === 'hard' ? 'Hard' : 'Soft'} reboot of server "${link.name}" requested in ${link.region}.`,
  );
  void followReboot(db, cloud, link, vmId);
}

/**
 * Poll the server behind a VM until it leaves the (hard-)reboot state. While it's still
 * rebooting, the VM is re-pushed to connected pages with a transient `_rebooting` hint (never
 * stored: paashup's VM status has no "rebooting" value) so the page can show it's in progress.
 * A journal entry on both ends the story once the outcome (active again, or something else) is
 * known, and a final plain push clears the hint either way.
 */
async function followReboot(db: Db, cloud: CloudRow, link: Link, vmId: number): Promise<void> {
  try {
    let settled: string | null = null;
    for (let waited = 0; waited < POLL_LIMIT_MS; waited += POLL_MS) {
      const state = await getServerState(cloud, link.region, link.server_id);
      if (!state) break; // the server is gone; nothing left to follow
      const upper = state.status.toUpperCase();
      if (upper !== 'REBOOT' && upper !== 'HARD_REBOOT') {
        settled = state.status;
        await db.execute(`UPDATE virtualization_virtual_machine SET status = ? WHERE id = ?`, [
          vmStatus(state.status),
          vmId,
        ]);
        break;
      }
      await emitVm(db, vmId, 'updated', { _rebooting: true });
      await sleep(POLL_MS);
    }
    if (settled === 'ACTIVE') {
      await journalVm(db, vmId, 'success', `Server "${link.name}" rebooted, active again.`);
      await journal(db, cloud.id, 'success', `Server "${link.name}" rebooted in ${link.region}.`);
    } else if (settled) {
      await journalVm(
        db,
        vmId,
        'danger',
        `Server "${link.name}" ended up "${settled}" after the reboot.`,
      );
      await journal(
        db,
        cloud.id,
        'danger',
        `Server "${link.name}" ended up "${settled}" after a reboot in ${link.region}.`,
      );
    } else {
      await journal(
        db,
        cloud.id,
        'warning',
        `Server "${link.name}" is still rebooting ${POLL_LIMIT_MS / 60_000} minutes after it was requested.`,
      );
    }
  } catch (e) {
    await journal(
      db,
      cloud.id,
      'danger',
      `Following the reboot of "${link.name}": ${messageOf(e)}`,
    );
  } finally {
    await emitVm(db, vmId, 'updated'); // clear the "rebooting" hint, whatever the outcome
  }
}

/**
 * Resize the OpenStack server behind a VM to another flavor. Nova only allows growing or
 * keeping the disk the same, never shrinking it — a flavor with a smaller disk is rejected by
 * OpenStack itself, so this is not checked here.
 */
export async function resizeVm(db: Db, vmId: number, flavorId: string): Promise<void> {
  const { link, cloud } = await serverOfVm(db, vmId);
  const flavor = (await listFlavors(cloud, link.region)).find((f) => f.id === flavorId);
  if (!flavor) throw fieldError('flavor_id', 'This flavor is not available in this region.');

  await resizeServer(cloud, link.region, link.server_id, flavorId);
  await journalVm(
    db,
    vmId,
    'warning',
    `Resize to "${flavor.name}" requested on OpenStack (region ${link.region}).`,
  );
  await journal(
    db,
    cloud.id,
    'warning',
    `Resize of server "${link.name}" to "${flavor.name}" requested in ${link.region}.`,
  );
  void followResize(db, cloud, link, vmId, flavor.name);
}

/**
 * Poll the server behind a VM until its resize settles. OpenStack moves it through RESIZE then
 * VERIFY_RESIZE, which needs an explicit confirm (keep the new flavor) or revert (undo); this
 * always confirms, since paashup doesn't offer a "try it, then decide" step. While in progress,
 * the VM is re-pushed with a transient `_resizing` hint (never stored). On success, the VM's
 * vcpus/memory/disk are refreshed from the new flavor via the same path used to follow a newly
 * created server; a journal entry on both ends the story, and a final plain push clears the hint.
 */
async function followResize(
  db: Db,
  cloud: CloudRow,
  link: Link,
  vmId: number,
  flavorName: string,
): Promise<void> {
  try {
    let settled: string | null = null;
    let confirmed = false;
    for (let waited = 0; waited < POLL_LIMIT_MS; waited += POLL_MS) {
      const state = await getServerState(cloud, link.region, link.server_id);
      if (!state) break; // the server is gone; nothing left to follow
      const upper = state.status.toUpperCase();
      if (upper !== 'RESIZE' && upper !== 'VERIFY_RESIZE') {
        settled = state.status;
        break;
      }
      if (upper === 'VERIFY_RESIZE' && !confirmed) {
        confirmed = true;
        await confirmResize(cloud, link.region, link.server_id);
      }
      await emitVm(db, vmId, 'updated', { _resizing: true });
      await sleep(POLL_MS);
    }
    if (settled === 'ACTIVE') {
      await importServer(db, cloud.id, link.region, link.server_id); // refreshes vcpus/memory/disk too
      await journalVm(db, vmId, 'success', `Server "${link.name}" resized to "${flavorName}".`);
      await journal(
        db,
        cloud.id,
        'success',
        `Server "${link.name}" resized to "${flavorName}" in ${link.region}.`,
      );
    } else if (settled) {
      await db.execute(`UPDATE virtualization_virtual_machine SET status = ? WHERE id = ?`, [
        vmStatus(settled),
        vmId,
      ]);
      await journalVm(
        db,
        vmId,
        'danger',
        `Server "${link.name}" ended up "${settled}" after the resize.`,
      );
      await journal(
        db,
        cloud.id,
        'danger',
        `Server "${link.name}" ended up "${settled}" after a resize to "${flavorName}" in ${link.region}.`,
      );
    } else {
      await journal(
        db,
        cloud.id,
        'warning',
        `Server "${link.name}" is still resizing ${POLL_LIMIT_MS / 60_000} minutes after it was requested.`,
      );
    }
  } catch (e) {
    await journal(
      db,
      cloud.id,
      'danger',
      `Following the resize of "${link.name}": ${messageOf(e)}`,
    );
  } finally {
    await emitVm(db, vmId, 'updated'); // clear the "resizing" hint, whatever the outcome
  }
}

/** The OpenStack server behind each VM (or one VM's), for the UI. */
export async function listLinks(db: Db, vmId?: number): Promise<Record<string, unknown>[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT s.virtual_machine_id, s.cloud_id, c.name AS cloud, s.region, s.server_id,
            s.metadata, s.data_volume_id
       FROM ${T.server} s JOIN ${T.cloud} c ON c.id = s.cloud_id
      ${vmId != null ? 'WHERE s.virtual_machine_id = ?' : ''} ORDER BY s.id`,
    vmId != null ? [vmId] : [],
  );
  return rows.map((r) => ({ ...r, metadata: storedMetadata(r.metadata) }));
}

/**
 * The virtual disk of each data volume paashup created and attached (or one VM's), for the
 * Volumes page: which disks are OpenStack-managed, so it can offer resize/detach there instead
 * of the plain record form.
 */
export async function listVolumeLinks(db: Db, vmId?: number): Promise<Record<string, unknown>[]> {
  return db.query<Record<string, unknown>>(
    `SELECT d.id AS virtual_disk_id, s.virtual_machine_id, c.name AS cloud, s.region,
            s.data_volume_id AS volume_id
       FROM ${T.server} s
       JOIN ${T.cloud} c ON c.id = s.cloud_id
       JOIN ${T.volume} v ON v.cloud_id = s.cloud_id AND v.volume_id = s.data_volume_id
       JOIN virtualization_virtual_disk d ON d.id = v.virtual_disk_id
      WHERE s.data_volume_id IS NOT NULL
        ${vmId != null ? 'AND s.virtual_machine_id = ?' : ''}
      ORDER BY d.id`,
    vmId != null ? [vmId] : [],
  );
}
