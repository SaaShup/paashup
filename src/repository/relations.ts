import type { Db } from '../db/types.js';
import type { RelationMeta, TableMeta } from '../model/meta-types.js';
import { tables } from '../model/metadata.js';
import { ApiError } from '../errors.js';

const TAG_TABLE = 'extras_tag';
const TAGGED_ITEM = 'tagging_taggeditem';
const CHUNK = 900;

const ident = (n: string) => '`' + n.replace(/`/g, '``') + '`';

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
}

/** Accepted forms for a relation value in a request body. */
export type RelationItem = number | { id?: number; name?: string; slug?: string };
export type RelationInput = RelationItem[];

/**
 * Read target ids for many owner rows in bulk:
 *   relationName -> (ownerId -> targetIds[])
 * One query per relation (chunked), so a page of N rows is O(#relations), not O(N).
 */
export async function readRelations(
  db: Db,
  owner: TableMeta,
  ownerIds: readonly number[],
): Promise<Map<string, Map<number, number[]>>> {
  const result = new Map<string, Map<number, number[]>>();
  if (!ownerIds.length) return result;

  for (const rel of owner.relations) {
    const map = new Map<number, number[]>();
    result.set(rel.name, map);
    for (let i = 0; i < ownerIds.length; i += CHUNK) {
      const slice = ownerIds.slice(i, i + CHUNK);
      const ph = slice.map(() => '?').join(', ');
      let rows: Record<string, unknown>[];
      if (rel.kind === 'tags') {
        rows = await db.query(
          `SELECT object_id AS owner, tag_id AS target FROM ${ident(TAGGED_ITEM)} ` +
            `WHERE object_type = ? AND object_id IN (${ph})`,
          [owner.objectType, ...slice],
        );
      } else {
        rows = await db.query(
          `SELECT ${ident(rel.selfColumn!)} AS owner, ${ident(rel.targetColumn!)} AS target ` +
            `FROM ${ident(rel.joinTable!)} WHERE ${ident(rel.selfColumn!)} IN (${ph})`,
          slice,
        );
      }
      for (const r of rows) {
        const o = Number(r.owner);
        (map.get(o) ?? map.set(o, []).get(o)!).push(Number(r.target));
      }
    }
  }
  return result;
}

/** Resolve request items to target ids (creating tags by name when missing). */
async function resolveTargetIds(db: Db, rel: RelationMeta, items: RelationInput): Promise<number[]> {
  const ids: number[] = [];
  for (const item of items) {
    if (typeof item === 'number') {
      ids.push(item);
    } else if (item && typeof item.id === 'number') {
      ids.push(item.id);
    } else if (item && (item.slug || item.name)) {
      const col = item.slug ? 'slug' : 'name';
      const val = (item.slug ?? item.name)!;
      const targetMeta = tables[rel.targetTable as keyof typeof tables] as TableMeta | undefined;
      if (targetMeta && !targetMeta.columns.some((c) => c.column === col)) {
        throw new ApiError(400, `${rel.target} cannot be looked up by ${col}; use an id`);
      }
      const found = await db.get<{ id: number }>(
        `SELECT id FROM ${ident(rel.targetTable)} WHERE ${ident(col)} = ?`,
        [val],
      );
      if (found) {
        ids.push(found.id);
      } else if (rel.kind === 'tags' && item.name) {
        const res = await db.execute(
          `INSERT INTO ${ident(TAG_TABLE)} (name, slug) VALUES (?, ?)`,
          [item.name, slugify(item.name)],
        );
        ids.push(res.insertId);
      } else {
        throw new ApiError(400, `Related ${rel.target} "${val}" does not exist`);
      }
    } else {
      throw new ApiError(400, `Invalid value for relation "${rel.name}"`);
    }
  }
  return [...new Set(ids)];
}

/** Replace the full set of related rows for one owner (NetBox PUT/PATCH semantics). */
export async function syncRelation(
  db: Db,
  owner: TableMeta,
  rel: RelationMeta,
  ownerId: number,
  items: RelationInput,
): Promise<void> {
  const targetIds = await resolveTargetIds(db, rel, items);
  if (rel.kind === 'tags') {
    await db.execute(
      `DELETE FROM ${ident(TAGGED_ITEM)} WHERE object_type = ? AND object_id = ?`,
      [owner.objectType, ownerId],
    );
    for (const tagId of targetIds) {
      await db.execute(
        `INSERT INTO ${ident(TAGGED_ITEM)} (tag_id, object_type, object_id) VALUES (?, ?, ?)`,
        [tagId, owner.objectType, ownerId],
      );
    }
  } else {
    await db.execute(`DELETE FROM ${ident(rel.joinTable!)} WHERE ${ident(rel.selfColumn!)} = ?`, [ownerId]);
    for (const targetId of targetIds) {
      await db.execute(
        `INSERT INTO ${ident(rel.joinTable!)} (${ident(rel.selfColumn!)}, ${ident(rel.targetColumn!)}) VALUES (?, ?)`,
        [ownerId, targetId],
      );
    }
  }
}
