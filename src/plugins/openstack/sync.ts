// Cloud → datamodel synchronisation. Authenticates against the cloud, discovers its
// regions from the Keystone catalogue, then mirrors each region into the core
// virtualization / IPAM tables:
//   region            → dcim_region + dcim_site + virtualization_cluster (type "OpenStack"),
//                       one of each per region; the cluster is scoped to the site
//   Nova keypair      → virtualization_ssh_key (public key only; the same key in several regions = one row)
//   server's image    → virtualization_image (by name, only images in use; id not stored)
//   server's flavor   → virtualization_virtual_machine_type (by name, only flavors in use)
//   Nova server       → virtualization_virtual_machine (+ vminterface per network)
//   server addresses  → ipam_ipaddress assigned to the vminterface, primary_ip4/6 set
//   Cinder volume     → virtualization_virtual_disk of the server it is attached to
// OpenStack ids are kept in the plugin's link tables so a later sync updates in place
// and a server deleted in OpenStack is removed here. A region that fails is reported
// and skipped — its existing data is left untouched. Every step only reads from the
// cloud; nothing is created or deleted on the OpenStack side.
import type { Db } from '../../db/types.js';
import { Repository } from '../../repository/repository.js';
import { getTable } from '../../model/registry.js';
import { Serializer } from '../../api/serializer.js';
import { broadcast } from '../../realtime.js';
import { fireHooks } from '../runtime.js';
import { ValidationError } from '../../errors.js';
import { SSH_PUBLIC_KEY } from '../../repository/validate.js';
import { createHash } from 'node:crypto';
import { META, T } from './meta.js';
import { emitVm } from './events.js';
import { journal } from './journal.js';
import {
  authenticate,
  computeRegions,
  getImageName,
  getServer,
  listImageNames,
  listKeypairs,
  listServers,
  listVolumes,
  OpenStackError,
  type CloudConfig,
  type Keypair,
  type Server,
  type Volume,
} from './openstack.js';

type Row = Record<string, unknown>;

interface CloudRow extends CloudConfig {
  id: number;
  name: string;
}

interface RegionResult {
  region: string;
  servers: number;
  disks: number;
  /** volumes not imported: a virtual disk needs a VM, so unattached volumes are skipped */
  unattached: number;
  warnings: string[];
  /** time spent reading the region from OpenStack */
  fetchMs: number;
}

const VM_STATUS: Record<string, string> = {
  ACTIVE: 'active',
  BUILD: 'planned',
  REBUILD: 'planned',
  RESIZE: 'active',
  VERIFY_RESIZE: 'active',
  REBOOT: 'active',
  HARD_REBOOT: 'active',
  PAUSED: 'paused',
  SUSPENDED: 'paused',
  SHUTOFF: 'offline',
  STOPPED: 'offline',
  SHELVED: 'offline',
  SHELVED_OFFLOADED: 'offline',
  ERROR: 'failed',
  DELETING: 'decommissioning',
};
const vmStatus = (openstackStatus: string): string =>
  VM_STATUS[openstackStatus.toUpperCase()] ?? 'offline';

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const running = new Set<number>();
export const isSyncing = (cloudId: number): boolean => running.has(cloudId);

/**
 * Run `fn` while no other sync of this cloud runs, waiting for a running one first; a full
 * sync asked meanwhile is ignored, like when one is already running.
 */
async function exclusive<T>(cloudId: number, fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i < 240 && running.has(cloudId); i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (running.has(cloudId)) {
    throw new OpenStackError('A synchronization of this cloud is taking too long.');
  }
  running.add(cloudId);
  try {
    return await fn();
  } finally {
    running.delete(cloudId);
  }
}

/**
 * Import (or update) one server as a VM without reading the whole cloud: its interfaces, IPs,
 * flavor and image come out as in a full sync, but nothing else is read
 * or removed. Returns the VM's id, or null when the server does not exist (any more).
 * Used to follow a server paasbox creates; volumes are left to the next full sync.
 */
export async function importServer(
  db: Db,
  cloudId: number,
  region: string,
  serverId: string,
): Promise<number | null> {
  const cloud = await db.get<CloudRow>(`SELECT * FROM ${T.cloud} WHERE id = ?`, [cloudId]);
  if (!cloud) return null;
  const server = await getServer(cloud, region, serverId);
  if (!server) return null;
  const imageName = server.imageId
    ? await getImageName(cloud, region, server.imageId).catch(() => null)
    : null;
  return exclusive(cloudId, async () => {
    const existed = !!(await db.get(
      `SELECT id FROM ${T.server} WHERE cloud_id = ? AND server_id = ?`,
      [cloudId, server.id],
    ));
    const siteId = await ensureSite(db, cloud, region);
    const clusterId = await ensureCluster(db, cloud, region, siteId);
    const { byServer } = await syncServers(
      db,
      cloud,
      region,
      clusterId,
      siteId,
      {
        servers: [server],
        imageNames: imageName && server.imageId ? new Map([[server.imageId, imageName]]) : null,
        volumes: null,
        keypairs: null,
        fetchMs: 0,
      },
      false,
    );
    const vmId = byServer.get(server.id) ?? null;
    if (vmId != null) await emitVm(db, vmId, existed ? 'updated' : 'created');
    return vmId;
  });
}

