// Global app settings (paashup extension): a small admin-configurable key/value store.
// Starts with the sidebar menu's admin-controlled layout — hidden sections, hidden
// sub-groups within a section, and a custom section order. Table is created by migration
// 0020. Registered at import — server.ts imports this module for the /api/settings/ route.
import type { Db } from './db/types.js';
import { registerRoute } from './plugins/runtime.js';

const HIDDEN_SECTIONS_KEY = 'hidden_sections';
const HIDDEN_GROUPS_KEY = 'hidden_groups'; // each entry is "section::group label"
const SECTION_ORDER_KEY = 'section_order';

async function getSetting(db: Db, key: string): Promise<string | null> {
  const row = await db.get<{ value: string }>(
    `SELECT value FROM app_settings WHERE setting_key = ?`,
    [key],
  );
  return row?.value ?? null;
}

async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db.transaction(async (tx) => {
    const res = await tx.execute(`UPDATE app_settings SET value = ? WHERE setting_key = ?`, [
      value,
      key,
    ]);
    if (res.affectedRows === 0) {
      await tx.execute(`INSERT INTO app_settings (setting_key, value) VALUES (?, ?)`, [key, value]);
    }
  });
}

async function getStringArray(db: Db, key: string): Promise<string[]> {
  const raw = await getSetting(db, key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

async function setStringArray(db: Db, key: string, values: string[]): Promise<void> {
  await setSetting(db, key, JSON.stringify([...new Set(values)]));
}

export interface MenuSettings {
  hidden_sections: string[];
  hidden_groups: string[];
  section_order: string[];
}

export async function getMenuSettings(db: Db): Promise<MenuSettings> {
  return {
    hidden_sections: await getStringArray(db, HIDDEN_SECTIONS_KEY),
    hidden_groups: await getStringArray(db, HIDDEN_GROUPS_KEY),
    section_order: await getStringArray(db, SECTION_ORDER_KEY),
  };
}

const FIELDS = [
  ['hidden_sections', HIDDEN_SECTIONS_KEY],
  ['hidden_groups', HIDDEN_GROUPS_KEY],
  ['section_order', SECTION_ORDER_KEY],
] as const;

// ---- API ----------------------------------------------------------------------
// GET /api/settings/ — readable by anyone authenticated (it only drives sidebar display).
// PUT /api/settings/ — like every other write, rejected for read-only tokens by the
// server's blanket `auth.writeEnabled` guard before custom routes are even reached.
// Accepts any subset of the three fields; omitted ones are left unchanged.

registerRoute({
  method: 'GET',
  path: '/api/settings/',
  handler: async ({ db }) => ({ status: 200, body: await getMenuSettings(db) }),
});

registerRoute({
  method: 'PUT',
  path: '/api/settings/',
  handler: async ({ db, body }) => {
    const b = (body ?? {}) as Record<string, unknown>;
    for (const [field, key] of FIELDS) {
      if (!(field in b)) continue;
      const v = b[field];
      if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) {
        return { status: 400, body: { detail: `${field} must be an array of strings.` } };
      }
      await setStringArray(db, key, v as string[]);
    }
    return { status: 200, body: await getMenuSettings(db) };
  },
});
