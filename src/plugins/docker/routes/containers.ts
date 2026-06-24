// Container write routes (POST/PUT/PATCH). Unlike the parent entities, containers
// accept inline nested children (ports/env/labels/mounts/binds/network_settings/
// devices/log_driver_options/sysctls), so these override the generic CRUD. Cross-host
// integrity (image/volume/network must belong to the container's host) is validated
// up front, then the container row + its children are written in one transaction.
import type { Db } from '../../../db/types.js';
import type { PluginRoute } from '../../../plugins/types.js';
import { Repository } from '../../../repository/repository.js';
import { getTable } from '../../../model/registry.js';
import { ValidationError } from '../../../errors.js';
import { broadcast } from '../../../realtime.js';
import { dispatchWebhooks } from '../../../webhooks.js';
import { CHILD_SPECS, META, T, type ChildSpec } from '../meta.js';
import { serializeContainer } from '../serialize.js';

type Row = Record<string, unknown>;
type Obj = Record<string, unknown>;

const ident = (name: string): string => '`' + name.replace(/`/g, '``') + '`';
const childIdValue = (v: unknown): number =>
  v !== null && typeof v === 'object' ? Number((v as { id: unknown }).id) : Number(v);

const CHILD_FIELDS = new Set(CHILD_SPECS.map((s) => s.field));
const SPEC_BY_FIELD = new Map(CHILD_SPECS.map((s) => [s.field, s]));

const hasId = (v: unknown): boolean =>
  !!v && typeof v === 'object' && (v as { id?: unknown }).id != null;

/**
 * Resolve a FK descriptor sent with a Docker-agent natural key — an image by its
 * Docker `ImageID`, a network/volume by `name` — to the matching paasbox row id,
 * scoped to the container's host. Values already carrying an `id` (or a bare
 * id/number) are returned untouched for the generic FK handling to coerce.
 */
async function resolveRef(
  db: Db,
  hostId: number,
  table: string,
  field: string,
  keyColumn: string,
  keyName: string,
  v: unknown,
  opts: { create?: boolean } = {},
): Promise<unknown> {
  if (v == null || hasId(v) || typeof v !== 'object') return v;
  const key = (v as Obj)[keyName];
  if (typeof key !== 'string' || key === '') return v; // unidentifiable → let validation report it
  const row = await db.get<{ id: number }>(
    `SELECT id FROM ${ident(table)} WHERE ${ident(keyColumn)} = ? AND host_id = ?`,
    [key, hostId],
  );
  if (row) return Number(row.id);
  if (opts.create) {
    // The agent observed this resource on the host (e.g. a container's anonymous volume
    // or its network), so register it by name — other columns take their defaults — and
    // link the container to it. Avoids failing a sync just because the volume/network
    // row hasn't been created in paasbox yet.
    const res = await db.execute(
      `INSERT INTO ${ident(table)} (host_id, ${ident(keyColumn)}) VALUES (?, ?)`,
      [hostId, key],
    );
    return Number(res.insertId);
  }
  throw new ValidationError(`${field} not found`, {
    [field]: [`No ${field} with ${keyName} "${key}" on host ${hostId}.`],
  });
}

/** Map agent-shaped FK descriptors (image/network/volume by natural key) to ids. */
async function resolveAgentRefs(
  db: Db,
  hostId: number,
  scalars: Obj,
  children: Map<string, Obj[]>,
): Promise<void> {
  scalars.image = await resolveRef(
    db,
    hostId,
    T.image,
    'image',
    'image_id',
    'ImageID',
    scalars.image,
  );
  for (const ns of children.get('network_settings') ?? []) {
    // auto-register a network the agent reports (e.g. "bridge") if it's not known yet
    ns.network = await resolveRef(db, hostId, T.network, 'network', 'name', 'name', ns.network, {
      create: true,
    });
  }
  for (const m of children.get('mounts') ?? []) {
    // auto-register a volume the agent reports (e.g. an anonymous data volume)
    m.volume = await resolveRef(db, hostId, T.volume, 'volume', 'name', 'name', m.volume, {
      create: true,
    });
  }
}

/** Split a request body into scalar container fields and the nested child arrays. */
function split(body: Obj): { scalars: Obj; children: Map<string, Obj[]> } {
  const scalars: Obj = {};
  const children = new Map<string, Obj[]>();
  for (const [k, v] of Object.entries(body)) {
    if (CHILD_FIELDS.has(k)) {
      if (!Array.isArray(v))
        throw new ValidationError(`"${k}" must be a list`, { [k]: ['Expected a list of items.'] });
      children.set(k, v as Obj[]);
    } else {
      scalars[k] = v;
    }
  }
  return { scalars, children };
}

async function hostIdOf(db: Db, table: string, id: unknown): Promise<number | undefined> {
  if (id === null || id === undefined) return undefined;
  const r = await db.get<{ host_id: number }>(`SELECT host_id FROM ${ident(table)} WHERE id = ?`, [
    Number(id),
  ]);
  return r ? Number(r.host_id) : undefined;
}

/** Enforce that image / mounted volumes / attached networks belong to `hostId`. */
async function validateCrossHost(
  db: Db,
  hostId: number,
  imageId: unknown,
  children: Map<string, Obj[]>,
): Promise<void> {
  if (imageId !== undefined && imageId !== null) {
    const h = await hostIdOf(db, T.image, imageId);
    if (h !== undefined && h !== hostId) {
      throw new ValidationError('cross-host image', {
        image: [`Image ${Number(imageId)} does not belong to host ${hostId}.`],
      });
    }
  }
  for (const m of children.get('mounts') ?? []) {
    const vid = childIdValue(m.volume);
    const h = await hostIdOf(db, T.volume, vid);
    if (h !== undefined && h !== hostId) {
      throw new ValidationError('cross-host volume', {
        volume: [`Volume ${vid} does not belong to host ${hostId}.`],
      });
    }
  }
  for (const ns of children.get('network_settings') ?? []) {
    const nid = childIdValue(ns.network);
    const h = await hostIdOf(db, T.network, nid);
    if (h !== undefined && h !== hostId) {
      throw new ValidationError('cross-host network', {
        network: [`Network ${nid} does not belong to host ${hostId}.`],
      });
    }
  }
}

/**
 * Normalise the `env` children to the canonical `{var_name, value}` shape. The Docker
 * agent reports env in Docker's native forms — an array of `"KEY=VALUE"` strings
 * (`Config.Env`), or objects keyed `name`/`key` — which would otherwise be rejected
 * ("var_name is required") and the env silently lost. `value` may itself contain `=`,
 * so we split on the first one only.
 */
function normalizeEnv(children: Map<string, Obj[]>): void {
  const env = children.get('env') as unknown[] | undefined;
  if (!env) return;
  children.set(
    'env',
    env.map((e): Obj => {
      if (typeof e === 'string') {
        const i = e.indexOf('=');
        return i < 0 ? { var_name: e } : { var_name: e.slice(0, i), value: e.slice(i + 1) };
      }
      const o = (e ?? {}) as Record<string, unknown>;
      if (o.var_name == null && o.name != null) return { var_name: o.name, value: o.value };
      if (o.var_name == null && o.key != null) return { var_name: o.key, value: o.value };
      return o as Obj;
    }),
  );
}

async function insertChild(tx: Db, spec: ChildSpec, containerId: number, item: Obj): Promise<void> {
  const cols = ['container_id'];
  const vals: unknown[] = [containerId];
  for (const c of spec.columns) {
    let v = item[c.name];
    if (v === undefined || v === null) {
      if (c.required) {
        throw new ValidationError(`${spec.field}.${c.name} required`, {
          [spec.field]: [`"${c.name}" is required for each item.`],
        });
      }
      continue; // fall back to the column default
    }
    if (c.fk) v = childIdValue(v);
    else if (c.kind === 'boolean') v = v ? 1 : 0;
    else if (c.kind === 'number' && typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) v = n; // accept numeric strings, e.g. ports "1882"
    }
    cols.push(c.column);
    vals.push(v);
  }
  await tx.execute(
    `INSERT INTO ${ident(spec.table)} (${cols.map(ident).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    vals as never,
  );
}

async function writeChildren(
  tx: Db,
  containerId: number,
  children: Map<string, Obj[]>,
  replace: boolean,
): Promise<void> {
  for (const [field, items] of children) {
    const spec = SPEC_BY_FIELD.get(field)!;
    if (replace)
      await tx.execute(`DELETE FROM ${ident(spec.table)} WHERE container_id = ?`, [containerId]);
    for (const item of items) await insertChild(tx, spec, containerId, item);
  }
}

// Emit the change to BOTH the WebSocket feed and any configured webhooks — the Docker
// agent is driven by webhooks, so container writes must dispatch them like generic CRUD.
function emit(db: Db, event: 'created' | 'updated', id: number, data: Obj): void {
  broadcast({
    type: 'change',
    event,
    object_type: META.container.objectType,
    table: T.container,
    id,
    data,
  });
  void dispatchWebhooks(db, META.container, event, id, data);
}

/**
 * Update one container: write its scalars and replace the provided child arrays (env,
 * ports, …). Returns the serialized container, or null if it doesn't exist. Shared by
 * the single (`/{id}/`) and bulk (collection) PUT/PATCH routes — both must persist
 * children, which the engine's generic CRUD can't do.
 */
async function updateOneContainer(db: Db, id: number, body: Obj): Promise<Obj | null> {
  const repo = new Repository<Row>(db, getTable(T.container)!);
  const existing = await repo.retrieve(id);
  if (!existing) return null;
  const { scalars, children } = split(body);
  delete (scalars as { id?: unknown }).id; // a bulk item carries its id — never write the pk
  normalizeEnv(children); // accept Docker-native env shapes (KEY=VALUE / name / key)
  const hostId = Number(scalars.host ?? (existing as Row).host);
  await resolveAgentRefs(db, hostId, scalars, children);
  const imageId = scalars.image ?? (existing as Row).image;
  await validateCrossHost(db, hostId, imageId, children);
  await db.transaction(async (tx) => {
    const r = new Repository<Row>(tx, getTable(T.container)!);
    if (Object.keys(scalars).length) await r.update(id, scalars);
    await writeChildren(tx, id, children, true); // replace provided arrays
  });
  const out = await serializeContainer(db, (await repo.retrieve(id))!);
  emit(db, 'updated', id, out);
  return out;
}

export const containerWriteRoutes: PluginRoute[] = [
  {
    method: 'POST',
    path: META.container.endpoint,
    handler: async ({ db, body }) => {
      const { scalars, children } = split((body ?? {}) as Obj);
      normalizeEnv(children); // accept Docker-native env shapes (KEY=VALUE / name / key)
      // A new container defaults to operation "none" (the agent reports observed
      // state; it isn't asked to act unless an operation is set explicitly).
      if (scalars.operation === undefined) scalars.operation = 'none';
      const hostId = Number(scalars.host);
      await resolveAgentRefs(db, hostId, scalars, children);
      await validateCrossHost(db, hostId, scalars.image, children);
      const created = await db.transaction(async (tx) => {
        const repo = new Repository<Row>(tx, getTable(T.container)!);
        const row = await repo.create(scalars); // validates required/enum/maxlength
        const id = Number((row as { id: number }).id);
        await writeChildren(tx, id, children, false);
        return id;
      });
      const row = (await new Repository<Row>(db, getTable(T.container)!).retrieve(created))!;
      const out = await serializeContainer(db, row);
      emit(db, 'created', created, out);
      return { status: 201, body: out };
    },
  },
  // Single + bulk PUT/PATCH. The bulk (collection) form is custom too — otherwise the
  // generic bulk-update path handles it and silently drops the nested children (env,
  // ports, …), since it only knows scalar columns.
  ...(['PUT', 'PATCH'] as const).flatMap((method): PluginRoute[] => [
    {
      method,
      path: `${META.container.endpoint}{id}/`,
      handler: async ({ db, params, body }) => {
        const out = await updateOneContainer(db, Number(params.id), (body ?? {}) as Obj);
        return out ? { status: 200, body: out } : { status: 404, body: { detail: 'Not found' } };
      },
    },
    {
      method,
      path: META.container.endpoint, // collection: NetBox-style bulk update (list with ids)
      handler: async ({ db, body }) => {
        if (!Array.isArray(body)) {
          return { status: 400, body: { detail: 'Bulk update expects a list of objects.' } };
        }
        const out: Obj[] = [];
        for (const item of body as Obj[]) {
          const id = Number((item as { id?: unknown }).id);
          if (!id) return { status: 400, body: { detail: 'Each item must include "id".' } };
          const o = await updateOneContainer(db, id, item);
          if (o) out.push(o);
        }
        return { status: 200, body: out };
      },
    },
  ]),
];