/** Remove the VM of a server that is gone from the cloud (with its IPs, interfaces, disks). */
export async function dropServer(db: Db, cloudId: number, serverId: string): Promise<void> {
  await exclusive(cloudId, async () => {
    const link = await db.get<{ virtual_machine_id: number }>(
      `SELECT virtual_machine_id FROM ${T.server} WHERE cloud_id = ? AND server_id = ?`,
      [cloudId, serverId],
    );
    if (link) {
      const vmId = Number(link.virtual_machine_id);
      await removeVm(db, vmId, true);
      const left = await db.get(`SELECT id FROM virtualization_virtual_machine WHERE id = ?`, [
        vmId,
      ]);
      await emitVm(db, vmId, left ? 'updated' : 'deleted');
    }
    await cleanupTypes(db);
    await cleanupImages(db);
  });
}

/** Push the cloud's current state to the realtime feed so open pages update. */
async function emit(db: Db, cloudId: number): Promise<void> {
  const row = await new Repository<Row>(db, getTable(T.cloud)!).retrieve(cloudId);
  if (!row) return;
  const data = await new Serializer(db, process.env.BASE_URL ?? '').object(T.cloud, row);
  broadcast({
    type: 'change',
    event: 'updated',
    object_type: META.cloud.objectType,
    table: T.cloud,
    id: cloudId,
    data,
  });
}

async function setState(
  db: Db,
  cloudId: number,
  state: string,
  error: string | null,
  synced = false,
): Promise<void> {
  await db.execute(
    `UPDATE ${T.cloud} SET state = ?, error = ?, operation = 'none'${
      synced ? ', last_synced = ?' : ''
    } WHERE id = ?`,
    synced ? [state, error, new Date().toISOString(), cloudId] : [state, error, cloudId],
  );
  await emit(db, cloudId);
}

/**
 * Run a full sync for one cloud (every region). Never throws: the outcome is recorded
 * on the cloud (`state` connected|error and `error`) and in the journal. A second call
 * while one is running is ignored.
 */
export async function syncCloud(db: Db, cloudId: number): Promise<void> {
  if (running.has(cloudId)) return;
  running.add(cloudId);
  try {
    const cloud = await db.get<CloudRow>(`SELECT * FROM ${T.cloud} WHERE id = ?`, [cloudId]);
    if (!cloud) return;
    await setState(db, cloudId, 'refreshing', null);
    try {
      const regions = computeRegions(await authenticate(cloud, true));
      if (!regions.length) throw new OpenStackError('No region with a compute service found');

      const done: RegionResult[] = [];
      const failed: string[] = [];
      const keys = new Set<number>();
      let keysComplete = true;

      const fetched = await mapLimit(regions, FETCH_CONCURRENCY, (region) =>
        fetchRegion(cloud, region),
      );
      for (const [i, region] of regions.entries()) {
        const data = fetched[i]!;
        try {
          if (data instanceof Error) throw data;
          done.push(await syncRegion(db, cloud, region, data));
          if (data.keypairs)
            for (const id of await importKeypairs(db, cloudId, data.keypairs)) keys.add(id);
          else keysComplete = false;
          await db.execute(
            `UPDATE ${T.region} SET error = NULL, last_synced = ? WHERE cloud_id = ? AND name = ?`,
            [new Date().toISOString(), cloudId, region],
          );
        } catch (e) {
          const message = messageOf(e).slice(0, 2000);
          failed.push(`${region}: ${message}`);
          await db.execute(`UPDATE ${T.region} SET error = ? WHERE cloud_id = ? AND name = ?`, [
            message,
            cloudId,
            region,
          ]);
        }
      }

      if (!done.length) throw new OpenStackError(`Every region failed. ${failed.join(' | ')}`);
      if (keysComplete && !failed.length) await pruneKeys(db, cloudId, keys);
      await cleanupTypes(db);
      await cleanupImages(db);
      await cleanupGeography(db);
      await linkDockerHosts(db);
      await setState(db, cloudId, 'connected', failed.length ? failed.join(' | ') : null, true);
      await journal(db, cloudId, failed.length ? 'warning' : 'success', summary(done, failed));
    } catch (e) {
      const message = messageOf(e).slice(0, 4000);
      await setState(db, cloudId, 'error', message);
      await journal(db, cloudId, 'danger', `Synchronization failed: ${message}`);
    }
  } catch {
    /* the cloud was deleted mid-sync, or the database is gone: nothing left to report to */
  } finally {
    running.delete(cloudId);
  }
}

