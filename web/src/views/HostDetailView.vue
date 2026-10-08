<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useUiStore } from '../stores/ui.js';
import { useConnectionStore } from '../stores/connection.js';
import type { Route } from '../router.js';
import RouteLink from '../components/RouteLink.vue';
import type { Resource } from '../api/resources.js';
import { api, type Obj } from '../api/client.js';
import { scalarText } from './containerDetail.js';
import ObjectTable from '../components/ObjectTable.vue';
import ObjectForm from '../components/ObjectForm.vue';
import { briefTarget } from './objectDetail.js';

// The host's sub-resources, shown one categorised section each. Containers come first
// (the primary thing operators look at), then images/volumes/networks; registries lead.
const CATEGORIES = [
  { table: 'plugin_docker_registry', title: 'Registries', empty: 'No registries' },
  { table: 'plugin_docker_container', title: 'Containers', empty: 'No containers' },
  { table: 'plugin_docker_image', title: 'Images', empty: 'No images' },
  { table: 'plugin_docker_volume', title: 'Volumes', empty: 'No volumes' },
  { table: 'plugin_docker_network', title: 'Networks', empty: 'No networks' },
] as const;
const CONTAINER_TABLE = 'plugin_docker_container';

// Container lifecycle ops — PATCH each selected container's `operation` (the agent acts).
const CONTAINER_OP_BTNS = [
  { op: 'start', label: 'Start', cls: 'op-start' },
  { op: 'restart', label: 'Restart', cls: 'op-restart' },
  { op: 'recreate', label: 'Recreate', cls: 'op-recreate' },
  { op: 'stop', label: 'Stop', cls: 'op-stop' },
  { op: 'kill', label: 'Kill', cls: 'op-kill' },
] as const;

const ui = useUiStore();
const connection = useConnectionStore();
const resource = computed(() => ui.selected); // the host resource

const host = ref<Obj | null>(null);
const items = ref<Record<string, Obj[]>>({});
const selected = ref<number[]>([]); // checked container rows
const loading = ref(false);
const error = ref('');

// edit/create modal
const form = ref<{ resource: Resource; object: Obj | null; defaults: Obj | null } | null>(null);

const get = (k: string): unknown => (host.value as Record<string, unknown> | null)?.[k];
const title = computed(() => scalarText(get('display') ?? get('name')));
const HEADER_FIELDS = [
  ['endpoint', 'Endpoint'],
  ['state', 'State'],
  ['operation', 'Operation'],
  ['agent_version', 'Agent version'],
  ['docker_api_version', 'Docker API'],
  ['netbox_base_url', 'NetBox base URL'],
] as const;
const scalars = computed(() =>
  HEADER_FIELDS.map(([k, label]) => ({ label, value: scalarText(get(k)) })),
);
/** The machine the engine runs on, linked to its detail page when it has one. */
const machine = computed(() => {
  const v = get('virtual_machine') ?? get('device');
  if (!v) return null;
  const t = briefTarget(v, ui.resources);
  return {
    label: get('virtual_machine') ? 'Virtual machine' : 'Device',
    text: scalarText(v),
    to: t ? ({ view: 'detail', table: t.table, id: t.id } as Route) : null,
  };
});

/** Resolve each category to its catalogued Resource (endpoint/model/writable). */
const cats = computed(() =>
  CATEGORIES.map((c) => ({ ...c, resource: ui.resources.find((r) => r.table === c.table) })).filter(
    (c): c is typeof c & { resource: Resource } => !!c.resource,
  ),
);
const containerResource = computed(() => ui.resources.find((r) => r.table === CONTAINER_TABLE));

async function loadCategory(r: Resource): Promise<void> {
  const hostId = ui.detailId;
  if (hostId == null) return;
  const page = await api.list(r.endpoint, { host: String(hostId), limit: 200 });
  items.value = { ...items.value, [r.table]: page.results };
}

