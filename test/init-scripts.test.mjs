// Core Init script entity (Virtualization): shell scripts run at a new VM's first boot.
//   - the `${NAME:-default}` variables are read from the text (nested, commented, repeated)
//   - launching a VM exports only the variables whose value differs from the default
//   - the API derives `variables` from `content`, and keeps the featured / secret lists
//     in line with the variables the script declares
// Run: node --test test/init-scripts.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';
import { checkScript, parseVariables, renderScript } from '../dist/initscripts.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.initscripts.sqlite');
const SCRIPTS = '/api/virtualization/init-scripts/';

let db, server, base;

const api = async (m, p, b) => {
  const res = await fetch(`${base}${p}`, {
    method: m,
    headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  });
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : undefined };
};

before(async () => {
  rmSync(DB_FILE, { force: true });
  db = new SqliteDb(DB_FILE);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(DB_FILE, { force: true });
});

// ---- reading the variables --------------------------------------------------------------

test('the variables are the ${NAME:-default} of the script, in order', () => {
  const script = [
    '#!/bin/bash',
    'BASE_DOMAIN="${1:-${BASE_DOMAIN:-daily.paashup.cloud}}"',
    'PRIVATE_IFACE="${PRIVATE_IFACE:-ens4}"',
    'AGENT_IMAGE="saashup/netbox-docker-agent:v1.23.0"',
  ].join('\n');
  assert.deepEqual(parseVariables(script), [
    { name: 'BASE_DOMAIN', default: 'daily.paashup.cloud' },
    { name: 'PRIVATE_IFACE', default: 'ens4' },
  ]);
});

test('an empty default, a default holding braces and a repeated variable are read right', () => {
  assert.deepEqual(parseVariables('#!/bin/sh\nA="${A:-}"'), [{ name: 'A', default: '' }]);
  assert.deepEqual(parseVariables('#!/bin/sh\nO="${ORIGINS:-https://${BASE_DOMAIN}}"'), [
    { name: 'ORIGINS', default: 'https://${BASE_DOMAIN}' },
  ]);
  assert.deepEqual(parseVariables('#!/bin/sh\na="${X:-1}"\nb="${X:-2}"'), [
    { name: 'X', default: '1' },
  ]);
});

test('commented lines, literals, positional parameters and unclosed braces are not variables', () => {
  assert.deepEqual(parseVariables('#!/bin/sh\n  # ${C:-x}\nfoo=bar\necho "${1:-a}"'), []);
  assert.deepEqual(parseVariables('#!/bin/sh\necho "${OPEN:-never closed'), []);
  assert.deepEqual(parseVariables(''), []);
});

// ---- launching with values --------------------------------------------------------------

const SAMPLE = '#!/bin/bash\nset -e\nD="${D:-a.b}"\nI="${I:-x}"\n';

test('only the values that differ from the default are exported, right after the shebang', () => {
  const out = renderScript(SAMPLE, { D: 'my.io', I: 'x' });
  assert.deepEqual(out.changed, { D: 'my.io' });
  assert.equal(out.script, '#!/bin/bash\nexport D=\'my.io\'\nset -e\nD="${D:-a.b}"\nI="${I:-x}"\n');
});

test('no changed value leaves the script as it is', () => {
  for (const values of [{}, { D: 'a.b', I: 'x' }]) {
    const out = renderScript(SAMPLE, values);
    assert.equal(out.script, SAMPLE);
    assert.deepEqual(out.changed, {});
  }
});

test('a value is quoted so the shell reads it back unchanged', () => {
  const { script } = renderScript(SAMPLE, { D: `o'k $HOME "q"\nnext` });
  assert.ok(script.includes(`export D='o'\\''k $HOME "q"\nnext'`), script);
});

test('a variable the script does not declare is refused', () => {
  assert.throws(() => renderScript(SAMPLE, { NOPE: '1' }), /no variable "NOPE"/);
  assert.throws(() => renderScript(SAMPLE, { D: 'a\0b' }), /NUL/);
});