function summary(done: RegionResult[], failed: string[]): string {
  const lines = done.map((r) => {
    const extra = [
      r.unattached
        ? `${r.unattached} unattached volume${r.unattached === 1 ? '' : 's'} not imported`
        : '',
      ...r.warnings,
    ].filter(Boolean);
    return `${r.region}: ${r.servers} servers, ${r.disks} disks${
      extra.length ? ` (${extra.join('; ')})` : ''
    } [${(r.fetchMs / 1000).toFixed(1)}s]`;
  });
  const head = `Synchronized ${done.length} region${done.length === 1 ? '' : 's'}.`;
  const bad = failed.length ? ` Failed: ${failed.join(' | ')}` : '';
  return `${head} ${lines.join(' — ')}.${bad}`;
}

const FETCH_CONCURRENCY = 4;

/** `fn` over `items`, at most `limit` at a time; a rejection becomes the Error in its slot. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<(R | Error)[]> {
  const out: (R | Error)[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]!);
      } catch (e) {
        out[i] = e instanceof Error ? e : new Error(String(e));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

interface RegionData {
  servers: Server[];
  imageNames: Map<string, string> | null;
  volumes: Volume[] | { error: string } | null;
  keypairs: Keypair[] | null;
  fetchMs: number;
}

async function fetchRegion(cloud: CloudRow, region: string): Promise<RegionData> {
  const t0 = Date.now();
  const [servers, imageNames, volumes, keypairs] = await Promise.all([
    listServers(cloud, region),
    listImageNames(cloud, region).catch(() => null),
    listVolumes(cloud, region).catch((e: unknown) =>
      e instanceof OpenStackError && e.status === undefined && /not available/.test(e.message)
        ? null
        : { error: messageOf(e) },
    ),
    listKeypairs(cloud, region).catch(() => null),
  ]);
  return { servers, imageNames, volumes, keypairs, fetchMs: Date.now() - t0 };
}

async function syncRegion(
  db: Db,
  cloud: CloudRow,
  region: string,
  data: RegionData,
): Promise<RegionResult> {
  const siteId = await ensureSite(db, cloud, region);
  const clusterId = await ensureCluster(db, cloud, region, siteId);
  const servers = await syncServers(db, cloud, region, clusterId, siteId, data);

  const result: RegionResult = {
    region,
    servers: servers.byServer.size,
    disks: 0,
    unattached: 0,
    warnings: [],
    fetchMs: data.fetchMs,
  };
  if (data.volumes && 'error' in data.volumes) {
    result.warnings.push(`volumes skipped: ${data.volumes.error}`);
  } else if (data.volumes) {
    const v = await syncVolumes(db, cloud, region, servers.byServer, data.volumes);
    result.disks = v.disks;
    result.unattached = v.unattached;
  }
  return result;
}

/** The cluster of a region, created on first sight and scoped to the region's site. */
async function ensureCluster(
  db: Db,
  cloud: CloudRow,
  region: string,
  siteId: number,
): Promise<number> {
  const id = await clusterOf(db, cloud, region);
  await db.execute(
    `UPDATE virtualization_cluster SET scope_type = 'dcim.site', scope_id = ? WHERE id = ?`,
    [siteId, id],
  );
  return id;
}

async function clusterOf(db: Db, cloud: CloudRow, region: string): Promise<number> {
  const known = await db.get<{ id: number; cluster_id: number | null }>(
    `SELECT r.id, r.cluster_id FROM ${T.region} r
       JOIN virtualization_cluster c ON c.id = r.cluster_id
      WHERE r.cloud_id = ? AND r.name = ?`,
    [cloud.id, region],
  );
  if (known?.cluster_id != null) return Number(known.cluster_id);

  const type =
    (await db.get<{ id: number }>(
      `SELECT id FROM virtualization_cluster_type WHERE slug = 'openstack'`,
    )) ??
    (await (async () => {
      const r = await db.execute(
        `INSERT INTO virtualization_cluster_type (name, slug) VALUES ('OpenStack', 'openstack')`,
      );
      return { id: r.insertId };
    })());
  const name = `${cloud.name} (${region})`.slice(0, 100);
  const existing = await db.get<{ id: number }>(
    `SELECT id FROM virtualization_cluster WHERE name = ? AND type_id = ?`,
    [name, type.id],
  );
  const id = Number(
    existing?.id ??
      (
        await db.execute(
          `INSERT INTO virtualization_cluster (name, type_id, status) VALUES (?, ?, 'active')`,
          [name, type.id],
        )
      ).insertId,
  );
  const row = await db.get<{ id: number }>(
    `SELECT id FROM ${T.region} WHERE cloud_id = ? AND name = ?`,
    [cloud.id, region],
  );
  if (row) await db.execute(`UPDATE ${T.region} SET cluster_id = ? WHERE id = ?`, [id, row.id]);
  else {
    await db.execute(`INSERT INTO ${T.region} (cloud_id, name, cluster_id) VALUES (?, ?, ?)`, [
      cloud.id,
      region,
      id,
    ]);
  }
  return id;
}

/** A slug for a new VM type, region or site that no other row of that table uses. */
async function uniqueSlug(
  db: Db,
  table: 'virtualization_virtual_machine_type' | 'dcim_region' | 'dcim_site',
  base: string,
  fallback: string,
): Promise<string> {
  const root = slugify(base) || fallback;
  for (let i = 1; ; i++) {
    const slug = i === 1 ? root : `${root.slice(0, 95)}-${i}`;
    const taken = await db.get(`SELECT id FROM ${table} WHERE slug = ?`, [slug]);
    if (!taken) return slug;
  }
}

