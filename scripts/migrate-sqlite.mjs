#!/usr/bin/env node
// Node-native SQLite migration runner (no Python needed) — handy inside the
// Docker image for the small-customer SQLite case. Applies migrations/*.sqlite.sql
// in order, tracked in a schema_migrations table.
//
// Usage: node scripts/migrate-sqlite.mjs <db-file>   (or set PB_SQLITE_FILE)
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'migrations');

const file = process.argv[2] ?? process.env.PB_SQLITE_FILE;
if (!file) {
  console.error('usage: migrate-sqlite.mjs <db-file>  (or set PB_SQLITE_FILE)');
  process.exit(1);
}

const db = new DatabaseSync(file);
db.exec('PRAGMA foreign_keys = ON');
db.exec(
  `CREATE TABLE IF NOT EXISTS schema_migrations (
     version TEXT PRIMARY KEY,
     applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
);

const applied = new Set(
  db
    .prepare('SELECT version FROM schema_migrations')
    .all()
    .map((r) => r.version),
);

const migrations = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sqlite.sql'))
  .map((f) => ({ version: f.slice(0, -'.sqlite.sql'.length), file: join(MIGRATIONS, f) }))
  .sort((a, b) => a.version.localeCompare(b.version));

let n = 0;
for (const m of migrations) {
  if (applied.has(m.version)) continue;
  process.stdout.write(`Applying ${m.version} ... `);
  db.exec(readFileSync(m.file, 'utf8'));
  db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(m.version);
  console.log('ok');
  n++;
}
console.log(n ? `Done. ${n} migration(s) applied.` : 'Already up to date.');
db.close();
