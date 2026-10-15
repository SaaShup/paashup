<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api, ApiError, type Obj } from '../api/client.js';
import { confirmDialog } from '../composables/confirm.js';

const ENDPOINT = '/api/users/tokens/';

interface TokenRow {
  id: number;
  description: string;
  write_enabled: boolean;
  expires: string | null;
  created: string | null;
  last_used: string | null;
  key: string; // masked
  last4: string;
}

const tokens = ref<TokenRow[]>([]);
const loading = ref(true);
const error = ref('');
const denied = ref(false);

// create form
const description = ref('');
const expires = ref(''); // yyyy-mm-dd, optional
const readonly = ref(false);
const busy = ref(false);

// one-time reveal of a freshly created key
const newKey = ref('');
const copied = ref(false);

function fmt(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

async function load() {
  loading.value = true;
  error.value = '';
  denied.value = false;
  try {
    const page = await api.list<TokenRow>(ENDPOINT);
    tokens.value = page.results;
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) denied.value = true;
    else error.value = String(e);
  } finally {
    loading.value = false;
  }
}

async function create() {
  busy.value = true;
  error.value = '';
  try {
    const body: Obj = { description: description.value, write_enabled: !readonly.value };
    if (expires.value) body.expires = new Date(expires.value).toISOString();
    const created = await api.create<TokenRow & { key: string }>(ENDPOINT, body);
    newKey.value = created.key; // full key, shown once
    copied.value = false;
    description.value = '';
    expires.value = '';
    readonly.value = false;
    await load();
  } catch (e) {
    if (e instanceof ApiError && e.detail && typeof e.detail === 'object') {
      error.value = JSON.stringify(e.detail);
    } else error.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function copyKey() {
  try {
    await navigator.clipboard.writeText(newKey.value);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}

async function revoke(t: TokenRow) {
  const ok = await confirmDialog({
    title: 'Revoke API key',
    message: `Revoke this API key${t.description ? ` ("${t.description}")` : ''}? This cannot be undone.`,
    confirmLabel: 'Revoke',
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await api.remove(ENDPOINT, t.id);
    if (newKey.value && newKey.value.endsWith(t.last4)) newKey.value = '';
    await load();
  } catch (e) {
    error.value = String(e);
  }
}

onMounted(load);
</script>

<template>
  <div class="api-keys">
    <header class="head">
      <h2>API keys</h2>
      <p class="sub">
        Authenticate machine/API clients without an interactive login. Send the key as
        <code>Authorization: Token &lt;key&gt;</code>.
      </p>
    </header>

    <p v-if="denied" class="notice warn">
      You need to be signed in with permission to manage API keys.
    </p>
    <p v-else-if="error" class="notice err">{{ error }}</p>

    <template v-if="!denied">
      <!-- one-time reveal -->
      <div v-if="newKey" class="reveal card">
        <strong>Copy your new API key now — it won't be shown again.</strong>
        <div class="reveal-row">
          <code class="key">{{ newKey }}</code>
          <button class="btn" @click="copyKey">{{ copied ? 'Copied ✓' : 'Copy' }}</button>
          <button class="btn ghost" @click="newKey = ''">Dismiss</button>
        </div>
      </div>

      <!-- create -->
      <form class="create card" @submit.prevent="create">
        <h3>Create a key</h3>
        <div class="fields">
          <label>
            Name / description
            <input v-model="description" type="text" placeholder="e.g. CI deploy bot" />
          </label>
          <label>
            Expiration <span class="opt">(optional)</span>
            <input v-model="expires" type="date" />
          </label>
          <label class="check">
            <input v-model="readonly" type="checkbox" />
            Read-only (cannot create/update/delete)
          </label>
        </div>
        <button class="btn" type="submit" :disabled="busy">
          {{ busy ? 'Creating…' : 'Create key' }}
        </button>
      </form>

      <!-- list -->
      <div class="card">
        <h3>Your keys</h3>
        <p v-if="loading" class="muted">Loading…</p>
        <p v-else-if="!tokens.length" class="muted">No API keys yet.</p>
        <div v-else class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th>Description</th>
                <th>Key</th>
                <th>Access</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Expires</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in tokens" :key="t.id">
                <td>{{ t.description || '—' }}</td>
                <td>
                  <code class="masked">{{ t.key }}</code>
                </td>
                <td>
                  <span class="badge" :class="t.write_enabled ? 'rw' : 'ro'">
                    {{ t.write_enabled ? 'Read-write' : 'Read-only' }}
                  </span>
                </td>
                <td>{{ fmt(t.created) }}</td>
                <td>{{ fmt(t.last_used) }}</td>
                <td>{{ fmt(t.expires) }}</td>
                <td><button class="btn ghost danger" @click="revoke(t)">Revoke</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.api-keys {
  max-width: 960px;
}
.head h2 {
  margin: 0 0 4px;
}
.sub {
  color: #555;
  margin: 0 0 16px;
  font-size: 0.9rem;
}
code {
  background: #f1f5f9;
  padding: 1px 5px;
  border-radius: 4px;
}
.card {
  background: white;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px 18px;
  margin-bottom: 16px;
}
.card h3 {
  margin: 0 0 12px;
}
.reveal {
  border-color: var(--primary);
  background: #f0f9ff;
}
.reveal-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.key {
  font-size: 0.95rem;
  word-break: break-all;
}
.fields {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-bottom: 12px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.85rem;
  color: #555;
}
label.check {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  align-self: flex-end;
}
.opt {
  color: #999;
}
input[type='text'],
input[type='date'] {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font: inherit;
}
.btn {
  padding: 7px 14px;
  border-radius: 6px;
  border: 1px solid var(--primary);
  background: var(--primary);
  color: white;
  cursor: pointer;
}
.btn:hover {
  background: var(--primary-d);
}
.btn.ghost {
  background: white;
  color: var(--text);
  border-color: var(--border);
}
.btn.danger {
  color: var(--danger);
  border-color: var(--danger);
}
.table-wrap {
  overflow-x: auto;
}
.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}
.grid th,
.grid td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}
.masked {
  letter-spacing: 1px;
}
.badge {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 999px;
}
.badge.rw {
  background: #dcfce7;
  color: #166534;
}
.badge.ro {
  background: #f1f5f9;
  color: #475569;
}
.muted {
  color: #888;
}
.notice {
  padding: 10px 12px;
  border-radius: 8px;
  margin-bottom: 16px;
  font-size: 0.9rem;
}
.notice.warn {
  background: #fef9c3;
  color: #854d0e;
}
.notice.err {
  background: #fee2e2;
  color: #991b1b;
}
</style>
