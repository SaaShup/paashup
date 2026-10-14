<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useUiStore } from '../stores/ui.js';
import { useObjectsStore } from '../stores/objects.js';
import { api, type Obj } from '../api/client.js';
import { buildFilterOptions, type FilterOptions } from '../api/columnFilters.js';
import { applyRoute, type Route } from '../router.js';
import ObjectTable from '../components/ObjectTable.vue';
import ObjectForm from '../components/ObjectForm.vue';
import AddVmForm from '../components/AddVmForm.vue';
import { confirmDialog } from '../composables/confirm.js';
import IpRangeAddresses from '../components/IpRangeAddresses.vue';
import { DETAIL_TABLES } from './objectDetail.js';

const PAGE = 50;
// Log-like tables (journal entries, event/log feeds) read newest-first.
const NEWEST_FIRST = /journal|log/;
// Docker container lifecycle ops — PATCH each *selected* container's `operation`, which
// fires the agent webhook (the agent performs the real action). The toolbar buttons act
// on the rows checked in the table. Colour-coded by intent: start=green, restart=amber,
// recreate=blue, stop=red, kill=dark-red.
const CONTAINER_OP_BTNS = [
  { op: 'start', label: 'Start', cls: 'op-start' },
  { op: 'restart', label: 'Restart', cls: 'op-restart' },
  { op: 'recreate', label: 'Recreate', cls: 'op-recreate' },
  { op: 'stop', label: 'Stop', cls: 'op-stop' },
  { op: 'kill', label: 'Kill', cls: 'op-kill' },
] as const;
// Docker host op — PATCH each *selected* host's `operation` to "refresh"; the backend
// marks it state=refreshing and re-discovers its resources (see routes/hosts.ts).
const HOST_OP_BTNS = [{ op: 'refresh', label: 'Refresh', cls: 'op-refresh' }] as const;
// container ops that interrupt or destroy a running container
const DANGEROUS_OPS = new Set(['stop', 'kill', 'recreate', 'refresh']);
const ui = useUiStore();
const objects = useObjectsStore();

const offset = ref(0);
const search = ref('');
const error = ref('');
const formOpen = ref(false);
const editing = ref<Obj | null>(null);
const addrRange = ref<Obj | null>(null); // IP range whose addresses are being browsed
const selectedIds = ref<number[]>([]); // checked container rows — toolbar ops act on these

// Per-column header filters: { fieldName -> selected value } sent as `?<field>=<value>`,
// with the selectable values per column in `filterOptions` (FK rows / enum choices /
// distinct scalar values — see api/columnFilters).
const filters = computed({
  get: () => ui.filters,
  set: (v: Record<string, string>) => (ui.filters = v),
});
const filterOptions = ref<FilterOptions>({});

const resource = computed(() => ui.selected!);

/** Columns shown first for tables whose useful fields would otherwise be cut off. */
const PREFERRED_COLUMNS: Record<string, string[]> = {
  virtualization_virtual_machine: [
    'status',
    'cluster',
    'virtual_machine_type',
    'image',
    'primary_ip4',
    'vcpus',
    'memory',
  ],
  virtualization_ssh_key: ['name', 'public_key', 'owner', 'source', 'description'],
  virtualization_image: ['name', 'source', 'description'],
  virtualization_init_script: ['name', 'description', 'created'],
};
// Columns a list leaves out: an init script is listed by name, description and date only.
const HIDDEN_COLUMNS: Record<string, string[]> = {
  virtualization_init_script: ['id', 'content', 'variables', 'required_variables', 'last_updated'],
};
const slot = computed(() => (resource.value ? objects.byTable[resource.value.table] : undefined));
const isVm = computed(() => resource.value?.table === 'virtualization_virtual_machine');
// The OpenStack server behind each VM of the page (VM id → link): only a VM paasbox created
// ("managed") can be deleted, and deleting it deletes the server on OpenStack.
const OPENSTACK_SERVERS = '/api/plugins/openstack/servers/';
const vmServers = ref<Record<number, { managed: boolean; cloud: string }>>({});
async function loadVmServers() {
  vmServers.value = {};
  if (!isVm.value) return;
  try {
    const rows = (await api.list(OPENSTACK_SERVERS, { limit: 5000 })).results;
    vmServers.value = Object.fromEntries(
      rows.map((r) => [
        Number(r.virtual_machine_id),
        { managed: !!r.managed, cloud: String(r.cloud) },
      ]),
    );
  } catch {
    /* no OpenStack plugin: every VM is deleted as a plain record */
  }
}
const isContainer = computed(() => resource.value?.table === 'plugin_docker_container');
const isHost = computed(() => resource.value?.table === 'plugin_docker_host');
// Keycloak hierarchy: Server → Realms → Clients → Redirect URLs (same UX as Host → Containers)
const isKcServer = computed(() => resource.value?.table === 'plugin_keycloak_server');
const isKcRealm = computed(() => resource.value?.table === 'plugin_keycloak_realm');
const isKcClient = computed(() => resource.value?.table === 'plugin_keycloak_client');
// Tables that expose row selection + a bulk-operation toolbar (containers / hosts).
const opButtons = computed(() =>
  isContainer.value ? CONTAINER_OP_BTNS : isHost.value ? HOST_OP_BTNS : [],
);
const opNoun = computed(() => (isHost.value ? 'host' : 'container'));
const selectable = computed(() => isContainer.value || isHost.value);
const apiUrl = computed(() => (resource.value ? location.origin + resource.value.endpoint : ''));
const copied = ref(false);

