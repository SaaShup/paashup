// OpenStack client: Keystone v3 password auth, service catalogue lookup, and
// read-only calls to Nova / Glance / Neutron / Cinder. Service URLs come from the Keystone catalogue,
// so it works the same on OVH and on a DevStack. One token covers every
// region of the project; each call names the region whose endpoints it uses.
import { createHash } from 'node:crypto';

export interface CloudConfig {
  auth_url: string;
  username: string;
  password: string;
  user_domain_name: string;
  project_name: string;
  project_domain_name: string;
}

export interface Session {
  token: string;
  expiresAt: number;
  projectId: string;
  projectName: string;
  regions: Record<string, Record<string, string>>;
}

export class OpenStackError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'OpenStackError';
  }
}

const TIMEOUT_MS = 60_000;
export type Service = 'compute' | 'image' | 'network' | 'volume';
const SERVICE_TYPES: Record<Service, string[]> = {
  compute: ['compute'],
  image: ['image'],
  network: ['network'],
  volume: ['volumev3', 'block-storage', 'volumev2', 'volume'],
};

type Json = Record<string, unknown>;
interface CatalogEndpoint {
  interface?: string;
  region?: string;
  region_id?: string;
  url?: string;
}
interface CatalogEntry {
  type?: string;
  endpoints?: CatalogEndpoint[];
}

const sessions = new Map<string, Session>();

function cacheKey(c: CloudConfig): string {
  return createHash('sha256')
    .update(
      [
        c.auth_url,
        c.username,
        c.password,
        c.user_domain_name,
        c.project_name,
        c.project_domain_name,
      ].join('\0'),
    )
    .digest('hex');
}

function tokensUrl(authUrl: string): string {
  const base = authUrl.replace(/\/+$/, '');
  return `${/\/v3$/.test(base) ? base : `${base}/v3`}/auth/tokens`;
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as Json | null;
  const inner = body && typeof body === 'object' ? Object.values(body)[0] : undefined;
  const msg =
    (inner && typeof inner === 'object' ? (inner as Json).message : undefined) ?? body?.message;
  return typeof msg === 'string' ? `: ${msg.slice(0, 300)}` : '';
}

async function http(url: string, init: RequestInit, label: string): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const reason = e instanceof Error && e.name === 'TimeoutError' ? 'timed out' : 'unreachable';
    throw new OpenStackError(`${label} ${reason}`);
  }
}

/** Authenticate against Keystone and read the service endpoints of every region. */
export async function authenticate(c: CloudConfig, fresh = false): Promise<Session> {
  const key = cacheKey(c);
  const cached = sessions.get(key);
  if (!fresh && cached && cached.expiresAt - Date.now() > 60_000) return cached;

  const res = await http(
    tokensUrl(c.auth_url),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth: {
          identity: {
            methods: ['password'],
            password: {
              user: {
                name: c.username,
                domain: { name: c.user_domain_name.trim() || 'Default' },
                password: c.password,
              },
            },
          },
          // No project given: let Keystone use the user's default project.
          ...(c.project_name.trim()
            ? {
                scope: {
                  project: {
                    name: c.project_name.trim(),
                    domain: { name: c.project_domain_name.trim() || 'Default' },
                  },
                },
              }
            : {}),
        },
      }),
    },
    'Keystone authentication',
  );
  if (!res.ok) {
    throw new OpenStackError(
      `Keystone authentication failed (${res.status})${await readError(res)}`,
      res.status,
    );
  }
  const token = res.headers.get('x-subject-token');
  const body = (await res.json().catch(() => null)) as { token?: Json } | null;
  if (!token || !body?.token) throw new OpenStackError('Keystone returned an invalid token');

  const regions: Record<string, Record<string, string>> = {};
  for (const entry of (body.token.catalog as CatalogEntry[] | undefined) ?? []) {
    for (const ep of entry.endpoints ?? []) {
      const region = ep.region_id ?? ep.region;
      if (ep.interface !== 'public' || !region || !entry.type || !ep.url) continue;
      (regions[region] ??= {})[entry.type] = ep.url.replace(/\/+$/, '');
    }
  }

  const session: Session = {
    token,
    expiresAt: Date.parse(String(body.token.expires_at)) || Date.now() + 15 * 60_000,
    projectId: String((body.token.project as Json | undefined)?.id ?? ''),
    projectName: String((body.token.project as Json | undefined)?.name ?? ''),
    regions,
  };
  sessions.set(key, session);
  return session;
}

export function computeRegions(session: Session): string[] {
  return Object.keys(session.regions)
    .filter((r) => session.regions[r]!.compute)
    .sort();
}

