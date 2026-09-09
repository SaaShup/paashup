// Image write routes (POST/PUT/PATCH). Images otherwise ride the generic engine CRUD
// (crud.ts only overrides their GET) — but nothing in that generic path checks that an
// image's registry actually belongs to the image's own host.

import type { Db } from '../../../db/types.js';
import type { PluginRoute } from '../../../plugins/types.js';
import { Repository } from '../../../repository/repository.js';
import { getTable } from '../../../model/registry.js';
import { ValidationError } from '../../../errors.js';
import { broadcast } from '../../../realtime.js';
import { dispatchWebhooks } from '../../../webhooks.js';
import { applyOriginDefaults } from '../../../api/origin.js';
import { META, T } from '../meta.js';
import { serializeImage } from '../serialize.js';

type Row = Record<string, unknown>;
type Obj = Record<string, unknown>;

const ident = (name: string): string => '`' + name.replace(/`/g, '``') + '`';

const idValue = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  const n = Number(v !== null && typeof v === 'object' ? (v as { id?: unknown }).id : v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Reject `registryRef` if it names a registry that doesn't belong to `hostId`.
 */
async function validateRegistryHost(db: Db, hostId: number, registryRef: unknown): Promise<void> {
  const registryId = idValue(registryRef);
  if (registryId === undefined) return;
  const reg = await db.get<{ host_id: number }>(
    `SELECT host_id FROM ${ident(T.registry)} WHERE id = ?`,
    [registryId],
  );
  if (reg && reg.host_id !== hostId) {
    throw new ValidationError('cross-host registry', {
      registry: [`Registry ${registryId} does not belong to host ${hostId}.`],
    });
  }
}

function emit(db: Db, event: 'created' | 'updated', id: number, data: Obj): void {
  broadcast({
    type: 'change',
    event,
    object_type: META.image.objectType,
    table: T.image,
    id,
    data,
  });
  void dispatchWebhooks(db, META.image, event, id, data);
}

async function createOneImage(db: Db, body: Obj, origin: string): Promise<Obj> {
  const meta = getTable(T.image)!;
  applyOriginDefaults(meta, body, origin);
  const hostId = idValue(body.host);
  if (hostId !== undefined) await validateRegistryHost(db, hostId, body.registry);
  const repo = new Repository<Row>(db, meta);
  const created = await repo.create(body);
  const id = Number((created as { id: number }).id);
  const out = await serializeImage(db, (await repo.retrieve(id))!);
  emit(db, 'created', id, out);
  return out;
}

async function updateOneImage(db: Db, id: number, body: Obj): Promise<Obj | null> {
  const repo = new Repository<Row>(db, getTable(T.image)!);
  const existing = await repo.retrieve(id);
  if (!existing) return null;
  const data: Obj = { ...body };
  delete data.id;
  if ('registry' in data) {
    const hostId = idValue(data.host ?? (existing as Row).host);
    if (hostId !== undefined) await validateRegistryHost(db, hostId, data.registry);
  }
  const updated = await repo.update(id, data);
  if (!updated) return null;
  const out = await serializeImage(db, (await repo.retrieve(id))!);
  emit(db, 'updated', id, out);
  return out;
}

export const imageWriteRoutes: PluginRoute[] = [
  {
    method: 'POST',
    path: META.image.endpoint,
    handler: async ({ db, body, origin }) => {
      if (Array.isArray(body)) {
        const out: Obj[] = [];
        for (const item of body) out.push(await createOneImage(db, (item ?? {}) as Obj, origin));
        return { status: 201, body: out };
      }
      return { status: 201, body: await createOneImage(db, (body ?? {}) as Obj, origin) };
    },
  },
  ...(['PUT', 'PATCH'] as const).flatMap((method): PluginRoute[] => [
    {
      method,
      path: `${META.image.endpoint}{id}/`,
      handler: async ({ db, params, body }) => {
        const out = await updateOneImage(db, Number(params.id), (body ?? {}) as Obj);
        return out ? { status: 200, body: out } : { status: 404, body: { detail: 'Not found' } };
      },
    },
    {
      method,
      path: META.image.endpoint,
      handler: async ({ db, body }) => {
        if (!Array.isArray(body)) {
          return { status: 400, body: { detail: 'Bulk update expects a list of objects.' } };
        }
        const out: Obj[] = [];
        for (const item of body as Obj[]) {
          const id = Number((item as { id?: unknown }).id);
          if (!id) return { status: 400, body: { detail: 'Each item must include "id".' } };
          const o = await updateOneImage(db, id, item);
          if (o) out.push(o);
        }
        return { status: 200, body: out };
      },
    },
  ]),
];