async function load(): Promise<void> {
  const r = resource.value;
  const id = ui.detailId;
  if (!r || id == null) return;
  loading.value = true;
  error.value = '';
  selected.value = [];
  try {
    host.value = await api.retrieve<Obj>(r.endpoint, id);
    await Promise.all(cats.value.map((c) => loadCategory(c.resource)));
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const idOfRow = (o: Obj): unknown => (o as { id?: unknown }).id;
const hostIdOf = (data: Record<string, unknown>): unknown => {
  const h = data.host;
  return h && typeof h === 'object' ? (h as { id?: unknown }).id : h;
};
watch(
  () => connection.log[0],
  (e) => {
    if (!e) return;
    if (e.table === resource.value?.table) {
      if (e.event === 'updated' && e.id === ui.detailId && e.data && host.value)
        host.value = { ...host.value, ...e.data } as Obj;
      return;
    }
    const list = items.value[e.table];
    if (!list) return;
    const idx = list.findIndex((o) => idOfRow(o) === e.id);
    let next = list;
    if (e.event === 'deleted') {
      if (idx >= 0) next = list.filter((_, i) => i !== idx);
    } else if (e.data && hostIdOf(e.data) === ui.detailId) {
      next =
        idx >= 0 ? list.map((o, i) => (i === idx ? (e.data as Obj) : o)) : [e.data as Obj, ...list];
    }
    if (next !== list) items.value = { ...items.value, [e.table]: next };
  },
);
watch(() => ui.detailId, load); // re-fetch if another host is opened

const backTo = computed<Route | null>(() =>
  resource.value ? { view: 'list', table: resource.value.table } : null,
);

function add(r: Resource) {
  form.value = { resource: r, object: null, defaults: { host: ui.detailId } };
}
function edit(r: Resource, row: Obj) {
  form.value = { resource: r, object: row, defaults: null };
}
async function del(r: Resource, id: number) {
  if (!window.confirm('Delete this item?')) return;
  try {
    await api.remove(r.endpoint, id);
    await loadCategory(r);
  } catch (e) {
    error.value = String(e);
  }
}
async function onSaved() {
  const r = form.value?.resource;
  form.value = null;
  if (r) await loadCategory(r);
}

/** Name link in the Containers section → the read-only container detail. */
function containerTo(row: Obj): Route | null {
  return containerResource.value
    ? { view: 'detail', table: containerResource.value.table, id: (row as { id: number }).id }
    : null;
}

// ---- container selection + bulk ops ----
function toggleSel(p: { id: number; checked: boolean }) {
  const set = new Set(selected.value);
  if (p.checked) set.add(p.id);
  else set.delete(p.id);
  selected.value = [...set];
}
function toggleAllSel(checked: boolean) {
  selected.value = checked
    ? (items.value[CONTAINER_TABLE] ?? []).map((r) => (r as Obj & { id: number }).id)
    : [];
}
async function bulkOp(op: string) {
  const r = containerResource.value;
  if (!r || !selected.value.length) return;
  const ids = [...selected.value];
  if (
    !window.confirm(
      `Run "${op}" on ${ids.length} selected container${ids.length === 1 ? '' : 's'}?`,
    )
  )
    return;
  error.value = '';
  try {
    for (const id of ids) await api.update(r.endpoint, id, { operation: op });
    await loadCategory(r);
  } catch (e) {
    error.value = String(e);
  }
}
</script>

<template>
  <div v-if="resource" class="detail">
    <div class="crumb muted">
      {{ resource.section.toUpperCase() }} › {{ resource.label }} › detail
    </div>
    <div class="head">
      <RouteLink v-if="backTo" class="btn btn-ghost" :to="backTo" back>‹ Back</RouteLink>
      <h2>{{ title || 'Host' }}</h2>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">Loading…</p>

    <template v-if="host && !loading">
      <!-- host properties -->
      <section class="card props">
        <div v-for="s in scalars" :key="s.label" class="prop">
          <span class="k">{{ s.label }}</span>
          <span class="v">{{ s.value }}</span>
        </div>
        <div v-if="machine" class="prop">
          <span class="k">{{ machine.label }}</span>
          <span class="v">
            <RouteLink v-if="machine.to" class="vmlink" :to="machine.to">{{ machine.text }}</RouteLink>
            <template v-else>{{ machine.text }}</template>
          </span>
        </div>
      </section>

      <!-- one section per attached category -->
      <section v-for="c in cats" :key="c.table" class="cat card">
        <div class="cat-head">
          <h3>
            {{ c.title }}
            <span class="n">{{ (items[c.table] ?? []).length }}</span>
          </h3>
          <!-- container lifecycle actions act on the checked rows -->
          <template v-if="c.table === CONTAINER_TABLE">
            <span class="sel-count muted">{{ selected.length }} selected</span>
            <button
              v-for="b in CONTAINER_OP_BTNS"
              :key="b.op"
              class="btn op-btn"
              :class="b.cls"
              :disabled="!selected.length"
              @click="bulkOp(b.op)"
            >
              {{ b.label }}
            </button>
          </template>
          <span class="spacer" />
          <button
            v-if="c.resource.writable"
            class="btn btn-ok add"
            :title="`Add ${c.title.replace(/s$/, '')}`"
            @click="add(c.resource)"
          >
            +
          </button>
        </div>
        <p v-if="!(items[c.table] ?? []).length" class="muted empty">{{ c.empty }}</p>
        <div v-else class="table-wrap">
          <ObjectTable
            :items="items[c.table] ?? []"
            :editable="c.resource.writable"
            :link-to="c.table === CONTAINER_TABLE ? containerTo : undefined"
            :selectable="c.table === CONTAINER_TABLE"
            :selected="selected"
            @edit="(row) => edit(c.resource, row)"
            @delete="(id) => del(c.resource, id)"
            @toggle="toggleSel"
            @toggle-all="toggleAllSel"
          />
        </div>
      </section>
    </template>

    <ObjectForm
      v-if="form && form.resource.model"
      :model="form.resource.model"
      :endpoint="form.resource.endpoint"
      :object="form.object"
      :defaults="form.defaults"
      @saved="onSaved"
      @cancel="form = null"
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
  gap: 12px;
  margin-bottom: 14px;
}
.head h2 {
  margin: 0;
  font-size: 1.4rem;
}
.error {
  color: var(--danger);
}
.vmlink {
  color: var(--primary);
  font-weight: 600;
  text-decoration: underline;
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
.cat {
  padding: 14px 16px;
  margin-bottom: 14px;
}
.cat-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.cat-head h3 {
  margin: 0;
  font-size: 1.05rem;
}
.cat-head .n {
  display: inline-block;
  margin-left: 6px;
  font-size: 0.8rem;
  color: var(--muted);
}
.spacer {
  flex: 1;
}
.add {
  font-weight: 700;
  padding: 4px 12px;
}
.sel-count {
  font-size: 0.8rem;
  white-space: nowrap;
}
.empty {
  margin: 4px 0 0;
}
.table-wrap {
  overflow-x: auto;
}
/* container op buttons — colour-coded by intent */
.op-btn {
  padding: 5px 10px;
  font-size: 0.82rem;
  color: #fff;
}
.op-start {
  background: var(--ok);
  border-color: var(--ok);
}
.op-restart {
  background: var(--warn);
  border-color: var(--warn);
}
.op-recreate {
  background: var(--primary);
  border-color: var(--primary);
}
.op-stop {
  background: var(--danger);
  border-color: var(--danger);
}
.op-kill {
  background: #991b1b;
  border-color: #991b1b;
}
</style>
