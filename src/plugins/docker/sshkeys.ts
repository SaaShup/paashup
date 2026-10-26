// VM SSH keys: the authorized_keys file the agent of a VM manages
// (http://<VM primary IP>:1880/api/ssh-keys — GET / POST {publicKey, revision} /
// DELETE {id, revision}), reached with the agent credentials of PB_SSH_AGENT_USER /
// PB_SSH_AGENT_PASSWORD, whether or not the VM is registered as a Docker host. paasbox
// keeps what it last read in plugin_docker_vm_ssh_key, so the keys of every VM — and the
// VMs a catalog key is on — are listed without asking the agents. That copy is refreshed
// when the VMs' cloud is added or synced, and after each change made through paasbox, which
// is where the keys are managed; keys added or removed on the machine itself show up at the
// next sync of its cloud.
//
// Writes go to the agent first, then the copy is re-read from it: the file stays the
// source of truth. The agent rejects a write made against a stale revision (409), so each
// write reads the current revision right before, and retries once if the file changed.
import crypto from 'node:crypto';
import type { Db } from '../../db/types.js';
import type { PluginRoute, PluginRouteResult } from '../../plugins/types.js';
import { Repository } from '../../repository/repository.js';
import { getTable } from '../../model/registry.js';
import { Serializer } from '../../api/serializer.js';
import { broadcast } from '../../realtime.js';
import { META, T } from './meta.js';

type Row = Record<string, unknown>;