/**
 * Check the credentials against Keystone right now (never from the token cache). Returns
 * the regions that can run VMs and the project the token is scoped to (the user's default
 * one when none was given). Fails when there is no project or no compute region.
 */
export async function testConnection(
  c: CloudConfig,
): Promise<{ regions: string[]; project: string }> {
  const session = await authenticate(c, true);
  if (!session.projectId) {
    throw new OpenStackError(
      'Keystone issued a token without a project: this user has no default project. Enter a project name.',
    );
  }
  const regions = computeRegions(session);
  if (!regions.length) {
    throw new OpenStackError('No region with a compute service found in the Keystone catalogue');
  }
  return { regions, project: session.projectName };
}

function endpointFor(session: Session, region: string, service: Service): string {
  const catalogue = session.regions[region];
  if (!catalogue) {
    const known = Object.keys(session.regions).sort().join(', ') || 'none';
    throw new OpenStackError(`Region "${region}" not found in the catalogue (available: ${known})`);
  }
  for (const type of SERVICE_TYPES[service]) if (catalogue[type]) return catalogue[type];
  throw new OpenStackError(`Service "${service}" is not available in region ${region}`);
}

/** Authenticated GET on a regional service; retries once with a fresh token on a 401. */
async function get(
  c: CloudConfig,
  region: string,
  service: Service,
  path: string,
  retry = true,
  extra: Record<string, string> = {},
): Promise<Json> {
  const session = await authenticate(c);
  const base = endpointFor(session, region, service);
  const res = await http(
    `${base}${path}`,
    { headers: { 'X-Auth-Token': session.token, ...extra } },
    `OpenStack ${service}`,
  );
  if (res.status === 401 && retry) {
    sessions.delete(cacheKey(c));
    return get(c, region, service, path, false, extra);
  }
  if (!res.ok) {
    throw new OpenStackError(
      `OpenStack GET ${service}${path.split('?')[0]} failed (${res.status}) in ${region}${await readError(res)}`,
      res.status,
    );
  }
  return (await res.json().catch(() => ({}))) as Json;
}

/** A "next" link is absolute; turn it back into a path relative to the service endpoint. */
async function relativeTo(
  c: CloudConfig,
  region: string,
  service: Service,
  href: string,
): Promise<string> {
  const base = new URL(endpointFor(await authenticate(c), region, service));
  const link = new URL(href, base);
  const prefix = base.pathname.replace(/\/+$/, '');
  const path = link.pathname.startsWith(prefix)
    ? link.pathname.slice(prefix.length)
    : link.pathname;
  return `${path}${link.search}`;
}

/** Follow `<key>_links` "next" pages (Nova, Cinder) and concatenate `<key>`. */
async function getAll(
  c: CloudConfig,
  region: string,
  service: Service,
  path: string,
  key: string,
  extra: Record<string, string> = {},
): Promise<Json[]> {
  const out: Json[] = [];
  let next: string | undefined = path;
  for (let i = 0; next && i < 100; i++) {
    const page: Json = await get(c, region, service, next, true, extra);
    out.push(...((page[key] as Json[] | undefined) ?? []));
    const links = (page[`${key}_links`] as { rel?: string; href?: string }[] | undefined) ?? [];
    const href = links.find((l) => l.rel === 'next')?.href;
    next = href ? await relativeTo(c, region, service, href) : undefined;
  }
  return out;
}

// ---- typed reads ----------------------------------------------------------------

export interface Flavor {
  id: string;
  name: string;
  vcpus: number;
  ram: number; // MB
  disk: number; // GB (root disk)
}
export interface ServerAddress {
  addr: string;
  version: 4 | 6;
  type: string; // fixed | floating
  mac?: string;
}
export interface Server {
  id: string;
  name: string;
  status: string;
  /** The flavor the server runs on (name + sizes), or null if it can't be resolved. */
  flavor: { name: string; vcpus: number; ram: number; disk: number } | null;
  /** Glance image the server booted from; null when booted from a volume. */
  imageId: string | null;
  metadata: Record<string, string>;
  /** network name → addresses */
  addresses: Record<string, ServerAddress[]>;
}
export interface Volume {
  id: string;
  name: string;
  size: number; // GB
  status: string;
  /** servers the volume is attached to */
  attachments: { serverId: string; device: string }[];
}

export async function listFlavors(c: CloudConfig, region: string): Promise<Flavor[]> {
  const rows = await getAll(c, region, 'compute', '/flavors/detail', 'flavors');
  return rows.map((f) => ({
    id: String(f.id),
    name: String(f.name),
    vcpus: Number(f.vcpus ?? 0),
    ram: Number(f.ram ?? 0),
    disk: Number(f.disk ?? 0),
  }));
}

