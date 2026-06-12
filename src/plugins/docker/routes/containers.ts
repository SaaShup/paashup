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
): Promise<unknown> {
  if (v == null || hasId(v) || typeof v !== 'object') return v;
  const key = (v as Obj)[keyName];
  if (typeof key !== 'string' || key === '') return v; // unidentifiable → let validation report it
  const row = await db.get<{ id: number }>(
    `SELECT id FROM ${ident(table)} WHERE ${ident(keyColumn)} = ? AND host_id = ?`,
    [key, hostId],
  );
  if (!row) {
    throw new ValidationError(`${field} not found`, {
      [field]: [`No ${field} with ${keyName} "${key}" on host ${hostId}.`],
    });
  }
  return Number(row.id);
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
    ns.network = await resolveRef(db, hostId, T.network, 'network', 'name', 'name', ns.network);
  }
  for (const m of children.get('mounts') ?? []) {
    m.volume = await resolveRef(db, hostId, T.volume, 'volume', 'name', 'name', m.volume);
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

export const containerWriteRoutes: PluginRoute[] = [
  {
    method: 'POST',
    path: META.container.endpoint,
    handler: async ({ db, body }) => {
      const { scalars, children } = split((body ?? {}) as Obj);
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
  ...(['PUT', 'PATCH'] as const).map(
    (method): PluginRoute => ({
      method,
      path: `${META.container.endpoint}{id}/`,
      handler: async ({ db, params, body }) => {
        const id = Number(params.id);
        const repo = new Repository<Row>(db, getTable(T.container)!);
        const existing = await repo.retrieve(id);
        if (!existing) return { status: 404, body: { detail: 'Not found' } };
        const { scalars, children } = split((body ?? {}) as Obj);
        const hostId = Number(scalars.host ?? (existing as Row).host);
        await resolveAgentRefs(db, hostId, scalars, children);
        const imageId = scalars.image ?? (existing as Row).image;
        await validateCrossHost(db, hostId, imageId, children);
        await db.transaction(async (tx) => {
          const r = new Repository<Row>(tx, getTable(T.container)!);
          if (Object.keys(scalars).length) await r.update(id, scalars);
          await writeChildren(tx, id, children, true); // replace provided arrays
        });
        const row = (await repo.retrieve(id))!;
        const out = await serializeContainer(db, row);
        emit(db, 'updated', id, out);
        return { status: 200, body: out };
      },
    }),
  ),
];