async function copyApi() {
  try {
    await navigator.clipboard.writeText(apiUrl.value);
  } catch {
    const t = document.createElement('textarea');
    t.value = apiUrl.value;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
  copied.value = true;
  setTimeout(() => (copied.value = false), 1200);
}
const rangeFrom = computed(() => (slot.value?.count ? offset.value + 1 : 0));
const rangeTo = computed(() => Math.min(offset.value + PAGE, slot.value?.count ?? 0));

async function load() {
  if (!resource.value) return;
  error.value = '';
  selectedIds.value = []; // a new page / search / table invalidates the selection
  if (isVm.value) void loadVmServers();
  try {
    await objects.load(resource.value.table, resource.value.endpoint, {
      limit: PAGE,
      offset: offset.value,
      ...(NEWEST_FIRST.test(resource.value.table) ? { ordering: '-id' } : {}),
      ...(search.value ? { q: search.value } : {}),
      ...filters.value, // active per-column filters (empty selections are removed)
    });
  } catch (e) {
    error.value = String(e);
  }
}

/** Apply / clear one column's filter, then reload from the first page. */
function setFilter(payload: { field: string; value: string }) {
  const next = { ...filters.value };
  if (payload.value) next[payload.field] = payload.value;
  else delete next[payload.field];
  filters.value = next;
}

/** Clear every active column filter and reload. */
function clearFilters() {
  if (!Object.keys(filters.value).length) return;
  filters.value = {};
}

/** Build the per-column filter options for the current resource (best-effort). */
async function loadFilterOptions() {
  filterOptions.value = {};
  const r = resource.value;
  if (!r?.model) return;
  try {
    filterOptions.value = await buildFilterOptions(r.model, r.endpoint);
  } catch {
    /* filters are optional sugar; ignore failures */
  }
}

watch(
  () => resource.value?.table,
  () => {
    search.value = '';
    loadFilterOptions();
  },
  { immediate: true },
);
// a table or filter change (UI, link or browser history) restarts from the first page
watch(
  () => `${resource.value?.table}?${JSON.stringify(ui.filters)}`,
  () => {
    offset.value = 0;
    load();
  },
  { immediate: true },
);

function go(delta: number) {
  offset.value = Math.max(0, offset.value + delta * PAGE);
  load();
}
async function del(id: number) {
  if (!resource.value) return;
  const server = isVm.value ? vmServers.value[id] : undefined;
  if (server) {
    const row = slot.value?.items.find((r) => idOf(r) === id);
    const name = String(row?.name ?? `#${id}`);
    if (!server.managed) {
      error.value = `"${name}" is a server of the OpenStack cloud "${server.cloud}" that paasbox did not create: delete it in OpenStack.`;
      return;
    }
    const ok = await confirmDialog({
      title: 'Delete on OpenStack',
      message: `Delete "${name}" on OpenStack (cloud "${server.cloud}")?\n\nThe server and its disk are destroyed, a Docker host registered on this VM is deleted too, and this cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    error.value = '';
    try {
      await api.remove(OPENSTACK_SERVERS, id);
      reloadSoon();
    } catch (e) {
      error.value = errorText(e);
    }
    return;
  }
  await objects.remove(resource.value.table, id);
}
/** The deletion / creation finishes in the background: refresh the list while it does. */
/** A VM was created on a cloud: open its page, which follows it until it is built. */
function onVmCreated(vmId?: number | null) {
  formOpen.value = false;
  if (vmId != null && resource.value) {
    applyRoute(ui, { view: 'detail', table: resource.value.table, id: vmId });
  } else {
    reloadSoon();
  }
}
function reloadSoon() {
  for (const ms of [1500, 6000, 15000, 40000]) {
    setTimeout(() => {
      if (isVm.value) {
        load();
        loadVmServers();
      }
    }, ms);
  }
}
function errorText(e: unknown): string {
  const d = (e as { detail?: { detail?: unknown } }).detail;
  return typeof d?.detail === 'string' ? d.detail : String(e);
}
/** Toggle one container row's selection. */
function toggleSel(payload: { id: number; checked: boolean }) {
  const set = new Set(selectedIds.value);
  if (payload.checked) set.add(payload.id);
  else set.delete(payload.id);
  selectedIds.value = [...set];
}
/** Select / clear all currently-listed container rows. */
function toggleAllSel(checked: boolean) {
  selectedIds.value =
    checked && slot.value ? slot.value.items.map((r) => (r as { id: number }).id) : [];
}
/** Apply an operation to the selected rows (one confirm, one PATCH each). */
async function bulkOp(op: string) {
  if (!resource.value || !selectedIds.value.length) return;
  const ids = [...selectedIds.value];
  const noun = `${opNoun.value}${ids.length === 1 ? '' : 's'}`;
  const msg =
    op === 'refresh'
      ? `Refresh ${ids.length} selected ${noun}? This clears their discovered resources.`
      : `Run "${op}" on ${ids.length} selected ${noun}?`;
  const ok = await confirmDialog({
    title: op === 'refresh' ? 'Refresh' : `Run "${op}"`,
    message: msg,
    confirmLabel: op === 'refresh' ? 'Refresh' : 'Run',
    tone: DANGEROUS_OPS.has(op) ? 'danger' : 'primary',
  });
  if (!ok) return;
  error.value = '';
  try {
    for (const id of ids) await objects.update(resource.value.table, id, { operation: op });
  } catch (e) {
    error.value = String(e);
  }
}
function add() {
  editing.value = null;
  formOpen.value = true;
}
function edit(row: Obj) {
  editing.value = row;
  formOpen.value = true;
}
const idOf = (row: Obj): number => (row as { id: number }).id;
/** Name link: containers and hosts open their read-only detail view. */
function openTo(row: Obj): Route | null {
  return resource.value &&
    (isContainer.value || isHost.value || DETAIL_TABLES.has(resource.value.table))
    ? { view: 'detail', table: resource.value.table, id: idOf(row) }
    : null;
}
/** Per-row extra link: a container's detail, or the child list pre-filtered to this row. */
function actionTo(row: Obj): Route | null {
  const id = String(idOf(row));
  if (isContainer.value) return { view: 'detail', table: resource.value!.table, id: idOf(row) };
  if (isHost.value)
    return { view: 'list', table: 'plugin_docker_container', filters: { host: id } };
  if (isKcServer.value)
    return { view: 'list', table: 'plugin_keycloak_realm', filters: { server: id } };
  if (isKcRealm.value)
    return { view: 'list', table: 'plugin_keycloak_client', filters: { realm: id } };
  if (isKcClient.value)
    return { view: 'list', table: 'plugin_keycloak_redirect_url', filters: { client: id } };
  return null;
}
/** Per-row extra button for the rows with no link: IP ranges open their addresses. */
function onAction(row: Obj) {
  addrRange.value = row;
}
</script>

<template>
  <div v-if="resource" class="list">
    <div class="crumb muted">{{ resource.section.toUpperCase() }} › {{ resource.label }}</div>
    <div class="head">
      <h2>{{ resource.label }}</h2>
      <span v-if="slot" class="total muted">{{ slot.count }} records</span>
      <button
        v-if="Object.keys(filters).length"
        class="btn btn-ghost clear-filters"
        title="Clear all column filters"
        @click="clearFilters"
      >
        ✕ Clear filters ({{ Object.keys(filters).length }})
      </button>
      <span class="spacer" />
      <button v-if="resource.writable" class="btn btn-ok" @click="add">+ Add</button>
    </div>

    <div class="toolbar card">
      <input
        class="search"
        type="search"
        v-model="search"
        placeholder="Search…"
        @keyup.enter="((offset = 0), load())"
      />
      <button class="btn btn-ghost" @click="((offset = 0), load())">Search</button>
      <span v-if="slot?.loading" class="muted">loading…</span>
      <template v-if="opButtons.length">
        <span class="sel-count muted">{{ selectedIds.length }} selected</span>
        <button
          v-for="b in opButtons"
          :key="b.op"
          class="btn op-btn"
          :class="b.cls"
          :disabled="!selectedIds.length"
          :title="
            selectedIds.length
              ? `Run ${b.label} on ${selectedIds.length} selected ${opNoun}(s)`
              : `Select one or more ${opNoun}s first`
          "
          @click="bulkOp(b.op)"
        >
          {{ b.label }}
        </button>
      </template>
      <span class="spacer" />
      <a
        class="api-pill"
        :href="apiUrl"
        target="_blank"
        rel="noopener"
        title="Open this endpoint's JSON"
      >
        {&nbsp;} API ↗
      </a>
      <button class="btn btn-ghost copy" :title="apiUrl" @click="copyApi">
        {{ copied ? '✓ Copied' : 'Copy URL' }}
      </button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <div class="card table-wrap">
      <ObjectTable
        v-if="slot"
        :items="slot.items"
        :table="resource.table"
        :preferred="PREFERRED_COLUMNS[resource.table]"
        :hidden="HIDDEN_COLUMNS[resource.table]"
        :editable="resource.writable"
        :extra-action="
          isContainer
            ? 'View'
            : isHost
              ? 'Containers'
              : isKcServer
                ? 'Realms'
                : isKcRealm
                  ? 'Clients'
                  : isKcClient
                    ? 'Redirect URLs'
                    : resource.table === 'ipam_iprange'
                      ? 'IPs'
                      : undefined
        "
        :selectable="selectable"
        :selected="selectedIds"
        :filters="filters"
        :filter-options="filterOptions"
        :link-to="openTo"
        :action-to="actionTo"
        @delete="del"
        @edit="edit"
        @action="onAction"
        @toggle="toggleSel"
        @toggle-all="toggleAllSel"
        @filter="setFilter"
      />
    </div>

    <div v-if="slot" class="pager">
      <button class="btn btn-ghost" :disabled="offset === 0" @click="go(-1)">‹ Prev</button>
      <span class="muted">{{ rangeFrom }}–{{ rangeTo }} of {{ slot.count }}</span>
      <button class="btn btn-ghost" :disabled="rangeTo >= slot.count" @click="go(1)">Next ›</button>
    </div>

    <AddVmForm
      v-if="formOpen && resource.model && isVm && !editing"
      :model="resource.model"
      :endpoint="resource.endpoint"
      @saved="onVmCreated"
      @cancel="formOpen = false"
    />
    <ObjectForm
      v-else-if="formOpen && resource.model"
      :model="resource.model"
      :endpoint="resource.endpoint"
      :object="editing"
      @saved="formOpen = false"
      @cancel="formOpen = false"
    />

    <IpRangeAddresses v-if="addrRange" :range="addrRange" @close="addrRange = null" />
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
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  margin-bottom: 14px;
}
.search {
  flex: 1;
  max-width: 360px;
}
.sel-count {
  font-size: 0.82rem;
  white-space: nowrap;
}
.clear-filters {
  font-size: 0.78rem;
  padding: 4px 10px;
}
/* Docker container operation buttons — colour-coded by intent. */
.op-btn {
  padding: 6px 11px;
  font-size: 0.85rem;
  color: #fff;
}
.op-start {
  background: var(--ok);
  border-color: var(--ok);
}
.op-start:hover {
  background: #15803d;
  border-color: #15803d;
}
.op-restart {
  background: var(--warn);
  border-color: var(--warn);
}
.op-restart:hover {
  background: #b45309;
  border-color: #b45309;
}
.op-recreate {
  background: var(--primary);
  border-color: var(--primary);
}
.op-recreate:hover {
  background: var(--primary-d);
  border-color: var(--primary-d);
}
.op-stop {
  background: var(--danger);
  border-color: var(--danger);
}
.op-stop:hover {
  background: #b91c1c;
  border-color: #b91c1c;
}
.op-kill {
  background: #991b1b;
  border-color: #991b1b;
}
.op-kill:hover {
  background: #7f1d1d;
  border-color: #7f1d1d;
}
.op-refresh {
  background: #0891b2;
  border-color: #0891b2;
}
.op-refresh:hover {
  background: #0e7490;
  border-color: #0e7490;
}
.api-pill {
  font-family: ui-monospace, monospace;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--primary-d);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  white-space: nowrap;
}
.api-pill:hover {
  background: var(--surface-2);
  border-color: var(--secondary);
}
.copy {
  white-space: nowrap;
}
.table-wrap {
  overflow-x: auto;
}
.pager {
  display: flex;
  align-items: center;
  gap: 14px;
  justify-content: flex-end;
  margin-top: 12px;
}
.error {
  color: var(--danger);
}
</style>
