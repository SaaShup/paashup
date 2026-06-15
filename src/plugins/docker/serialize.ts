// NetBox-shaped serialization for the Docker entities. The engine `Serializer`
// produces the base object (url/display/display_url, choice {value,label}, tags,
// custom_fields); we then (a) re-project foreign keys to the exact brief field sets
// the source Nested*Serializers expose, and (b) attach the nested reverse-FK arrays
// the source embeds (Host→images/…/containers, Container→ports/env/…). Child tables
// are not registered entities, so their rows are read with raw SQL.
import type { Db } from '../../db/types.js';
import { Serializer } from '../../api/serializer.js';
import { Repository } from '../../repository/repository.js';
import { getTable } from '../../model/registry.js';
import { BRIEF_FIELDS, CHILD_SPECS, T, type ChildSpec } from './meta.js';

type Row = Record<string, unknown>;
type Obj = Record<string, unknown>;

/** Routes get no request Host header, so absolute URLs come from BASE_URL (else relative). */
const baseUrl = (): string => process.env.BASE_URL ?? '';

const ident = (name: string): string => '`' + name.replace(/`/g, '``') + '`';

/** Project a full serialized object down to a Nested*Serializer field set. */
function brief(obj: Obj | null, table: string): Obj | null {
  if (!obj) return null;
  const out: Obj = {};
  for (const f of BRIEF_FIELDS[table] ?? []) if (f in obj) out[f] = obj[f];
  return out;
}

/** Fetch one top-level row by id and render it as a brief. */
async function briefOf(db: Db, ser: Serializer, table: string, id: unknown): Promise<Obj | null> {
  if (id === null || id === undefined) return null;
  const repo = new Repository<Row>(db, getTable(table)!);
  const row = await repo.retrieve(Number(id));
  if (!row) return null;
  return brief(await ser.object(table, row), table);
}

/** Render every top-level row whose `fkField` points at `parentId` as a brief array. */
async function briefList(
  db: Db,
  ser: Serializer,
  table: string,
  fkField: string,
  parentId: number,
): Promise<Obj[]> {
  const repo = new Repository<Row>(db, getTable(table)!);
  const { results } = await repo.list({
    filters: { [fkField]: parentId },
    ordering: 'id',
    limit: 1000,
  });
  const full = await ser.objects(table, results);
  return full.map((o) => brief(o, table)!);
}

/** Replace the engine's generic FK briefs with the source's exact brief field sets. */
async function fixFkBriefs(
  db: Db,
  ser: Serializer,
  base: Obj,
  overrides: readonly (readonly [string, string])[],
): Promise<void> {
  for (const [field, table] of overrides) {
    const ref = base[field];
    const id = ref && typeof ref === 'object' ? (ref as { id?: unknown }).id : ref;
    base[field] = await briefOf(db, ser, table, id);
  }
}

/** Serialize the nine nested container children (raw SQL — they have no endpoint). */
async function serializeChildren(
  db: Db,
  ser: Serializer,
  spec: ChildSpec,
  containerId: number,
): Promise<Obj[]> {
  const cols = spec.columns.map((c) => ident(c.column)).join(', ');
  const rows = await db.query<Row>(
    `SELECT ${cols} FROM ${ident(spec.table)} WHERE container_id = ? ORDER BY id ASC`,
    [containerId],
  );
  const out: Obj[] = [];
  for (const r of rows) {
    const o: Obj = {};
    for (const field of spec.serialFields) {
      const col = spec.columns.find((c) => c.name === field)!;
      const v = r[col.column];
      if (col.fk) o[field] = await briefOf(db, ser, col.fk.table, v);
      else if (col.kind === 'boolean') o[field] = Boolean(v);
      else if (col.kind === 'number') o[field] = v === null || v === undefined ? null : Number(v);
      else o[field] = v ?? null;
    }
    out.push(o);
  }
  return out;
}

/** Full container object: base + re-projected host/image briefs + nested children. */
export async function serializeContainer(db: Db, row: Row): Promise<Obj> {
  const ser = new Serializer(db, baseUrl());
  const base = await ser.object(T.container, row);
  await fixFkBriefs(db, ser, base, [
    ['host', T.host],
    ['image', T.image],
  ]);
  const id = Number(row.id);
  for (const spec of CHILD_SPECS) base[spec.field] = await serializeChildren(db, ser, spec, id);
  return base;
}

export async function serializeHost(
  db: Db,
  row: Row,
  opts: { withToken?: boolean } = {},
): Promise<Obj> {
  const ser = new Serializer(db, baseUrl());
  const base = await ser.object(T.host, row);
  const id = Number(row.id);
  base.images = await briefList(db, ser, T.image, 'host', id);
  base.volumes = await briefList(db, ser, T.volume, 'host', id);
  base.networks = await briefList(db, ser, T.network, 'host', id);
  base.containers = await briefList(db, ser, T.container, 'host', id);
  base.registries = await briefList(db, ser, T.registry, 'host', id);
  // The host's agent token is sensitive — exposed only when explicitly requested
  // (the create response + the "[Docker] Add host" webhook), never on plain reads.
  if (opts.withToken) {
    const tok = await db
      .get<{
        key: string;
      }>(
        `SELECT k.\`key\` AS key FROM ${ident(T.host)} h JOIN auth_token k ON k.id = h.token_id WHERE h.id = ?`,
        [id],
      )
      .catch(() => undefined); // auth_token may be absent on minimal deploys
    base.token = tok ? { key: tok.key } : null;
  }
  return base;
}

export async function serializeImage(db: Db, row: Row): Promise<Obj> {
  const ser = new Serializer(db, baseUrl());
  const base = await ser.object(T.image, row);
  await fixFkBriefs(db, ser, base, [
    ['host', T.host],
    ['registry', T.registry],
  ]);
  base.containers = await briefList(db, ser, T.container, 'image', Number(row.id));
  return base;
}

export async function serializeRegistry(db: Db, row: Row): Promise<Obj> {
  const ser = new Serializer(db, baseUrl());
  const base = await ser.object(T.registry, row);
  await fixFkBriefs(db, ser, base, [['host', T.host]]);
  base.images = await briefList(db, ser, T.image, 'registry', Number(row.id));
  return base;
}

export async function serializeVolume(db: Db, row: Row): Promise<Obj> {
  const ser = new Serializer(db, baseUrl());
  const base = await ser.object(T.volume, row);
  await fixFkBriefs(db, ser, base, [['host', T.host]]);
  // Volume.mounts → NestedMountSerializer {id, source, read_only}
  const rows = await db.query<Row>(
    `SELECT id, source, read_only FROM ${ident(T.mount)} WHERE volume_id = ? ORDER BY id ASC`,
    [Number(row.id)],
  );
  base.mounts = rows.map((r) => ({
    id: Number(r.id),
    source: r.source,
    read_only: Boolean(r.read_only),
  }));
  return base;
}

export async function serializeNetwork(db: Db, row: Row): Promise<Obj> {
  const ser = new Serializer(db, baseUrl());
  const base = await ser.object(T.network, row);
  await fixFkBriefs(db, ser, base, [['host', T.host]]);
  // Network.network_settings → NestedNetworkSettingSerializer {id, network(brief)}
  const rows = await db.query<Row>(
    `SELECT id, network_id FROM ${ident(T.networkSetting)} WHERE network_id = ? ORDER BY id ASC`,
    [Number(row.id)],
  );
  const out: Obj[] = [];
  for (const r of rows) {
    out.push({ id: Number(r.id), network: await briefOf(db, ser, T.network, r.network_id) });
  }
  base.network_settings = out;
  return base;
}