/** Nova ≥ 2.47 embeds each server's flavor (name and sizes) instead of just its id. */
const EMBEDDED_FLAVOR = { 'OpenStack-API-Version': 'compute 2.47' };

export async function listServers(c: CloudConfig, region: string): Promise<Server[]> {
  const path = '/servers/detail?limit=100';
  let rows: Json[];
  let embedded = true;
  try {
    rows = await getAll(c, region, 'compute', path, 'servers', EMBEDDED_FLAVOR);
  } catch (e) {
    // an older Nova refuses the microversion: read ids and resolve them from the flavor list
    if (!(e instanceof OpenStackError) || e.status !== 406) throw e;
    rows = await getAll(c, region, 'compute', path, 'servers');
    embedded = false;
  }
  const byId = embedded
    ? new Map<string, Flavor>()
    : new Map((await listFlavors(c, region)).map((f) => [f.id, f]));

  return rows.map((s) => {
    const addresses: Record<string, ServerAddress[]> = {};
    for (const [net, list] of Object.entries((s.addresses as Json | undefined) ?? {})) {
      addresses[net] = ((list as Json[]) ?? []).map((a) => ({
        addr: String(a.addr),
        version: Number(a.version) === 6 ? 6 : 4,
        type: String(a['OS-EXT-IPS:type'] ?? 'fixed'),
        mac: a['OS-EXT-IPS-MAC:mac_addr'] ? String(a['OS-EXT-IPS-MAC:mac_addr']) : undefined,
      }));
    }
    const f = (s.flavor as Json | undefined) ?? {};
    const legacy = byId.get(String(f.id));
    const name = embedded ? f.original_name : legacy?.name;
    return {
      id: String(s.id),
      name: String(s.name),
      status: String(s.status),
      flavor: name
        ? {
            name: String(name),
            vcpus: Number(embedded ? f.vcpus : legacy?.vcpus) || 0,
            ram: Number(embedded ? f.ram : legacy?.ram) || 0,
            disk: Number(embedded ? f.disk : legacy?.disk) || 0,
          }
        : null,
      imageId: (s.image as Json | undefined)?.id ? String((s.image as Json).id) : null,
      metadata: ((s.metadata as Record<string, string> | undefined) ?? {}) as Record<
        string,
        string
      >,
      addresses,
    };
  });
}

/** Glance image id → name, for the images this project can see. */
export async function listImageNames(c: CloudConfig, region: string): Promise<Map<string, string>> {
  const rows = await getAll(c, region, 'image', '/v2/images?limit=200', 'images');
  return new Map(rows.filter((i) => i.name).map((i) => [String(i.id), String(i.name)]));
}

export interface Keypair {
  name: string;
  /** OpenSSH public key; empty for the x509 keypairs Nova can also hold */
  publicKey: string;
}

/** The user's Nova keypairs of a region (they are per user and per region). */
export async function listKeypairs(c: CloudConfig, region: string): Promise<Keypair[]> {
  const rows = (await getAll(c, region, 'compute', '/os-keypairs', 'keypairs')) as {
    keypair?: Json;
  }[];
  return rows
    .filter((k) => k.keypair?.name)
    .map((k) => ({
      name: String(k.keypair!.name),
      publicKey: String(k.keypair!.public_key ?? '').trim(),
    }));
}

export async function listVolumes(c: CloudConfig, region: string): Promise<Volume[]> {
  const rows = await getAll(c, region, 'volume', '/volumes/detail?limit=200', 'volumes');
  return rows.map((v) => ({
    id: String(v.id),
    name: String(v.name ?? ''),
    size: Number(v.size ?? 0),
    status: String(v.status ?? ''),
    attachments: ((v.attachments as Json[] | undefined) ?? []).map((a) => ({
      serverId: String(a.server_id),
      device: String(a.device ?? ''),
    })),
  }));
}

/** Read-only listings exposed to the UI for the future "create VM" form. */
export const READS: Record<string, (c: CloudConfig, region: string) => Promise<unknown[]>> = {
  flavors: (c, r) => listFlavors(c, r),
  volumes: (c, r) => listVolumes(c, r),
  networks: async (c, r) =>
    (await getAll(c, r, 'network', '/v2.0/networks', 'networks')).map((n) => ({
      id: n.id,
      name: n.name,
      status: n.status,
      shared: n.shared,
      external: n['router:external'],
    })),
  'security-groups': async (c, r) =>
    (await getAll(c, r, 'network', '/v2.0/security-groups', 'security_groups')).map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
    })),
  limits: async (c, r) => {
    const l = ((await get(c, r, 'compute', '/limits')).limits as { absolute?: Json } | undefined)
      ?.absolute;
    return l ? [l] : [];
  },
};
