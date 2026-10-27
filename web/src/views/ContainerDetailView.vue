<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useUiStore } from '../stores/ui.js';
import { useConnectionStore } from '../stores/connection.js';
import type { Route } from '../router.js';
import RouteLink from '../components/RouteLink.vue';
import { api, type Obj } from '../api/client.js';
import {
  CONTAINER_COLLECTIONS,
  CONTAINER_SCALARS,
  scalarText,
  rowsOf,
  draftRows,
  blankRow,
  collectionPayload,
  type CollectionDef,
  type DraftRow,
} from './containerDetail.js';
import CollectionTable from '../components/CollectionTable.vue';
import ObjectForm from '../components/ObjectForm.vue';
import ContainerLogs from '../components/ContainerLogs.vue';
import StatusPill from '../components/StatusPill.vue';
import { pillFor } from '../format.js';
import { confirmDialog } from '../composables/confirm.js';
import ContainerTerminal from '../components/ContainerTerminal.vue';

const ui = useUiStore();
const connection = useConnectionStore();
const resource = computed(() => ui.selected); // the container resource (endpoint/model/writable)
const container = ref<Obj | null>(null);
const loading = ref(false);
const error = ref('');
const editing = ref(false);

// Lifecycle ops: PATCH the container's `operation`, which fires the agent webhook (the
// agent performs the real action); the WebSocket 'updated' event then refreshes the state.
const OP_BTNS = [
  { op: 'start', label: 'Start', cls: 'op-start', danger: false },
  { op: 'restart', label: 'Restart', cls: 'op-restart', danger: false },
  { op: 'stop', label: 'Stop', cls: 'op-stop', danger: true },
  { op: 'kill', label: 'Kill', cls: 'op-kill', danger: true },
  { op: 'recreate', label: 'Recreate', cls: 'op-recreate', danger: true },
] as const;
const runningOp = ref<string | null>(null);

async function runOp(op: string, danger: boolean) {
  const r = resource.value;
  const id = ui.detailId;
  if (!r || id == null) return;
  if (danger) {
    const ok = await confirmDialog({
      title: `Run "${op}"`,
      message: `Run "${op}" on ${title.value || 'this container'}?`,
      confirmLabel: 'Run',
      tone: 'danger',
    });
    if (!ok) return;
  }
  runningOp.value = op;
  error.value = '';
  try {
    await api.update(r.endpoint, id, { operation: op });
  } catch (e) {
    error.value = String(e);
  } finally {
    runningOp.value = null;
  }
}

const get = (k: string): unknown => (container.value as Record<string, unknown> | null)?.[k];
const title = computed(() => scalarText(get('display') ?? get('name')));
const host = computed(() => get('host'));
const image = computed(() => get('image'));
const scalars = computed(() =>
  CONTAINER_SCALARS.map((s) => ({
    label: s.label,
    value: scalarText(get(s.key)),
    pill: pillFor('plugin_docker_container', s.key, get(s.key)),
  })),
);
const rows = (field: string): Obj[] => (container.value ? rowsOf(container.value, field) : []);
const writable = computed(() => !!resource.value?.writable);

// Editable collections. Each is a child collection of the container: a PATCH with the
// full array replaces it (see routes/containers.ts), so add/edit/delete all work by
// sending the edited array.
const drafts = ref<Record<string, DraftRow[]>>({});
const dirty = ref<Record<string, boolean>>({});
const savingField = ref<string | null>(null);
/** FK picker options per target table (volumes / networks of this host). */
const fkOptions = ref<Record<string, { id: number; display: string }[]>>({});

function addFkOption(table: string, opt: { id: number; display: string }) {
  const list = (fkOptions.value[table] ??= []);
  if (!list.some((o) => o.id === opt.id)) list.push(opt);
}

function initDraft(c: CollectionDef) {
  drafts.value[c.field] = container.value ? draftRows(container.value, c) : [];
  dirty.value[c.field] = false;
}

function initDrafts() {
  fkOptions.value = {};
  for (const c of CONTAINER_COLLECTIONS) {
    initDraft(c);
    for (const col of c.columns) {
      if (!col.fkTable) continue;
      for (const r of rows(c.field)) {
        const v = (r as Record<string, unknown>)[col.key];
        if (v && typeof v === 'object' && (v as { id?: number }).id != null) {
          addFkOption(col.fkTable, { id: (v as { id: number }).id, display: scalarText(v) });
        }
      }
    }
  }
}

