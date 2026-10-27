#!/usr/bin/env node
// Deploy-time bootstrap: insert an API token into a paashup SQLite database, so a
// secure-by-default instance (PB_AUTH_REQUIRED=1) has a usable credential. Idempotent:
// re-running with the same key is a no-op. The owning user is find-or-created.
//
// For MariaDB or containerized deploys, prefer the PB_SEED_TOKEN env (applied on boot by
// dist/main.js) — this script is the SQLite, run-it-yourself equivalent.
//
// Usage:
//   node scripts/seed-token.mjs <db-file> [--user NAME] [--key KEY] [--read-only]
//   PB_SQLITE_FILE=./paashup.db node scripts/seed-token.mjs
//
// Prints the token key once (generated if --key is omitted).
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));

const file = positional[0] ?? process.env.PB_SQLITE_FILE;
if (!file) {
  console.error('usage: seed-token.mjs <db-file> [--user NAME] [--key KEY] [--read-only]');
  process.exit(1);
}
const username = flag('--user') ?? 'admin';
const key = flag('--key') ?? randomBytes(20).toString('hex'); // NetBox-style 40-hex
const writeEnabled = args.includes('--read-only') ? 0 : 1;

const db = new DatabaseSync(file);
db.exec('PRAGMA foreign_keys = ON');

// idempotent: skip if this key already exists
const existing = db.prepare('SELECT id FROM auth_token WHERE `key` = ?').get(key);
if (existing) {
  console.log(`token already present (id ${existing.id}); nothing to do`);
  db.close();
  process.exit(0);
}

// find-or-create the owning user
let user = db.prepare('SELECT id FROM users_user WHERE username = ?').get(username);
if (!user) {
  const r = db
    .prepare(
      `INSERT INTO users_user (username, email, first_name, last_name, is_active, date_joined)
       VALUES (?, '', '', '', 1, ?)`,
    )
    .run(username, new Date().toISOString());
  user = { id: Number(r.lastInsertRowid) };
  console.log(`created user "${username}" (id ${user.id})`);
}

const r = db
  .prepare(
    'INSERT INTO auth_token (`key`, user_id, write_enabled, description) VALUES (?, ?, ?, ?)',
  )
  .run(key, user.id, writeEnabled, 'seeded at deploy time (seed-token.mjs)');
db.close();

console.log(`seeded API token id ${Number(r.lastInsertRowid)} for user "${username}"`);
console.log(`  write_enabled: ${writeEnabled ? 'yes' : 'no (read-only)'}`);
console.log(`  use it with:   Authorization: Token ${key}`);