/** Marks the VM types the import created. */
const TYPE_DESCRIPTION = 'OpenStack flavor';

type FlavorInfo = NonNullable<Server['flavor']>;

/**
 * The VM type for a flavor, by name: reused if it exists (its sizes are left alone —
 * each VM carries its own vCPU/RAM/disk), created otherwise. Only flavors that a server
 * actually runs on get a type; the full flavor list stays a live read for pickers.
 */
async function ensureType(db: Db, f: FlavorInfo, cache: Map<string, number>): Promise<number> {
  const key = f.name.toLowerCase();
  const hit = cache.get(key);
  if (hit != null) return hit;
  const name = f.name.slice(0, 100);
  const existing = await db.get<{ id: number }>(
    `SELECT id FROM virtualization_virtual_machine_type WHERE lower(name) = lower(?)`,
    [name],
  );
  const id = Number(
    existing?.id ??
      (
        await db.execute(
          `INSERT INTO virtualization_virtual_machine_type
             (name, slug, default_vcpus, default_memory, description) VALUES (?, ?, ?, ?, ?)`,
          [
            name,
            await uniqueSlug(db, 'virtualization_virtual_machine_type', f.name, 'flavor'),
            f.vcpus,
            f.ram,
            `${TYPE_DESCRIPTION} ${f.name}: ${f.vcpus} vCPU, ${f.ram} MB RAM, ${f.disk} GB root disk`,
          ],
        )
      ).insertId,
  );
  cache.set(key, id);
  return id;
}

/** Drop the types the import created that no VM uses any more. */
async function cleanupTypes(db: Db): Promise<void> {
  await db.execute(
    `DELETE FROM virtualization_virtual_machine_type
      WHERE description LIKE ?
        AND NOT EXISTS (SELECT 1 FROM virtualization_virtual_machine v
                         WHERE v.virtual_machine_type_id = virtualization_virtual_machine_type.id)`,
    [`${TYPE_DESCRIPTION} %`],
  );
}

/**
 * The image row for an image name: reused if one has that name, created otherwise (marked
 * as imported from this cloud). Only images a server booted from get a row; the OpenStack
 * image id is not stored.
 */
async function ensureImage(
  db: Db,
  cloudId: number,
  name: string,
  cache: Map<string, number>,
): Promise<number> {
  const key = name.toLowerCase();
  const hit = cache.get(key);
  if (hit != null) return hit;
  const trimmed = name.slice(0, 255);
  const existing = await db.get<{ id: number }>(
    `SELECT id FROM virtualization_image WHERE lower(name) = lower(?)`,
    [trimmed],
  );
  const id = Number(
    existing?.id ??
      (
        await db.execute(
          `INSERT INTO virtualization_image (name, source_type, source_id) VALUES (?, ?, ?)`,
          [trimmed, META.cloud.objectType, cloudId],
        )
      ).insertId,
  );
  cache.set(key, id);
  return id;
}

/** Drop the images an import created that no VM uses any more. */
async function cleanupImages(db: Db): Promise<void> {
  await db.execute(
    `DELETE FROM virtualization_image
      WHERE source_type = ?
        AND NOT EXISTS (SELECT 1 FROM virtualization_virtual_machine v WHERE v.image_id = virtualization_image.id)`,
    [META.cloud.objectType],
  );
}

const GEO_DESCRIPTION = 'OpenStack region';

/**
 * The DCIM site of an OpenStack region, and the region above it, created on first sight
 * (a region of that name is reused). Returns the site id.
 */
async function ensureSite(db: Db, cloud: CloudRow, region: string): Promise<number> {
  const regionName = region.slice(0, 100);
  const dcimRegion =
    (await db.get<{ id: number }>(
      `SELECT id FROM dcim_region WHERE lower(name) = lower(?) AND parent_id IS NULL`,
      [regionName],
    )) ??
    (await (async () => {
      const r = await db.execute(
        `INSERT INTO dcim_region (name, slug, description) VALUES (?, ?, ?)`,
        [regionName, await uniqueSlug(db, 'dcim_region', region, 'region'), GEO_DESCRIPTION],
      );
      return { id: Number(r.insertId) };
    })());
  const siteName = `${cloud.name} (${region})`.slice(0, 100);
  const site = await db.get<{ id: number; region_id: number | null }>(
    `SELECT id, region_id FROM dcim_site WHERE lower(name) = lower(?)`,
    [siteName],
  );
  if (site) {
    if (site.region_id == null) {
      await db.execute(`UPDATE dcim_site SET region_id = ? WHERE id = ?`, [dcimRegion.id, site.id]);
    }
    return Number(site.id);
  }
  return Number(
    (
      await db.execute(
        `INSERT INTO dcim_site (name, slug, status, region_id, description) VALUES (?, ?, 'active', ?, ?)`,
        [
          siteName,
          await uniqueSlug(db, 'dcim_site', siteName, 'site'),
          dcimRegion.id,
          GEO_DESCRIPTION,
        ],
      )
    ).insertId,
  );
}