/** Load the host's volumes/networks. */
async function loadFkOptions() {
  const hostId = (host.value as { id?: number } | null)?.id;
  if (hostId == null) return;
  const tables = new Set<string>();
  for (const c of CONTAINER_COLLECTIONS)
    for (const col of c.columns) if (col.fkTable) tables.add(col.fkTable);
  for (const table of tables) {
    const r = ui.resources.find((x) => x.table === table);
    if (!r) continue;
    try {
      const page = await api.list(r.endpoint, { host: String(hostId), limit: 200 });
      for (const o of page.results) {
        const row = o as { id: number; display?: unknown; name?: unknown };
        addFkOption(table, { id: row.id, display: String(row.display ?? row.name ?? row.id) });
      }
    } catch {
      /* picker keeps only the seeded current values */
    }
  }
}

function addRow(c: CollectionDef) {
  (drafts.value[c.field] ??= []).push(blankRow(c));
  dirty.value[c.field] = true;
}
function removeRow(c: CollectionDef, i: number) {
  drafts.value[c.field]?.splice(i, 1);
  dirty.value[c.field] = true;
}
async function saveCollection(c: CollectionDef) {
  const r = resource.value;
  const id = ui.detailId;
  if (!r || id == null) return;
  savingField.value = c.field;
  error.value = '';
  try {
    // replaces this one child collection
    await api.update(r.endpoint, id, {
      [c.field]: collectionPayload(c, drafts.value[c.field] ?? []),
    });
    await load(); // re-fetch (re-inits the drafts)
  } catch (e) {
    error.value = String(e);
  } finally {
    savingField.value = null;
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
    initDrafts();
    void loadFkOptions();
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(
  () => connection.log[0],
  (e) => {
    if (!e || e.event !== 'updated' || !container.value) return;
    if (e.table !== resource.value?.table || e.id !== ui.detailId) return;
    const data = e.data as Record<string, unknown> | undefined;
    if (!data) return;
    const next: Record<string, unknown> = { ...container.value };
    for (const s of CONTAINER_SCALARS) if (s.key in data) next[s.key] = data[s.key];
    container.value = next as Obj;
  },
);
watch(() => ui.detailId, load); // re-fetch if another container is opened

// ---- tabs: Container (properties + collections) / Logs / Terminal ----------------------
type Tab = 'container' | 'logs' | 'terminal';
const TABS: { id: Tab; label: string }[] = [
  { id: 'container', label: 'Container' },
  { id: 'logs', label: 'Logs' },
  { id: 'terminal', label: 'Terminal' },
];
const tab = ref<Tab>('container');
const containerId = computed(() => {
  const v = get('ContainerID');
  return typeof v === 'string' && v !== '' ? v : null;
});
const actionPath = (action: 'logs' | 'exec' | 'ws'): string | null => {
  const r = resource.value;
  const id = ui.detailId;
  return r && id != null ? `${r.endpoint}${id}/${action}/` : null;
};
watch(
  () => ui.detailId,
  () => (tab.value = 'container'),
); // another container: fresh start

const backTo = computed<Route | null>(() =>
  resource.value ? { view: 'list', table: resource.value.table } : null,
);
/** Link to the container's host detail page (the hosts list if the brief has no id). */
function hostTo(brief: unknown): Route {
  const table = 'plugin_docker_host';
  const id = (brief as { id?: unknown } | null)?.id;
  return typeof id === 'number' ? { view: 'detail', table, id } : { view: 'list', table };
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
      <RouteLink v-if="backTo" class="btn btn-ghost" :to="backTo" back>‹ Back</RouteLink>
      <h2>{{ title || 'Container' }}</h2>
      <span class="spacer" />
      <template v-if="resource.writable && container">
        <button
          v-for="b in OP_BTNS"
          :key="b.op"
          class="btn op-btn"
          :class="b.cls"
          :disabled="runningOp !== null"
          @click="runOp(b.op, b.danger)"
        >
          {{ runningOp === b.op ? `${b.label}…` : b.label }}
        </button>
      </template>
      <button v-if="resource.writable" class="btn btn-ghost" @click="editing = true">Edit</button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">Loading…</p>

    <template v-if="container && !loading">
      <nav class="tabs" role="tablist">
        <button
          v-for="t in TABS"
          :key="t.id"
          role="tab"
          class="tab"
          :class="{ active: tab === t.id }"
          :aria-selected="tab === t.id"
          @click="tab = t.id"
        >
          {{ t.label }}
        </button>
      </nav>

      <template v-if="tab === 'container'">
        <!-- core properties -->
        <section class="card props">
          <div class="prop">
            <span class="k">Host</span>
            <RouteLink v-if="host" class="link" :to="hostTo(host)">
              {{ scalarText(host) }}
            </RouteLink>
            <span v-else class="v">—</span>
          </div>
          <div class="prop">
            <span class="k">Image</span>
            <span v-if="image" class="v">{{ scalarText(image) }}</span>
            <span v-else class="v">—</span>
          </div>
          <div v-for="s in scalars" :key="s.label" class="prop">
            <span class="k">{{ s.label }}</span>
            <span class="v">
              <StatusPill v-if="s.pill" v-bind="s.pill" />
              <template v-else>{{ s.value }}</template>
            </span>
          </div>
        </section>

        <!-- attached collections (all editable in place when the container is writable) -->
        <template v-for="c in CONTAINER_COLLECTIONS" :key="c.field">
          <section v-if="writable" class="collection editor">
            <h4>
              {{ c.title }}
              <span class="n">{{ (drafts[c.field] ?? []).length }}</span>
              <span class="spacer" />
              <button class="btn btn-ghost sm" @click="addRow(c)">+ Add</button>
              <button
                class="btn btn-ok sm"
                :disabled="!dirty[c.field] || savingField === c.field"
                @click="saveCollection(c)"
              >
                {{ savingField === c.field ? 'Saving…' : 'Save' }}
              </button>
              <button
                class="btn btn-ghost sm"
                :disabled="!dirty[c.field] || savingField === c.field"
                @click="initDraft(c)"
              >
                Discard
              </button>
            </h4>
            <p v-if="!(drafts[c.field] ?? []).length" class="empty">{{ c.empty }}</p>
            <table v-else class="edit-table">
              <thead>
                <tr>
                  <th v-for="col in c.columns" :key="col.key" :class="{ req: col.required }">
                    {{ col.label }}
                  </th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in drafts[c.field]" :key="i">
                  <td v-for="col in c.columns" :key="col.key" :class="{ tight: col.bool }">
                    <select
                      v-if="col.fkTable"
                      v-model="row[col.key]"
                      @change="dirty[c.field] = true"
                    >
                      <option value="">—</option>
                      <option v-for="o in fkOptions[col.fkTable] ?? []" :key="o.id" :value="o.id">
                        {{ o.display }}
                      </option>
                    </select>
                    <select
                      v-else-if="col.choices"
                      v-model="row[col.key]"
                      @change="dirty[c.field] = true"
                    >
                      <option value="">—</option>
                      <option v-for="ch in col.choices" :key="ch" :value="ch">{{ ch }}</option>
                    </select>
                    <input
                      v-else-if="col.bool"
                      type="checkbox"
                      v-model="row[col.key]"
                      @change="dirty[c.field] = true"
                    />
                    <input
                      v-else
                      :type="col.num ? 'number' : 'text'"
                      v-model="row[col.key]"
                      :placeholder="col.label"
                      @input="dirty[c.field] = true"
                    />
                  </td>
                  <td>
                    <button class="btn btn-ghost sm danger" title="Remove" @click="removeRow(c, i)">
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

      <ContainerLogs v-if="tab === 'logs'" :path="actionPath('logs')" :container-id="containerId" />
      <ContainerTerminal
        v-show="tab === 'terminal'"
        :key="ui.detailId ?? 0"
        :ws-path="actionPath('ws')"
        :container-id="containerId"
        :active="tab === 'terminal'"
      />
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
  margin-bottom: 14px;
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
/* tabs */
.tabs {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 14px;
}
.tab {
  padding: 8px 14px;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  background: none;
  color: var(--muted);
  font: inherit;
  cursor: pointer;
}
.tab:hover {
  color: var(--text);
}
.tab.active {
  color: var(--primary-d);
  border-bottom-color: var(--primary);
  font-weight: 600;
}
/* inline collection editors (env, labels, mounts, networks, binds, ports, …) */
.editor {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 14px;
}
.editor h4 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 10px;
}
.editor .n {
  font-size: 0.8rem;
  color: var(--muted);
}
.editor .spacer {
  flex: 1;
}
.editor .empty {
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
.edit-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
.edit-table th,
.edit-table td {
  text-align: left;
  padding: 4px 8px 4px 0;
}
.edit-table th.req::after {
  content: ' *';
  color: var(--danger);
}
.edit-table input:not([type='checkbox']),
.edit-table select {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 7px;
  border: 1px solid var(--border);
  border-radius: 5px;
  font: inherit;
  background: #fff;
}
.edit-table td.tight,
.edit-table td:last-child {
  width: 1%;
  white-space: nowrap;
}
</style>