test('a script needs a shebang, no NUL, and must fit what Nova accepts', () => {
  assert.equal(checkScript(SAMPLE), null);
  assert.match(checkScript('echo hi'), /shebang/);
  assert.match(checkScript('#!/bin/sh\0'), /NUL/);
  assert.equal(checkScript('#!/bin/sh\n' + 'x'.repeat(49000)), null);
  assert.match(checkScript('#!/bin/sh\n' + 'x'.repeat(60000)), /too large/);
});

// ---- the API ----------------------------------------------------------------------------

test('a script is stored with the variables the server reads from it', async () => {
  const res = await api('POST', SCRIPTS, {
    name: 'paashup',
    description: 'base install',
    content: SAMPLE,
    variables: [{ name: 'forged', default: 'x' }], // never taken from the client
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.deepEqual(res.body.variables, [
    { name: 'D', default: 'a.b' },
    { name: 'I', default: 'x' },
  ]);
  assert.deepEqual(res.body.featured_variables, []);
  assert.deepEqual(res.body.secret_variables, []);
  const got = (await api('GET', `${SCRIPTS}${res.body.id}/`)).body;
  assert.equal(got.content, SAMPLE);
  assert.equal((await api('GET', SCRIPTS)).body.count, 1);
});

test('a script must start with a shebang, and its name is unique', async () => {
  const noShebang = await api('POST', SCRIPTS, { name: 'bad', content: 'echo hi' });
  assert.equal(noShebang.status, 400);
  assert.match(noShebang.body.content[0], /shebang/);
  assert.equal((await api('POST', SCRIPTS, { name: 'bad' })).status, 400, 'content is required');
  const dup = await api('POST', SCRIPTS, { name: 'paashup', content: SAMPLE });
  assert.equal(dup.status, 400);
});

test('the featured and secret lists are accepted, and cut to the declared variables', async () => {
  const res = await api('POST', SCRIPTS, {
    name: 'lists',
    content: SAMPLE,
    featured_variables: ['D', 'GHOST'],
    secret_variables: ['I'],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.deepEqual(res.body.featured_variables, ['D']);
  assert.deepEqual(res.body.secret_variables, ['I']);

  // the lists alone can be changed
  const only = await api('PATCH', `${SCRIPTS}${res.body.id}/`, { secret_variables: ['D', 'I'] });
  assert.equal(only.status, 200);
  assert.deepEqual(only.body.secret_variables, ['D', 'I']);
  assert.deepEqual(only.body.featured_variables, ['D']);

  for (const bad of ['D', [1], { D: true }]) {
    const r = await api('PATCH', `${SCRIPTS}${res.body.id}/`, { featured_variables: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.match(r.body.featured_variables[0], /list of variable names/);
  }
});

test('editing the text recomputes the variables and drops the ones that are gone', async () => {
  const { body: s } = await api('POST', SCRIPTS, {
    name: 'edited',
    content: SAMPLE,
    featured_variables: ['D', 'I'],
    secret_variables: ['I'],
  });
  const res = await api('PATCH', `${SCRIPTS}${s.id}/`, {
    content: '#!/bin/bash\nD="${D:-new}"\nN="${N:-1}"\n',
    featured_variables: ['D', 'I'],
    secret_variables: ['I'],
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.variables, [
    { name: 'D', default: 'new' },
    { name: 'N', default: '1' },
  ]);
  assert.deepEqual(res.body.featured_variables, ['D']);
  assert.deepEqual(res.body.secret_variables, []);

  const bad = await api('PATCH', `${SCRIPTS}${s.id}/`, { content: 'no shebang' });
  assert.equal(bad.status, 400);
  assert.equal(
    (await api('GET', `${SCRIPTS}${s.id}/`)).body.content,
    '#!/bin/bash\nD="${D:-new}"\nN="${N:-1}"\n',
    'a refused edit changes nothing',
  );
});

test('a script is deleted', async () => {
  const { body: s } = await api('POST', SCRIPTS, { name: 'gone', content: SAMPLE });
  assert.equal((await api('DELETE', `${SCRIPTS}${s.id}/`)).status, 204);
  assert.equal((await api('GET', `${SCRIPTS}${s.id}/`)).status, 404);
});