const ident = (name: string): string => '`' + name.replace(/`/g, '``') + '`';
const baseUrl = (): string => process.env.BASE_URL ?? '';
const CATALOG = 'virtualization_ssh_key';
/**
 * `source_type` of the catalog keys imported from an agent (their `source_id` is a VM the
 * key was found on), like an OpenStack cloud is the source of the keypairs it imports.
 */
export const AGENT_SOURCE = 'virtualization.virtualmachine';
const OPENSTACK_SOURCE = 'plugins.openstackcloud';
/** What a Nova keypair name may be: an imported key can later launch a VM. */
const NOVA_NAME = /^[A-Za-z0-9_-]+(?: [A-Za-z0-9_-]+)*$/;
const SCAN_TIMEOUT_MS = 4000;
const WRITE_TIMEOUT_MS = 15000;
const SCAN_CONCURRENCY = 8;

interface AgentKey {
  id: string;
  type: string;
  fingerprint: string;
  comment: string;
  publicKey: string;
  options: string;
}
interface AgentList {
  account: string;
  revision: string;
  keys: AgentKey[];
}
interface AgentReply {
  status: number;
  body: Record<string, unknown>;
}
/** Where and how to reach the agent of a VM. */
interface Agent {
  url: string;
  auth: string;
}

/** OpenSSH fingerprint (`SHA256:<base64, unpadded>`) of a `<type> <base64> [comment]` key. */
export function fingerprint(publicKey: string): string | null {
  const blob = publicKey.trim().split(/\s+/)[1];
  if (!blob || !/^[A-Za-z0-9+/]+={0,3}$/.test(blob)) return null;
  const digest = crypto.createHash('sha256').update(Buffer.from(blob, 'base64')).digest('base64');
  return `SHA256:${digest.replace(/=+$/, '')}`;
}

const configured = (): boolean =>
  !!process.env.PB_SSH_AGENT_USER && !!process.env.PB_SSH_AGENT_PASSWORD;

/** The agent of a VM, at its primary IP (IPv4 first). Null without credentials or IP. */
async function vmAgent(db: Db, vmId: number): Promise<Agent | null> {
  if (!configured()) return null;
  const row = await db.get<{ address: string }>(
    `SELECT a.address FROM virtualization_virtual_machine v
       JOIN ipam_ipaddress a ON a.id = COALESCE(v.primary_ip4_id, v.primary_ip6_id)
      WHERE v.id = ?`,
    [vmId],
  );
  const ip = row ? String(row.address).split('/')[0]! : '';
  if (!ip) return null;
  const host = ip.includes(':') ? `[${ip}]` : ip;
  const port = process.env.PB_SSH_AGENT_PORT || '1880';
  const credentials = `${process.env.PB_SSH_AGENT_USER}:${process.env.PB_SSH_AGENT_PASSWORD}`;
  return {
    url: `http://${host}:${port}/api/ssh-keys`,
    auth: `Basic ${Buffer.from(credentials).toString('base64')}`,
  };
}

/** Call the agent's SSH key API. Throws when the agent can't be reached. */
async function agentCall(
  agent: Agent,
  method: string,
  body?: unknown,
  timeout = WRITE_TIMEOUT_MS,
): Promise<AgentReply> {
  const resp = await fetch(agent.url, {
    method,
    headers: {
      Authorization: agent.auth,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await resp.json()) as Record<string, unknown>;
  } catch {
    /* not JSON (not an agent?): keep the status only */
  }
  return { status: resp.status, body: parsed };
}

const message = (r: AgentReply): string =>
  typeof r.body.message === 'string' ? r.body.message : `Agent answered ${r.status}`;

/** A listing that really comes from an agent (anything may answer on that port). */
const isList = (b: Record<string, unknown>): boolean =>
  typeof b.revision === 'string' && Array.isArray(b.keys);

// One SSH key operation at a time per VM: a sync and a change made meanwhile would
// otherwise both write the VM's rows.
const queues = new Map<number, Promise<unknown>>();
function serialized<V>(vmId: number, fn: () => Promise<V>): Promise<V> {
  const run = (queues.get(vmId) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => undefined);
  queues.set(vmId, tail);
  void tail.then(() => queues.get(vmId) === tail && queues.delete(vmId));
  return run;
}

/**
 * Catalog key id by fingerprint. Several catalog keys may share one (the same key added by
 * hand and imported from a cloud): a key added by hand wins, then a cloud's, then an agent's.
 */
async function catalogByFingerprint(db: Db): Promise<Map<string, number>> {
  const rows = await db.query<{ id: number; public_key: string }>(
    `SELECT id, public_key FROM ${CATALOG}
      ORDER BY CASE WHEN source_type IS NULL THEN 0 WHEN source_type = ? THEN 2 ELSE 1 END, id`,
    [AGENT_SOURCE],
  );
  const out = new Map<string, number>();
  for (const r of rows) {
    const fp = fingerprint(String(r.public_key));
    if (fp && !out.has(fp)) out.set(fp, Number(r.id));
  }
  return out;
}

/** A catalog key as the API renders it, with where it comes from and how many VMs have it. */
export async function serializeCatalogKey(db: Db, row: Row): Promise<Row> {
  const out = await new Serializer(db, baseUrl()).object(CATALOG, row);
  const type = row.source_type ?? null;
  out.origin =
    type === null
      ? 'paasbox'
      : type === AGENT_SOURCE
        ? 'agent'
        : type === OPENSTACK_SOURCE
          ? 'openstack'
          : String(type);
  const n = await db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${ident(T.vmSshKey)} WHERE ssh_key_id = ?`,
    [Number(row.id)],
  );
  out.deployed_on = Number(n?.n ?? 0);
  return out;
}

async function emitCatalog(db: Db, event: 'created' | 'updated', id: number): Promise<void> {
  const row = await new Repository<Row>(db, getTable(CATALOG)!).retrieve(id);
  if (!row) return;
  const meta = getTable(CATALOG)!;
  broadcast({
    type: 'change',
    event,
    object_type: meta.objectType,
    table: CATALOG,
    id,
    data: await serializeCatalogKey(db, row),
  });
}

/**
 * Add a key an agent found, and the catalog doesn't have, to the catalog — with the VM as
 * its source — so every key giving access to a VM is listed. Named after its comment (as a
 * Nova keypair name, the key can then launch a VM); owned by the user of that username.
 */
async function importAgentKey(db: Db, vmId: number, k: AgentKey): Promise<number> {
  let name =
    k.comment
      .replace(/[^A-Za-z0-9_ -]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 91) || 'agent-key';
  if (!NOVA_NAME.test(name)) name = name.replace(/ /g, '-');
  const taken = await db.get(`SELECT id FROM ${CATALOG} WHERE lower(name) = lower(?)`, [name]);
  if (taken) {
    const hash = crypto.createHash('sha256').update(k.fingerprint).digest('hex').slice(0, 8);
    name = `${name}-${hash}`;
  }
  const owner = k.comment
    ? await db.get<{ id: number }>(`SELECT id FROM users_user WHERE lower(username) = lower(?)`, [
        k.comment,
      ])
    : undefined;
  const r = await db.execute(
    `INSERT INTO ${CATALOG} (name, public_key, owner_id, source_type, source_id) VALUES (?, ?, ?, ?, ?)`,
    [name, k.publicKey, owner ? Number(owner.id) : null, AGENT_SOURCE, vmId],
  );
  await emitCatalog(db, 'created', Number(r.insertId));
  return Number(r.insertId);
}

/**
 * Drop the catalog keys imported from agents that no VM has any more (like a cloud's
 * keypairs once gone from it), and point the others to a VM they are still on.
 */
export async function pruneAgentKeys(db: Db): Promise<void> {
  const gone = await db.query<{ id: number }>(
    `SELECT id FROM ${CATALOG} c WHERE source_type = ?
        AND NOT EXISTS (SELECT 1 FROM ${ident(T.vmSshKey)} d WHERE d.ssh_key_id = c.id)`,
    [AGENT_SOURCE],
  );
  const meta = getTable(CATALOG)!;
  for (const g of gone) {
    await db.execute(`DELETE FROM ${CATALOG} WHERE id = ?`, [g.id]);
    broadcast({
      type: 'change',
      event: 'deleted',
      object_type: meta.objectType,
      table: CATALOG,
      id: Number(g.id),
    });
  }
  await db.execute(
    `UPDATE ${CATALOG} SET source_id = (
        SELECT MIN(d.virtual_machine_id) FROM ${ident(T.vmSshKey)} d WHERE d.ssh_key_id = ${CATALOG}.id)
      WHERE source_type = ? AND NOT EXISTS (
        SELECT 1 FROM ${ident(T.vmSshKey)} d
         WHERE d.ssh_key_id = ${CATALOG}.id AND d.virtual_machine_id = ${CATALOG}.source_id)`,
    [AGENT_SOURCE],
  );
}

/** A stored key as the API renders it (FKs as briefs). */
async function serializeKey(db: Db, id: number): Promise<Row | null> {
  const row = await new Repository<Row>(db, getTable(T.vmSshKey)!).retrieve(id);
  return row ? new Serializer(db, baseUrl()).object(T.vmSshKey, row) : null;
}

async function emit(db: Db, event: 'created' | 'updated', id: number): Promise<void> {
  const data = await serializeKey(db, id);
  if (!data) return;
  broadcast({
    type: 'change',
    event,
    object_type: META.vmSshKey.objectType,
    table: T.vmSshKey,
    id,
    data,
  });
}

/** Make the VM's rows match what the agent listed (null: management disabled → none). */
async function storeKeys(db: Db, vmId: number, list: AgentList | null): Promise<void> {
  const existing = await db.query<Row & { id: number; fingerprint: string }>(
    `SELECT * FROM ${ident(T.vmSshKey)} WHERE virtual_machine_id = ?`,
    [vmId],
  );
  const byFp = new Map(existing.map((r) => [String(r.fingerprint), r]));
  const catalog = list?.keys.length ? await catalogByFingerprint(db) : new Map<string, number>();
  const seen = new Set<string>();
  for (const k of list?.keys ?? []) {
    if (seen.has(k.fingerprint)) continue;
    seen.add(k.fingerprint);
    let sshKeyId = catalog.get(k.fingerprint);
    if (sshKeyId === undefined) {
      sshKeyId = await importAgentKey(db, vmId, k);
      catalog.set(k.fingerprint, sshKeyId);
    }
    const values = {
      ssh_key_id: sshKeyId,
      name: k.comment || k.fingerprint,
      account: list!.account ?? null,
      key_type: k.type,
      comment: k.comment || null,
      options: k.options || null,
      public_key: k.publicKey,
    };
    const old = byFp.get(k.fingerprint);
    if (!old) {
      const res = await db.execute(
        `INSERT INTO ${ident(T.vmSshKey)} (virtual_machine_id, fingerprint, ${Object.keys(
          values,
        ).join(', ')})
         VALUES (?, ?, ${Object.keys(values)
           .map(() => '?')
           .join(', ')})`,
        [vmId, k.fingerprint, ...Object.values(values)],
      );
      await emit(db, 'created', Number(res.insertId));
    } else if (Object.entries(values).some(([c, v]) => (old[c] ?? null) !== v)) {
      await db.execute(
        `UPDATE ${ident(T.vmSshKey)} SET ${Object.keys(values)
          .map((c) => `${c} = ?`)
          .join(', ')} WHERE id = ?`,
        [...Object.values(values), old.id],
      );
      await emit(db, 'updated', Number(old.id));
    }
  }
  for (const r of existing) {
    if (seen.has(String(r.fingerprint))) continue;
    await db.execute(`DELETE FROM ${ident(T.vmSshKey)} WHERE id = ?`, [r.id]);
    broadcast({
      type: 'change',
      event: 'deleted',
      object_type: META.vmSshKey.objectType,
      table: T.vmSshKey,
      id: Number(r.id),
    });
  }
  await pruneAgentKeys(db);
}

/**
 * Read the agent's list and store it. An agent without SSH key management (404) leaves
 * the VM without keys; an unreachable, refusing or non-agent answer leaves the copy as it was.
 */
async function readAndStore(
  db: Db,
  vmId: number,
  agent: Agent,
  timeout?: number,
): Promise<AgentReply> {
  const r = await agentCall(agent, 'GET', undefined, timeout);
  if (r.status === 200 && isList(r.body)) await storeKeys(db, vmId, r.body as unknown as AgentList);
  else if (r.status === 404 && r.body.message === DISABLED_MSG) await storeKeys(db, vmId, null);
  return r;
}

/** Re-read the SSH keys of these VMs from their agents, a few at a time. Never throws. */
export async function scanVms(db: Db, vmIds: readonly number[]): Promise<void> {
  if (!configured()) return;
  const queue = [...vmIds];
  const worker = async (): Promise<void> => {
    for (let vmId = queue.shift(); vmId !== undefined; vmId = queue.shift()) {
      try {
        const agent = await vmAgent(db, vmId);
        if (agent) await serialized(vmId, () => readAndStore(db, vmId, agent, SCAN_TIMEOUT_MS));
      } catch {
        /* no agent answering on that VM: nothing to read */
      }
    }
  };
  await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker));
}

/** Scan the VMs of an OpenStack cloud (after its sync). Best-effort, never throws. */
export async function scanCloud(db: Db, cloudId: number): Promise<void> {
  try {
    const rows = await db.query<{ vm: number }>(
      'SELECT virtual_machine_id AS vm FROM plugin_openstack_server WHERE cloud_id = ?',
      [cloudId],
    );
    await scanVms(
      db,
      rows.map((r) => Number(r.vm)),
    );
  } catch (e) {
    console.warn(`[Docker] SSH key scan of cloud ${cloudId} failed: ${(e as Error).message}`);
  }
}

/**
 * Point the VM keys with this catalog key's fingerprint to it (catalog key saved). A key
 * added by hand takes over those found by an agent, whose imported copy then goes away.
 */
export async function relinkCatalogKey(db: Db, sshKeyId: number): Promise<void> {
  const row = await db.get<{ public_key: string; source_type: string | null }>(
    `SELECT public_key, source_type FROM ${CATALOG} WHERE id = ?`,
    [sshKeyId],
  );
  const fp = row ? fingerprint(String(row.public_key)) : null;
  await db.execute(
    `UPDATE ${ident(T.vmSshKey)} SET ssh_key_id = NULL WHERE ssh_key_id = ? AND fingerprint <> ?`,
    [sshKeyId, fp ?? ''],
  );
  if (fp && row?.source_type !== AGENT_SOURCE) {
    await db.execute(
      `UPDATE ${ident(T.vmSshKey)} SET ssh_key_id = ?
        WHERE fingerprint = ? AND (ssh_key_id IS NULL
          OR ssh_key_id IN (SELECT id FROM ${CATALOG} WHERE source_type = ?))`,
      [sshKeyId, fp, AGENT_SOURCE],
    );
  }
  await pruneAgentKeys(db);
}

// ---- routes -------------------------------------------------------------------------

const notFound: PluginRouteResult = { status: 404, body: { detail: 'Not found' } };
const NOT_CONFIGURED: PluginRouteResult = {
  status: 400,
  body: { detail: 'Set PB_SSH_AGENT_USER and PB_SSH_AGENT_PASSWORD to manage VM SSH keys.' },
};
const DISABLED = "SSH key management isn't enabled on this VM's agent.";
/** What the agent answers when SSH key management is disabled. */
const DISABLED_MSG = 'Host SSH key management is disabled';

/** An agent failure as an API answer; `field` gets the agent's validation message. */
function agentError(r: AgentReply, field: string): PluginRouteResult {
  if (r.status === 400 || r.status === 413) return { status: 400, body: { [field]: [message(r)] } };
  if (r.status === 404) return { status: 400, body: { virtual_machine: [DISABLED] } };
  if (r.status === 409) return { status: 409, body: { detail: message(r) } };
  if (r.status === 401 || r.status === 403) {
    return { status: 502, body: { detail: `The agent refused paasbox (${r.status}).` } };
  }
  return { status: 502, body: { detail: message(r) } };
}

const unreachable = (e: unknown): PluginRouteResult => ({
  status: 502,
  body: { detail: `Agent unreachable: ${(e as Error).message}` },
});

/**
 * Run a write against the current revision, retrying once if the file changed in between
 * (another write, or an edit on the machine). `write` gets the current list; it returns
 * the agent's answer, or null when there's nothing to write.
 */
async function withRevision(
  agent: Agent,
  write: (list: AgentList) => Promise<AgentReply | null>,
): Promise<AgentReply | null> {
  for (let attempt = 0; ; attempt++) {
    const current = await agentCall(agent, 'GET');
    if (current.status !== 200) return current;
    if (!isList(current.body)) return { status: 502, body: { message: 'Not a paasbox agent' } };
    const r = await write(current.body as unknown as AgentList);
    if (r?.status !== 409 || attempt > 0) return r;
    const again = await agentCall(agent, 'GET');
    if (again.body.revision === current.body.revision) return r; // a real conflict (duplicate)
  }
}

const idOf = (v: unknown): number =>
  Number(v !== null && typeof v === 'object' ? (v as { id?: unknown }).id : v);

const createRoute: PluginRoute = {
  method: 'POST',
  path: META.vmSshKey.endpoint,
  handler: async ({ db, body }) => {
    if (!configured()) return NOT_CONFIGURED;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { status: 400, body: { detail: 'Add one key at a time.' } };
    }
    const b = body as Row;
    const vmId = idOf(b.virtual_machine);
    if (!Number.isInteger(vmId)) {
      return { status: 400, body: { virtual_machine: ['Choose a virtual machine.'] } };
    }
    const agent = await vmAgent(db, vmId);
    if (!agent) {
      return { status: 400, body: { virtual_machine: ['This VM has no primary IP.'] } };
    }

    const sshKeyId = b.ssh_key == null || b.ssh_key === '' ? null : idOf(b.ssh_key);
    const pasted = typeof b.public_key === 'string' ? b.public_key.trim() : '';
    if ((sshKeyId === null) === !pasted) {
      return {
        status: 400,
        body: { ssh_key: ['Choose a key of the catalog, or paste a public key (not both).'] },
      };
    }
    let publicKey = pasted;
    if (sshKeyId !== null) {
      const row = await db.get<{ public_key: string }>(
        `SELECT public_key FROM ${CATALOG} WHERE id = ?`,
        [sshKeyId],
      );
      if (!row) return { status: 400, body: { ssh_key: ['No such SSH key.'] } };
      publicKey = String(row.public_key).trim();
    }
    const field = sshKeyId !== null ? 'ssh_key' : 'public_key';

    try {
      return await serialized(vmId, async () => {
        const r = await withRevision(agent, (list) =>
          agentCall(agent, 'POST', { publicKey, revision: list.revision }),
        );
        if (r!.status !== 200) {
          if (r!.status === 404) await storeKeys(db, vmId, null);
          return agentError(r!, field);
        }
        await readAndStore(db, vmId, agent);
        const row = await db.get<{ id: number }>(
          `SELECT id FROM ${ident(T.vmSshKey)} WHERE virtual_machine_id = ? AND fingerprint = ?`,
          [vmId, fingerprint(publicKey) ?? ''],
        );
        return { status: 201, body: row ? await serializeKey(db, Number(row.id)) : null };
      });
    } catch (e) {
      return unreachable(e);
    }
  },
};

/** Remove one stored key from its VM's file. */
async function removeKey(db: Db, id: number): Promise<PluginRouteResult> {
  const row = await db.get<{ virtual_machine_id: number; fingerprint: string }>(
    `SELECT virtual_machine_id, fingerprint FROM ${ident(T.vmSshKey)} WHERE id = ?`,
    [id],
  );
  if (!row) return notFound;
  if (!configured()) return NOT_CONFIGURED;
  const vmId = Number(row.virtual_machine_id);
  const agent = await vmAgent(db, vmId);
  if (!agent) return { status: 400, body: { virtual_machine: ['This VM has no primary IP.'] } };
  try {
    return await serialized(vmId, async () => {
      const r = await withRevision(agent, async (list) => {
        const entry = list.keys.find((k) => k.fingerprint === row.fingerprint);
        return entry ? agentCall(agent, 'DELETE', { id: entry.id, revision: list.revision }) : null;
      });
      if (r && r.status !== 200) {
        if (r.status === 404 && message(r) === DISABLED_MSG) {
          await storeKeys(db, vmId, null);
          return agentError(r, 'id');
        }
        // a key already gone from the file (removed on the machine) just gets re-read
        if (r.status !== 404) return agentError(r, 'id');
      }
      await readAndStore(db, vmId, agent);
      return { status: 204 };
    });
  } catch (e) {
    return unreachable(e);
  }
}

const deleteRoute: PluginRoute = {
  method: 'DELETE',
  path: `${META.vmSshKey.endpoint}{id}/`,
  handler: async ({ db, params }) => removeKey(db, Number(params.id)),
};

// Bulk delete from the list ([{id}, …]): each key through its agent, stopping at the first
// failure.
const bulkDeleteRoute: PluginRoute = {
  method: 'DELETE',
  path: META.vmSshKey.endpoint,
  handler: async ({ db, body }) => {
    if (!Array.isArray(body)) return { status: 400, body: { detail: 'Expected a list of {id}.' } };
    for (const item of body) {
      const r = await removeKey(db, idOf(item));
      if (r.status !== 204 && r.status !== 404) return r;
    }
    return { status: 204 };
  },
};

// A key is added or removed, never edited.
const noUpdate: PluginRoute[] = ['PUT', 'PATCH'].flatMap((method) =>
  [META.vmSshKey.endpoint, `${META.vmSshKey.endpoint}{id}/`].map((path): PluginRoute => ({
    method: method as 'PUT' | 'PATCH',
    path,
    handler: () => ({
      status: 405,
      body: { detail: 'An SSH key is not edited: remove it and add the new one.' },
    }),
  })),
);

export const sshKeyRoutes: PluginRoute[] = [createRoute, deleteRoute, bulkDeleteRoute, ...noUpdate];