/** Drop the sites, then the regions, the import created that nothing uses any more. */
async function cleanupGeography(db: Db): Promise<void> {
  await db.execute(
    `DELETE FROM dcim_site
      WHERE description = ?
        AND NOT EXISTS (SELECT 1 FROM virtualization_cluster c WHERE c.scope_type = 'dcim.site' AND c.scope_id = dcim_site.id)
        AND NOT EXISTS (SELECT 1 FROM virtualization_virtual_machine v WHERE v.site_id = dcim_site.id)
        AND NOT EXISTS (SELECT 1 FROM dcim_device d WHERE d.site_id = dcim_site.id)`,
    [GEO_DESCRIPTION],
  );
  await db.execute(
    `DELETE FROM dcim_region
      WHERE description = ?
        AND NOT EXISTS (SELECT 1 FROM dcim_site s WHERE s.region_id = dcim_region.id)
        AND NOT EXISTS (SELECT 1 FROM dcim_region r WHERE r.parent_id = dcim_region.id)`,
    [GEO_DESCRIPTION],
  );
}

/** A VM name no other VM of the cluster uses (Nova allows duplicate names, NetBox doesn't). */
async function uniqueVmName(
  db: Db,
  name: string,
  serverId: string,
  clusterId: number,
  selfId?: number,
): Promise<string> {
  const base = name.slice(0, 64);
  const clash = await db.get(
    `SELECT id FROM virtualization_virtual_machine
      WHERE lower(name) = lower(?) AND cluster_id = ? AND id <> ?`,
    [base, clusterId, selfId ?? 0],
  );
  return clash ? `${base.slice(0, 55)}-${serverId.slice(0, 8)}` : base;
}

