<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useUiStore } from '../stores/ui.js';
import { api, type Obj } from '../api/client.js';
import { CONTAINER_COLLECTIONS, CONTAINER_SCALARS, scalarText, rowsOf } from './containerDetail.js';
import CollectionTable from '../components/CollectionTable.vue';
import ObjectForm from '../components/ObjectForm.vue';

const ui = useUiStore();
const resource = computed(() => ui.selected); // the container resource (endpoint/model/writable)
const container = ref<Obj | null>(null);
const loading = ref(false);
const error = ref('');
const editing = ref(false);

const get = (k: string): unknown => (container.value as Record<string, unknown> | null)?.[k];
const title = computed(() => scalarText(get('display') ?? get('name')));
const host = computed(() => get('host'));
const image = computed(() => get('image'));
const scalars = computed(() =>
  CONTAINER_SCALARS.map((s) => ({ label: s.label, value: scalarText(get(s.key)) })),
);
const rows = (field: string): Obj[] => (container.value ? rowsOf(container.value, field) : []);
const writable = computed(() => !!resource.value?.writable);

// Editable Environment variables. They're the container's `env` child collection: a
// PATCH with the full `env` array replaces it (see routes/containers.ts), so add/edit/
// delete all work by sending the edited array.
interface EnvRow {
  var_name: string;
  value: string;
}
const envDraft = ref<EnvRow[]>([]);
const envDirty = ref(false);
const envSaving = ref(false);

function initEnv() {
  envDraft.value = rows('env').map((r) => ({
    var_name: String((r as Record<string, unknown>).var_name ?? ''),
    value: String((r as Record<string, unknown>).value ?? ''),
  }));
  envDirty.value = false;
}
function addEnv() {
  envDraft.value.push({ var_name: '', value: '' });
  envDirty.value = true;
}
function removeEnv(i: number) {
  envDraft.value.splice(i, 1);
  envDirty.value = true;
}
async function saveEnv() {
  const r = resource.value;
  const id = ui.detailId;
  if (!r || id == null) return;
  const env = envDraft.value
    .map((e) => ({ var_name: e.var_name.trim(), value: e.value }))
    .filter((e) => e.var_name);
  envSaving.value = true;
  error.value = '';
  try {
    await api.update(r.endpoint, id, { env }); // replaces the env collection
    await load(); // re-fetch (re-inits the draft)
  } catch (e) {
    error.value = String(e);
  } finally {
    envSaving.value = false;
  }
}

async function load() {
  const r = resource.value;
  const id = ui.detailId;
  if (!r || id == null) return;
  loading.value = true;
  error.value = '';
  try {
    container.value = await api.retrieve<Obj>(r.endpoint, id);
    initEnv();
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => ui.detailId, load); // re-fetch if another container is opened

function back() {
  if (resource.value) ui.openResource(resource.value);
}
/** Jump to the host/image resource list. */
function openTable(table: string) {
  const r = ui.resources.find((x) => x.table === table);
  if (r) ui.openResource(r);
}
async function onSaved() {
  editing.value = false;
  await load();
}
</script>

<template>
  <div v-if="resource" class="detail">
    <div class="crumb muted">
      {{ resource.section.toUpperCase() }} › {{ resource.label }} › detail
    </div>
    <div class="head">
      <button class="btn btn-ghost" @click="back">‹ Back</button>
      <h2>{{ title || 'Container' }}</h2>
      <span class="spacer" />
      <button v-if="resource.writable" class="btn btn-ok" @click="editing = true">Edit</button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">Loading…</p>

    <template v-if="container && !loading">
      <!-- core properties -->
      <section class="card props">
        <div class="prop">
          <span class="k">Host</span>
          <button v-if="host" class="link" @click="openTable('plugin_docker_host')">
            {{ scalarText(host) }}
          </button>
          <span v-else class="v">—</span>
        </div>
        <div class="prop">
          <span class="k">Image</span>
          <button v-if="image" class="link" @click="openTable('plugin_docker_image')">
            {{ scalarText(image) }}
          </button>
          <span v-else class="v">—</span>
        </div>
        <div v-for="s in scalars" :key="s.label" class="prop">
          <span class="k">{{ s.label }}</span>
          <span class="v">{{ s.value }}</span>
        </div>
      </section>

      <!-- attached collections (env is editable when the container is writable) -->
      <template v-for="c in CONTAINER_COLLECTIONS" :key="c.field">
        <section v-if="c.field === 'env' && writable" class="collection env-editor">
          <h4>
            {{ c.title }}
            <span class="n">{{ envDraft.length }}</span>
            <span class="spacer" />
            <button class="btn btn-ghost sm" @click="addEnv">+ Add</button>
            <button class="btn btn-ok sm" :disabled="!envDirty || envSaving" @click="saveEnv">
              {{ envSaving ? 'Saving…' : 'Save' }}
            </button>
            <button class="btn btn-ghost sm" :disabled="!envDirty || envSaving" @click="initEnv">
              Discard
            </button>
          </h4>
          <p v-if="!envDraft.length" class="empty">{{ c.empty }}</p>
          <table v-else class="env-table">
            <thead>
              <tr>
                <th>Variable</th>
                <th>Value</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in envDraft" :key="i">
                <td>
                  <input v-model="row.var_name" placeholder="VAR_NAME" @input="envDirty = true" />
                </td>
                <td><input v-model="row.value" placeholder="value" @input="envDirty = true" /></td>
                <td>
                  <button class="btn btn-ghost sm danger" title="Remove" @click="removeEnv(i)">
                    ✕
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
        <CollectionTable
          v-else
          :title="c.title"
          :empty="c.empty"
          :rows="rows(c.field)"
          :columns="c.columns"
        />
      </template>
    </template>

    <ObjectForm
      v-if="editing && resource.model"
      :model="resource.model"
      :endpoint="resource.endpoint"
      :object="container"
      @saved="onSaved"
      @cancel="editing = false"
    />
  </div>
</template>

<style scoped>
.crumb {
  font-size: 0.78rem;
  margin-bottom: 4px;
}
.head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 14px;
}
.head h2 {
  margin: 0;
  font-size: 1.4rem;
}
.spacer {
  flex: 1;
}
.error {
  color: var(--danger);
}
.props {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px 24px;
  padding: 16px 18px;
}
.prop {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.k {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--muted);
}
.v {
  overflow-wrap: anywhere;
}
.link {
  align-self: flex-start;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--primary-d);
  font: inherit;
  text-align: left;
}
.link:hover {
  text-decoration: underline;
}
/* editable Environment variables section */
.env-editor {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 14px;
}
.env-editor h4 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 10px;
}
.env-editor .n {
  font-size: 0.8rem;
  color: var(--muted);
}
.env-editor .spacer {
  flex: 1;
}
.env-editor .empty {
  color: var(--muted);
  margin: 4px 0 0;
}
.btn.sm {
  padding: 3px 9px;
  font-size: 0.8rem;
}
.btn.danger {
  color: var(--danger);
}
.env-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
.env-table th,
.env-table td {
  text-align: left;
  padding: 4px 8px 4px 0;
}
.env-table input {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 7px;
  border: 1px solid var(--border);
  border-radius: 5px;
  font: inherit;
}
.env-table td:last-child {
  width: 1%;
  white-space: nowrap;
}
</style>
