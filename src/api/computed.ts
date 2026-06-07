import type { Db } from '../db/types.js';
import type { TableMeta } from '../model/meta-types.js';

const ident = (n: string) => '`' + n.replace(/`/g, '``') + '`';

/** Columns whose value reveals the IP family (presence of ':' => IPv6). */
const IP_FIELDS = ['prefix', 'address', 'start_address'];

/**
 * Compute NetBox read-only fields that aren't stored as columns:
 *   - `family`  -> { value: 4|6, label: "IPv4"|"IPv6" } for IP-bearing models
 *   - `children`, `_depth` for parent-FK tree models (Region, Location, …)
 * Returns ownerId -> { field: value }. Batched: at most one extra query (the
 * tree's id/parent map), regardless of page size.
 */
export async function computeFields(
  db: Db,
  meta: TableMeta,
  rows: Record<string, unknown>[],
): Promise<Map<number | string, Record<string, unknown>>> {
  const pid = (raw: unknown): number | string =>
    meta.pkKind === 'string' ? String(raw) : Number(raw);
  const out = new Map<number | string, Record<string, unknown>>();
  for (const r of rows) out.set(pid(r[meta.pk]), {});
  if (!rows.length) return out;

  // family
  const ipField = IP_FIELDS.find((f) => meta.columns.some((c) => c.name === f));
  if (ipField) {
    for (const r of rows) {
      const v = r[ipField];
      if (typeof v === 'string') {
        const fam = v.includes(':') ? 6 : 4;
        out.get(pid(r[meta.pk]))!.family = { value: fam, label: `IPv${fam}` };
      }
    }
  }

  // reverse-FK counts (device_count, prefix_count, …): one grouped query each
  if (meta.counts.length) {
    const ids = rows.map((r) => pid(r[meta.pk]));
    const ph = ids.map(() => '?').join(', ');
    for (const spec of meta.counts) {
      const counts = new Map<number | string, number>();
      const grouped = await db.query<{ owner: unknown; n: number }>(
        `SELECT ${ident(spec.column)} AS owner, COUNT(*) AS n FROM ${ident(spec.table)} ` +
          `WHERE ${ident(spec.column)} IN (${ph}) GROUP BY ${ident(spec.column)}`,
        ids,
      );
      for (const g of grouped) counts.set(pid(g.owner), Number(g.n));
      for (const r of rows) {
        out.get(pid(r[meta.pk]))![spec.name] = counts.get(pid(r[meta.pk])) ?? 0;
      }
    }
  }

  // tree models: a self-referential `parent` FK
  const parentCol = meta.columns.find((c) => c.name === 'parent' && c.references === meta.model);
  if (parentCol) {
    const all = await db.query<{ id: number; parent: number | null }>(
      `SELECT ${ident(meta.pk)} AS id, ${ident(parentCol.column)} AS parent FROM ${ident(meta.table)}`,
    );
    const parentOf = new Map<number, number | null>();
    const childCount = new Map<number, number>();
    for (const row of all) {
      const id = Number(row.id);
      const parent = row.parent == null ? null : Number(row.parent);
      parentOf.set(id, parent);
      if (parent != null) childCount.set(parent, (childCount.get(parent) ?? 0) + 1);
    }
    const depthMemo = new Map<number, number>();
    const depth = (id: number): number => {
      if (depthMemo.has(id)) return depthMemo.get(id)!;
      let d = 0;
      let cur = parentOf.get(id) ?? null;
      const guard = new Set<number>([id]); // cycle safety
      while (cur != null && !guard.has(cur)) {
        d++;
        guard.add(cur);
        cur = parentOf.get(cur) ?? null;
      }
      depthMemo.set(id, d);
      return d;
    };
    for (const r of rows) {
      const id = Number(r[meta.pk]);
      const extra = out.get(id)!;
      extra._depth = depth(id);
      extra.children = childCount.get(id) ?? 0;
    }
  }

  return out;
}