async function syncServers(
  db: Db,
  cloud: CloudRow,
  region: string,
  clusterId: number,
  siteId: number,
  data: RegionData,
  prune = true,
): Promise<{ byServer: Map<string, number> }> {
  const servers = data.servers;
  const links = await db.query<{ server_id: string; virtual_machine_id: number }>(
    `SELECT server_id, virtual_machine_id FROM ${T.server} WHERE cloud_id = ? AND region = ?`,
    [cloud.id, region],
  );
  const known = new Map(links.map((l) => [l.server_id, Number(l.virtual_machine_id)]));
  const byServer = new Map<string, number>();
  const types = new Map<string, number>(); // flavor name → type id, for this pass
  const images = new Map<string, number>(); // image name → image id, for this pass
  const imageNames = data.imageNames;

  for (const s of servers) {
    const flavor = s.flavor;
    const typeId = flavor ? await ensureType(db, flavor, types) : null;
    const imageName = s.imageId ? imageNames?.get(s.imageId) : undefined;
    const imageId = imageName ? await ensureImage(db, cloud.id, imageName, images) : null;
    let vmId = known.get(s.id);
    const status = vmStatus(s.status);

    if (vmId == null) {
      // A VM of that name already in the cluster and not linked to a server (the cloud was
      // removed and added again): adopt it rather than create a duplicate.
      const orphan = await db.get<{ id: number }>(
        `SELECT id FROM virtualization_virtual_machine
          WHERE lower(name) = lower(?) AND cluster_id = ?
            AND id NOT IN (SELECT virtual_machine_id FROM ${T.server})`,
        [s.name.slice(0, 64), clusterId],
      );
      vmId = orphan ? Number(orphan.id) : undefined;
    }
    const name = await uniqueVmName(db, s.name, s.id, clusterId, vmId);
    if (vmId != null) {
      await db.execute(
        `UPDATE virtualization_virtual_machine
            SET name = ?, status = ?, virtual_machine_type_id = ?, vcpus = ?, memory = ?, disk = ?,
                cluster_id = ?, site_id = ?, image_id = ${imageNames ? '?' : 'image_id'}
          WHERE id = ?`,
        [
          name,
          status,
          typeId,
          flavor?.vcpus ?? null,
          flavor?.ram ?? null,
          flavor?.disk ?? null,
          clusterId,
          siteId,
          ...(imageNames ? [imageId] : []),
          vmId,
        ],
      );
    } else {
      vmId = Number(
        (
          await db.execute(
            `INSERT INTO virtualization_virtual_machine
               (name, status, virtual_machine_type_id, vcpus, memory, disk, cluster_id, site_id, image_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              name,
              status,
              typeId,
              flavor?.vcpus ?? null,
              flavor?.ram ?? null,
              flavor?.disk ?? null,
              clusterId,
              siteId,
              imageId,
            ],
          )
        ).insertId,
      );
    }
    const metadata = JSON.stringify(s.metadata ?? {});
    if (!known.has(s.id)) {
      await db.execute(
        `INSERT INTO ${T.server} (cloud_id, region, server_id, virtual_machine_id, metadata) VALUES (?, ?, ?, ?, ?)`,
        [cloud.id, region, s.id, vmId, metadata],
      );
    } else {
      // metadata can change in OpenStack at any time: keep what was last seen
      await db.execute(`UPDATE ${T.server} SET metadata = ? WHERE cloud_id = ? AND server_id = ?`, [
        metadata,
        cloud.id,
        s.id,
      ]);
    }
    byServer.set(s.id, vmId);
    await syncAddresses(db, vmId, s);
  }

  // Servers deleted in OpenStack: remove their VM (disks, interfaces and IPs first). Not
  // when only some of the region's servers were read (see importServer).
  if (prune) {
    for (const [serverId, vmId] of known) {
      if (!byServer.has(serverId)) await removeVm(db, vmId);
    }
  }
  return { byServer };
}

/** One vminterface per OpenStack network, one ipam_ipaddress per address. */
async function syncAddresses(db: Db, vmId: number, server: Server): Promise<void> {
  const wantedIfaces = new Set(Object.keys(server.addresses));
  const ifaces = await db.query<{ id: number; name: string }>(
    `SELECT id, name FROM virtualization_vminterface WHERE virtual_machine_id = ?`,
    [vmId],
  );
  const ifaceId = new Map(ifaces.map((i) => [i.name, Number(i.id)]));

  const keep = new Set<number>(); // ipam_ipaddress ids still present
  let primary4: { id: number; floating: boolean } | undefined;
  let primary6: number | undefined;

  for (const [net, addrs] of Object.entries(server.addresses)) {
    let ifId = ifaceId.get(net);
    if (ifId == null) {
      ifId = Number(
        (
          await db.execute(
            `INSERT INTO virtualization_vminterface (virtual_machine_id, name, enabled) VALUES (?, ?, 1)`,
            [vmId, net.slice(0, 64)],
          )
        ).insertId,
      );
      ifaceId.set(net, ifId);
    }
    for (const a of addrs) {
      const address = `${a.addr}/${a.version === 6 ? 128 : 32}`;
      const found = await db.get<{ id: number }>(
        `SELECT id FROM ipam_ipaddress
          WHERE address = ? AND assigned_object_type = 'virtualization.vminterface' AND assigned_object_id = ?`,
        [address, ifId],
      );
      const ipId =
        found?.id ??
        (
          await db.execute(
            `INSERT INTO ipam_ipaddress (address, status, assigned_object_type, assigned_object_id)
             VALUES (?, 'active', 'virtualization.vminterface', ?)`,
            [address, ifId],
          )
        ).insertId;
      keep.add(Number(ipId));
      const floating = a.type === 'floating';
      if (a.version === 6) primary6 ??= Number(ipId);
      else if (!primary4 || (floating && !primary4.floating)) {
        primary4 = { id: Number(ipId), floating };
      }
    }
  }

  await db.execute(
    `UPDATE virtualization_virtual_machine SET primary_ip4_id = ?, primary_ip6_id = ? WHERE id = ?`,
    [primary4?.id ?? null, primary6 ?? null, vmId],
  );

  // Stale addresses / interfaces (detached in OpenStack).
  for (const [name, id] of ifaceId) {
    const stale = await db.query<{ id: number }>(
      `SELECT id FROM ipam_ipaddress
        WHERE assigned_object_type = 'virtualization.vminterface' AND assigned_object_id = ?`,
      [id],
    );
    for (const ip of stale) {
      if (!keep.has(Number(ip.id))) {
        await db.execute(`DELETE FROM ipam_ipaddress WHERE id = ?`, [ip.id]);
      }
    }
    if (!wantedIfaces.has(name)) {
      await db.execute(`DELETE FROM virtualization_vminterface WHERE id = ?`, [id]);
    }
  }
}

/** Mirror Cinder volumes attached to imported servers as virtual disks (size in GB). */
async function syncVolumes(
  db: Db,
  cloud: CloudRow,
  region: string,
  byServer: Map<string, number>,
  volumes: Volume[],
): Promise<{ disks: number; unattached: number }> {
  const links = await db.query<{ volume_id: string; virtual_disk_id: number }>(
    `SELECT volume_id, virtual_disk_id FROM ${T.volume} WHERE cloud_id = ? AND region = ?`,
    [cloud.id, region],
  );
  const known = new Map(links.map((l) => [l.volume_id, Number(l.virtual_disk_id)]));
  const kept = new Set<string>();
  let unattached = 0;

  for (const v of volumes) {
    const att = v.attachments.find((a) => byServer.has(a.serverId));
    if (!att) {
      unattached++;
      continue;
    }
    const vmId = byServer.get(att.serverId)!;
    const description = `OpenStack volume ${v.id}${att.device ? ` (${att.device})` : ''}`;
    let diskId = known.get(v.id);

    if (diskId != null) {
      await db.execute(
        `UPDATE virtualization_virtual_disk
            SET virtual_machine_id = ?, name = ?, size = ?, description = ? WHERE id = ?`,
        [vmId, await diskName(db, v, vmId, diskId), v.size, description, diskId],
      );
    } else {
      diskId = Number(
        (
          await db.execute(
            `INSERT INTO virtualization_virtual_disk (virtual_machine_id, name, size, description)
             VALUES (?, ?, ?, ?)`,
            [vmId, await diskName(db, v, vmId), v.size, description],
          )
        ).insertId,
      );
      await db.execute(
        `INSERT INTO ${T.volume} (cloud_id, region, volume_id, virtual_disk_id) VALUES (?, ?, ?, ?)`,
        [cloud.id, region, v.id, diskId],
      );
    }
    kept.add(v.id);
  }

  // Volumes detached or deleted: drop their disk (the link goes with it).
  for (const [volumeId, diskId] of known) {
    if (!kept.has(volumeId)) {
      await db.execute(`DELETE FROM virtualization_virtual_disk WHERE id = ?`, [diskId]);
    }
  }
  return { disks: kept.size, unattached };
}

/** Volume name, made unique among the VM's disks. */
async function diskName(
  db: Db,
  v: { id: string; name: string },
  vmId: number,
  selfId?: number,
): Promise<string> {
  const base = (v.name || `volume-${v.id.slice(0, 8)}`).slice(0, 64);
  const clash = await db.get(
    `SELECT id FROM virtualization_virtual_disk
      WHERE virtual_machine_id = ? AND lower(name) = lower(?) AND id <> ?`,
    [vmId, base, selfId ?? 0],
  );
  return clash ? `${base.slice(0, 55)}-${v.id.slice(0, 8)}` : base;
}

/** Delete a VM with everything hanging off it (IPs, interfaces, disks). Throws if it is still referenced. */
export async function deleteVm(tx: Db, vmId: number): Promise<void> {
  await tx.execute(
    `UPDATE virtualization_virtual_machine SET primary_ip4_id = NULL, primary_ip6_id = NULL WHERE id = ?`,
    [vmId],
  );
  await tx.execute(
    `DELETE FROM ipam_ipaddress WHERE assigned_object_type = 'virtualization.vminterface'
       AND assigned_object_id IN (SELECT id FROM virtualization_vminterface WHERE virtual_machine_id = ?)`,
    [vmId],
  );
  await tx.execute(`DELETE FROM virtualization_virtual_disk WHERE virtual_machine_id = ?`, [vmId]);
  await tx.execute(`DELETE FROM virtualization_vminterface WHERE virtual_machine_id = ?`, [vmId]);
  await tx.execute(`DELETE FROM virtualization_virtual_machine WHERE id = ?`, [vmId]);
}

/**
 * Delete a VM that no longer exists in OpenStack; if something still references it, mark it
 * offline. With `withHosts`, the Docker host on it is deleted first.
 */
async function removeVm(db: Db, vmId: number, withHosts = false): Promise<void> {
  try {
    // a VM deleted from paasbox takes its Docker host with it; one that merely disappeared
    // from the cloud (a sync) keeps the host, which just loses its link
    if (withHosts) await fireHooks(db, 'virtualization_virtual_machine', 'deleting', vmId);
    await db.transaction((tx) => deleteVm(tx, vmId));
  } catch {
    await db.execute(`UPDATE virtualization_virtual_machine SET status = 'offline' WHERE id = ?`, [
      vmId,
    ]);
  }
}

/**
 * Remove everything a cloud imported, in one transaction: its VMs (with IPs, interfaces
 * and disks), the flavor types nothing else uses, its clusters once empty, and the sites / regions / images the import created that nothing uses. The shared "OpenStack"
 * cluster type is kept. Throws, changing nothing, if an imported VM is still referenced
 * elsewhere (e.g. by a Docker host).
 */
export async function purgeCloud(db: Db, cloudId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const vms = await tx.query<{ id: number; name: string }>(
      `SELECT v.id, v.name FROM virtualization_virtual_machine v
         JOIN ${T.server} s ON s.virtual_machine_id = v.id WHERE s.cloud_id = ?`,
      [cloudId],
    );
    for (const vm of vms) {
      try {
        await deleteVm(tx, vm.id);
      } catch {
        throw new ValidationError(
          `Cannot delete: VM "${vm.name}" is still used by another object`,
          {
            detail: `Cannot delete the cloud: the imported VM "${vm.name}" is still used by another object (for example a Docker host). Remove that reference first.`,
          },
        );
      }
    }
    await cleanupTypes(tx);
    await cleanupImages(tx);
    const clusters = await tx.query<{ cluster_id: number }>(
      `SELECT cluster_id FROM ${T.region} WHERE cloud_id = ? AND cluster_id IS NOT NULL`,
      [cloudId],
    );
    for (const c of clusters) {
      await tx.execute(
        `DELETE FROM virtualization_cluster WHERE id = ?
           AND NOT EXISTS (SELECT 1 FROM virtualization_virtual_machine WHERE cluster_id = ?)`,
        [c.cluster_id, c.cluster_id],
      );
    }
    await cleanupGeography(tx);
    await tx.execute(
      `DELETE FROM extras_journalentry WHERE assigned_object_type = ? AND assigned_object_id = ?`,
      [META.cloud.objectType, cloudId],
    );
    await tx.execute(`DELETE FROM virtualization_ssh_key WHERE source_type = ? AND source_id = ?`, [
      META.cloud.objectType,
      cloudId,
    ]);
    await tx.execute(`DELETE FROM ${T.cloud} WHERE id = ?`, [cloudId]); // links cascade
  });
}

/**
 * Link Docker hosts to the VM they run on: a host with no VM and no device whose endpoint
 * address is an address of exactly one VM interface. Never overwrites a link, never removes
 * one, and skips ambiguous addresses (the same private IP in two clouds). Best-effort: the
 * Docker plugin may not be loaded.
 */
export async function linkDockerHosts(db: Db, onlyHostId?: number): Promise<void> {
  try {
    const hosts = await db.query<{ id: number; endpoint: string }>(
      `SELECT id, endpoint FROM plugin_docker_host
        WHERE virtual_machine_id IS NULL AND device_id IS NULL${onlyHostId != null ? ' AND id = ?' : ''}`,
      onlyHostId != null ? [onlyHostId] : [],
    );
    for (const h of hosts) {
      let ip: string;
      try {
        ip = new URL(h.endpoint).hostname.replace(/^\[|\]$/g, '');
      } catch {
        continue;
      }
      if (!ip) continue;
      const vms = await db.query<{ vm: number }>(
        `SELECT DISTINCT i.virtual_machine_id AS vm
           FROM ipam_ipaddress a
           JOIN virtualization_vminterface i ON i.id = a.assigned_object_id
          WHERE a.assigned_object_type = 'virtualization.vminterface' AND a.address LIKE ?`,
        [`${ip}/%`],
      );
      if (vms.length === 1) {
        await db.execute(
          `UPDATE plugin_docker_host SET virtual_machine_id = ? WHERE id = ? AND virtual_machine_id IS NULL`,
          [vms[0]!.vm, h.id],
        );
      }
    }
  } catch {
    /* no Docker plugin: nothing to link */
  }
}

const shortHash = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 8);

/** The comment of an OpenSSH public key (`<type> <base64> <comment>`), '' when it has none. */
const keyComment = (publicKey: string): string => publicKey.split(/\s+/).slice(2).join(' ').trim();

/**
 * Import a cloud's Nova keypairs as SSH keys marked with the cloud as their source. A
 * key that already exists in paas2box with the same public key and no source (added by
 * hand) is left alone and not imported again; the same key from another cloud is that
 * cloud's own row. A name already taken by a different key gets a suffix. A new key is
 * given as owner the paasbox user whose username matches its name, or else its comment
 * (e.g. an email); with no match the owner stays empty. Later syncs never change it, so a
 * hand-set owner sticks. Returns the ids of the keys this cloud owns.
 */
async function importKeypairs(db: Db, cloudId: number, keypairs: Keypair[]): Promise<number[]> {
  const ids: number[] = [];
  const type = META.cloud.objectType;
  for (const k of keypairs) {
    if (!SSH_PUBLIC_KEY.test(k.publicKey)) continue; // x509 keypairs have no SSH public key
    const owned = await db.get<{ id: number }>(
      `SELECT id FROM virtualization_ssh_key WHERE public_key = ? AND source_type = ? AND source_id = ?`,
      [k.publicKey, type, cloudId],
    );
    if (owned) {
      ids.push(Number(owned.id));
      continue;
    }
    const manual = await db.get(
      `SELECT id FROM virtualization_ssh_key WHERE public_key = ? AND source_type IS NULL`,
      [k.publicKey],
    );
    if (manual) continue;
    let name = k.name.slice(0, 100);
    const taken = await db.get(
      `SELECT id FROM virtualization_ssh_key WHERE lower(name) = lower(?)`,
      [name],
    );
    if (taken) name = `${name.slice(0, 91)}-${shortHash(k.publicKey)}`;
    // the owner is the paasbox user whose username is the key's name or, failing that,
    // its comment
    let owner: { id: number } | undefined;
    for (const candidate of [k.name, keyComment(k.publicKey)]) {
      if (!candidate) continue;
      owner = await db.get<{ id: number }>(
        `SELECT id FROM users_user WHERE lower(username) = lower(?)`,
        [candidate],
      );
      if (owner) break;
    }
    const r = await db.execute(
      `INSERT INTO virtualization_ssh_key (name, public_key, owner_id, source_type, source_id) VALUES (?, ?, ?, ?, ?)`,
      [name, k.publicKey, owner ? Number(owner.id) : null, type, cloudId],
    );
    ids.push(Number(r.insertId));
  }
  return ids;
}

/** Remove the keys this cloud imported earlier that it no longer has (after a complete read). */
async function pruneKeys(db: Db, cloudId: number, keep: Set<number>): Promise<void> {
  const owned = await db.query<{ id: number }>(
    `SELECT id FROM virtualization_ssh_key WHERE source_type = ? AND source_id = ?`,
    [META.cloud.objectType, cloudId],
  );
  for (const k of owned) {
    if (!keep.has(Number(k.id))) {
      await db.execute(`DELETE FROM virtualization_ssh_key WHERE id = ?`, [k.id]);
    }
  }
}
