<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useUiStore } from '../stores/ui.js';
import { applyRoute, type Route } from '../router.js';
import RouteLink from '../components/RouteLink.vue';
import ObjectTable from '../components/ObjectTable.vue';
import ObjectForm from '../components/ObjectForm.vue';
import { api, type Obj } from '../api/client.js';
import { confirmDialog } from '../composables/confirm.js';
import { scalarText } from './containerDetail.js';
import { fieldLabel, formatUnit, pillFor } from '../format.js';
import StatusPill from '../components/StatusPill.vue';
import KeyValueEditor from '../components/KeyValueEditor.vue';
import { fromPairs, toPairs, type Pair } from '../keyValue.js';
import { useConnectionStore } from '../stores/connection.js';
import { isValidDefault, setDefault } from '../initScript.js';
import { briefTarget, DETAIL, LINKABLE_TABLES, type RelatedSection } from './objectDetail.js';

const ui = useUiStore();
const connection = useConnectionStore();
const resource = computed(() => ui.selected);
const config = computed(() => (resource.value ? DETAIL[resource.value.table] : undefined));

const obj = ref<Obj | null>(null);
const lists = ref<Record<string, Obj[]>>({});
const regionStatus = ref<Obj[]>([]);
const loading = ref(false);
const error = ref('');
const editing = ref(false);
const refreshing = ref(false);
// A VM that is a server of an OpenStack cloud: "managed" ones (created by paasbox) can be
// deleted here, which deletes the server on OpenStack.
const OPENSTACK_SERVERS = '/api/plugins/openstack/servers/';
const vmServer = ref<{ managed: boolean; cloud: string } | null>(null);
const notice = ref('');
// The metadata of that server (key → value), read from OpenStack and editable in place.
const metaRows = ref<Pair[]>([]);
const metaSaved = ref<Pair[]>([]);
const metaFixed = ref<Pair[]>([]); // set by paasbox (managed-by): shown, never edited
const metaError = ref('');
const savingMeta = ref(false);
const metaDirty = computed(
  () => JSON.stringify(metaRows.value) !== JSON.stringify(metaSaved.value),
);
const deleting = ref(false);

const HIDE = new Set(['id', 'url', 'display_url', 'display', 'custom_fields', 'tags']);
const get = (k: string): unknown => (obj.value as Record<string, unknown> | null)?.[k];
const title = computed(() => scalarText(get('display') ?? get('name')));

const fields = computed(() => {
  if (!obj.value) return [];
  const hidden = new Set([...HIDE, ...(config.value?.hide ?? [])]);
  return Object.entries(obj.value)
    .filter(([k, v]) => !hidden.has(k) && v !== '' && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => ({
      key: k,
      label: fieldLabel(resource.value?.table, k),
      text: formatUnit(resource.value?.table, k, v) ?? scalarText(v),
      pill: pillFor(resource.value?.table, k, v),
      to: routeOfBrief(v),
    }));
});

function routeOfBrief(v: unknown): Route | null {
  const t = briefTarget(v, ui.resources);
  return t ? { view: 'detail', table: t.table, id: t.id } : null;
}

const sections = computed(() =>
  (config.value?.sections ?? [])
    .map((s) => ({ ...s, resource: ui.resources.find((r) => r.table === s.table) }))
    .filter(
      (s): s is RelatedSection & { resource: NonNullable<typeof s.resource> } => !!s.resource,
    ),
);

/** Name link of a row → its own detail page, when that table has one. */
function linkTo(table: string) {
  return (row: Obj): Route | null =>
    LINKABLE_TABLES.has(table) ? { view: 'detail', table, id: (row as { id: number }).id } : null;
}

/** Load the object and its related lists. `quiet` refreshes them in place (live updates). */
async function load(quiet = false): Promise<void> {
  const r = resource.value;
  const id = ui.detailId;
  if (!r || id == null) return;
  if (!quiet) loading.value = true;
  error.value = '';
  try {
    obj.value = await api.retrieve<Obj>(r.endpoint, id);
    await loadVmServer(r.table, id);
    if (!quiet) {
      lists.value = {};
      regionStatus.value = [];
      metaRows.value = metaSaved.value = metaFixed.value = [];
      metaError.value = '';
    }
    await Promise.all([
      ...sections.value.map(async (s) => {
        try {
          // await first: spreading `lists.value` before the await would overwrite the
          // sections that finished meanwhile
          const rows = await s.load(s.resource.endpoint, id, obj.value!);
          lists.value = { ...lists.value, [s.title]: rows };
        } catch (e) {
          error.value = `${s.title}: ${String(e)}`;
        }
      }),
      config.value?.regionStatus ? loadRegionStatus(r.endpoint, id) : Promise.resolve(),
    ]);
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

async function loadVmServer(table: string, id: number): Promise<void> {
  vmServer.value = null;
  if (table !== 'virtualization_virtual_machine') return;
  try {
    const row = (await api.list(OPENSTACK_SERVERS, { virtual_machine_id: id })).results[0];
    if (row) {
      vmServer.value = { managed: !!row.managed, cloud: String(row.cloud) };
      void loadMetadata(id); // a live call to the cloud: the page does not wait for it
    }
  } catch {
    /* no OpenStack plugin: a plain VM */
  }
}

interface MetadataReply {
  metadata: Record<string, string>;
  reserved: string[];
}
function applyMetadata(r: MetadataReply): void {
  const rest = Object.fromEntries(
    Object.entries(r.metadata).filter(([k]) => !r.reserved.includes(k)),
  );
  metaFixed.value = r.reserved
    .filter((k) => k in r.metadata)
    .map((key) => ({ key, value: r.metadata[key]! }));
  metaSaved.value = toPairs(rest);
  metaRows.value = toPairs(rest);
}
async function loadMetadata(id: number): Promise<void> {
  try {
    const r = await api.get<MetadataReply>(`${OPENSTACK_SERVERS}${id}/metadata/`);
    if (ui.detailId !== id) return; // the page moved on meanwhile
    if (!metaDirty.value) applyMetadata(r); // a live update never overwrites what is being typed
  } catch (e) {
    metaError.value = `Metadata unavailable: ${errorText(e)}`;
  }
}
function discardMetadata(): void {
  metaRows.value = metaSaved.value.map((p) => ({ ...p }));
  metaError.value = '';
}
async function saveMetadata(): Promise<void> {
  const id = ui.detailId;
  if (id == null) return;
  const meta = fromPairs(metaRows.value);
  if (meta.error) {
    metaError.value = meta.error;
    return;
  }
  savingMeta.value = true;
  metaError.value = '';
  try {
    applyMetadata(
      await api.put<MetadataReply>(`${OPENSTACK_SERVERS}${id}/metadata/`, { metadata: meta.value }),
    );
  } catch (e) {
    metaError.value = errorText(e);
  } finally {
    savingMeta.value = false;
  }
}
/** The message an API error carries (a field error or `detail`), else its text. */
function errorText(e: unknown): string {
  const d = (e as { detail?: Record<string, unknown> }).detail;
  if (d && typeof d === 'object') {
    if (typeof d.detail === 'string') return d.detail;
    for (const v of Object.values(d))
      if (Array.isArray(v) && v.length) return v.map(String).join(' ');
  }
  return String(e);
}

/** Delete the VM's server on OpenStack, then follow the VM until it is gone. */
async function deleteOnOpenStack(): Promise<void> {
  const r = resource.value;
  const id = ui.detailId;
  if (!r || id == null || !vmServer.value) return;
  const ok = await confirmDialog({
    title: 'Delete on OpenStack',
    message: `Delete "${title.value}" on OpenStack (cloud "${vmServer.value.cloud}")?\n\nThe server and its disk are destroyed, a Docker host registered on this VM is deleted too, and this cannot be undone.`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  deleting.value = true;
  error.value = '';
  try {
    await api.remove(OPENSTACK_SERVERS, id);
    notice.value = 'Deletion requested on OpenStack. This page closes when the server is gone.';
    const tick = async (): Promise<void> => {
      try {
        obj.value = await api.retrieve<Obj>(r.endpoint, id);
      } catch {
        applyRoute(ui, { view: 'list', table: r.table }); // the VM is gone
        return;
      }
      poll = setTimeout(tick, 4000);
    };
    poll = setTimeout(tick, 2000);
  } catch (e) {
    deleting.value = false;
    const d = (e as { detail?: { detail?: unknown } }).detail;
    error.value = typeof d?.detail === 'string' ? d.detail : String(e);
  }
}

async function loadRegionStatus(endpoint: string, id: number): Promise<void> {
  regionStatus.value = (
    await api.get<{ results: Obj[] }>(`${endpoint}${id}/region-status/`)
  ).results;
}

let poll: ReturnType<typeof setTimeout> | undefined;
/** Ask for a new synchronisation, then follow the cloud until it is done. */
async function refresh(): Promise<void> {
  const r = resource.value;
  const id = ui.detailId;
  if (!r || id == null) return;
  refreshing.value = true;
  error.value = '';
  try {
    await api.update(r.endpoint, id, { operation: 'refresh' });
    const tick = async (): Promise<void> => {
      const o = await api.retrieve<Obj>(r.endpoint, id);
      const state = (o.state as { value?: string } | undefined)?.value;
      if (state === 'refreshing' || state === 'created') {
        poll = setTimeout(tick, 2000);
        return;
      }
      refreshing.value = false;
      await load();
    };
    poll = setTimeout(tick, 1500);
  } catch (e) {
    refreshing.value = false;
    error.value = String(e);
  }
}

onMounted(() => load());
onBeforeUnmount(() => {
  clearTimeout(poll);
  clearTimeout(liveTimer);
});
watch(
  () => [ui.detailId, ui.selected?.table],
  () => load(),
);

// Follow the object live: when the change feed reports this object (a VM going from
// "planned" to "active", its address, a journal entry…), reload it in place. If it was
// deleted, go back to the list.
let liveTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => connection.log[0],
  (e) => {
    const r = resource.value;
    const id = ui.detailId;
    if (!e || !r || id == null || e.table !== r.table || String(e.id) !== String(id)) return;
    if (e.event === 'deleted') {
      applyRoute(ui, { view: 'list', table: r.table });
      return;
    }
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => void load(true), 250);
  },
);

const backTo = computed<Route | null>(() =>
  resource.value ? { view: 'list', table: resource.value.table } : null,
);
const clusterTo = (row: Obj): Route | null =>
  ui.resources.some((r) => r.table === 'virtualization_cluster') && row.cluster_id
    ? { view: 'detail', table: 'virtualization_cluster', id: Number(row.cluster_id) }
    : null;
// an init script: its text, and the variables found in it
interface ScriptVar {
  name: string;
  default: string;
  featured: boolean;
  secret: boolean;
}
const scriptText = computed(() => String(get('content') ?? ''));
const scriptVars = computed<ScriptVar[]>(() => {
  const vars = get('variables');
  const feat = get('featured_variables');
  const featured = Array.isArray(feat) ? feat : [];
  const sec = get('secret_variables');
  const secret = Array.isArray(sec) ? sec : [];
  return Array.isArray(vars)
    ? (vars as { name: string; default: string }[]).map((v) => ({
        ...v,
        featured: featured.includes(v.name),
        secret: secret.includes(v.name),
      }))
    : [];
});
// Editing the variables in place: a default is rewritten in the script's text, "shown first" is
// the list kept next to it. Both are saved together.
const draft = ref<Record<string, { default: string; featured: boolean; secret: boolean }>>({});
const savingVars = ref(false);
watch(
  scriptVars,
  (vars) => {
    draft.value = Object.fromEntries(
      vars.map((v) => [v.name, { default: v.default, featured: v.featured, secret: v.secret }]),
    );
  },
  { immediate: true },
);
const badDefault = computed(() =>
  scriptVars.value.find((v) => !isValidDefault(draft.value[v.name]?.default ?? v.default)),
);
const varsDirty = computed(() =>
  scriptVars.value.some((v) => {
    const d = draft.value[v.name];
    return !!d && (d.default !== v.default || d.featured !== v.featured || d.secret !== v.secret);
  }),
);
function resetVars(): void {
  draft.value = Object.fromEntries(
    scriptVars.value.map((v) => [
      v.name,
      { default: v.default, featured: v.featured, secret: v.secret },
    ]),
  );
}
async function saveVars(): Promise<void> {
  const r = resource.value;
  const id = ui.detailId;
  if (!r || id == null || badDefault.value) return;
  let content = scriptText.value;
  for (const v of scriptVars.value) {
    const d = draft.value[v.name];
    if (d && d.default !== v.default) content = setDefault(content, v.name, d.default);
  }
  savingVars.value = true;
  error.value = '';
  try {
    await api.update(r.endpoint, id, {
      content,
      featured_variables: scriptVars.value
        .filter((v) => draft.value[v.name]?.featured)
        .map((v) => v.name),
      secret_variables: scriptVars.value
        .filter((v) => draft.value[v.name]?.secret)
        .map((v) => v.name),
    });
    await load(true);
  } catch (e) {
    const d = (e as { detail?: { content?: unknown } }).detail;
    error.value = Array.isArray(d?.content) ? d.content.join(' ') : String(e);
  } finally {
    savingVars.value = false;
  }
}
// Editing the script's text in the terminal itself.
const termEditing = ref(false);
const termDraft = ref('');
const savingText = ref(false);
function editText(): void {
  termDraft.value = scriptText.value;
  termEditing.value = true;
}
async function saveText(): Promise<void> {
  const r = resource.value;
  const id = ui.detailId;
  if (!r || id == null) return;
  savingText.value = true;
  error.value = '';
  try {
    await api.update(r.endpoint, id, {
      content: termDraft.value,
      // the variables the new text still declares keep their "shown first" and "secret" marks
      featured_variables: scriptVars.value.filter((v) => v.featured).map((v) => v.name),
      secret_variables: scriptVars.value.filter((v) => v.secret).map((v) => v.name),
    });
    termEditing.value = false;
    await load(true);
  } catch (e) {
    const d = (e as { detail?: { content?: unknown } }).detail;
    error.value = Array.isArray(d?.content) ? d.content.join(' ') : String(e);
  } finally {
    savingText.value = false;
  }
}
const when = (v: unknown): string => (v ? new Date(String(v)).toLocaleString() : '—');
</script>

<template>
  <div v-if="resource" class="detail">
    <div class="crumb muted">
      {{ resource.section.toUpperCase() }} › {{ resource.label }} › detail
    </div>
    <div class="head">
      <RouteLink v-if="backTo" class="btn btn-ghost" :to="backTo" back>‹ Back</RouteLink>
      <h2>{{ title || resource.label }}</h2>
      <span class="spacer" />
      <button v-if="config?.refresh" class="btn btn-ok" :disabled="refreshing" @click="refresh">
        {{ refreshing ? 'Refreshing…' : 'Refresh' }}
      </button>
      <button v-if="resource.writable && resource.model" class="btn" @click="editing = true">
        Edit
      </button>
      <button
        v-if="vmServer?.managed && resource.writable"
        class="btn btn-danger"
        :disabled="deleting"
        title="Delete the server on OpenStack"
        @click="deleteOnOpenStack"
      >
        {{ deleting ? 'Deleting…' : 'Delete' }}
      </button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="notice" class="muted">{{ notice }}</p>
    <p v-if="loading" class="muted">Loading…</p>

    <template v-if="obj && !loading">
      <section class="card props">
        <div v-for="f in fields" :key="f.key" class="prop">
          <span class="k">{{ f.label }}</span>
          <span class="v">
            <StatusPill v-if="f.pill" v-bind="f.pill" />
            <RouteLink v-else-if="f.to" class="rowlink" :to="f.to">{{ f.text }}</RouteLink>
            <template v-else>{{ f.text }}</template>
          </span>
        </div>
      </section>

      <section v-if="vmServer" class="card cat">
        <div class="cat-head">
          <h3>
            Metadata <span class="n">{{ metaFixed.length + metaRows.length }}</span>
          </h3>
          <span class="spacer" />
          <template v-if="resource.writable">
            <button class="btn btn-ghost sm" @click="metaRows.push({ key: '', value: '' })">
              + Add
            </button>
            <button
              class="btn btn-ok sm"
              :disabled="!metaDirty || savingMeta"
              @click="saveMetadata"
            >
              {{ savingMeta ? 'Saving…' : 'Save' }}
            </button>
            <button
              class="btn btn-ghost sm"
              :disabled="!metaDirty || savingMeta"
              @click="discardMetadata"
            >
              Discard
            </button>
          </template>
        </div>
        <p v-if="metaError" class="error">{{ metaError }}</p>
        <KeyValueEditor v-if="resource.writable" v-model="metaRows" :fixed="metaFixed" no-add />
        <table v-else-if="metaFixed.length || metaRows.length" class="meta-ro">
          <tr v-for="p in [...metaFixed, ...metaRows]" :key="p.key">
            <td>
              <code>{{ p.key }}</code>
            </td>
            <td>{{ p.value }}</td>
          </tr>
        </table>
      </section>

      <section v-if="config?.script" class="term">
        <div class="term-bar">
          <span class="dot r" /><span class="dot y" /><span class="dot g" />
          <span class="term-title">{{ title }}</span>
          <span class="term-meta">
            {{ (termEditing ? termDraft : scriptText).split('\n').length }} lines
          </span>
          <template v-if="resource.writable">
            <button v-if="!termEditing" class="term-btn" @click="editText">Edit</button>
            <template v-else>
              <button class="term-btn" :disabled="savingText" @click="termEditing = false">
                Cancel
              </button>
              <button class="term-btn primary" :disabled="savingText" @click="saveText">
                {{ savingText ? 'Saving…' : 'Save' }}
              </button>
            </template>
          </template>
        </div>
        <textarea
          v-if="termEditing"
          v-model="termDraft"
          class="term-body term-edit"
          spellcheck="false"
          :rows="Math.max(termDraft.replace(/\n$/, '').split('\n').length, 1)"
          wrap="off"
        />
        <pre v-else class="term-body">{{ scriptText }}</pre>
      </section>

      <section v-if="config?.script" class="card cat">
        <div class="cat-head">
          <h3>
            Variables <span class="n">{{ scriptVars.length }}</span>
          </h3>
        </div>
        <p v-if="!scriptVars.length" class="muted empty">
          No variable: the script is sent as it is.
        </p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>name</th>
                <th>default value</th>
                <th>first in the VM form</th>
                <th>secret</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in scriptVars" :key="v.name">
                <td>
                  <code>{{ v.name }}</code>
                </td>
                <td>
                  <input
                    v-if="draft[v.name]"
                    v-model="draft[v.name]!.default"
                    class="var-input"
                    :disabled="!resource.writable"
                    spellcheck="false"
                  />
                </td>
                <td>
                  <input
                    v-if="draft[v.name]"
                    v-model="draft[v.name]!.featured"
                    type="checkbox"
                    :disabled="!resource.writable"
                  />
                </td>
                <td>
                  <input
                    v-if="draft[v.name]"
                    v-model="draft[v.name]!.secret"
                    type="checkbox"
                    :disabled="!resource.writable"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="badDefault" class="error">
          The default of {{ badDefault.name }} has unbalanced braces.
        </p>
        <div v-if="resource.writable && scriptVars.length" class="var-actions">
          <button class="btn btn-ghost" :disabled="!varsDirty || savingVars" @click="resetVars">
            Reset
          </button>
          <button
            class="btn"
            :disabled="!varsDirty || savingVars || !!badDefault"
            @click="saveVars"
          >
            {{ savingVars ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </section>

      <section v-if="config?.regionStatus" class="card cat">
        <div class="cat-head">
          <h3>
            Regions <span class="n">{{ regionStatus.length }}</span>
          </h3>
        </div>
        <p v-if="!regionStatus.length" class="muted">No region synchronised yet</p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>region</th>
                <th>cluster</th>
                <th>VMs</th>
                <th>last synced</th>
                <th>status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in regionStatus" :key="String(r.name)">
                <td>{{ r.name }}</td>
                <td>
                  <RouteLink v-if="clusterTo(r)" class="rowlink" :to="clusterTo(r)!">
                    {{ r.cluster }}
                  </RouteLink>
                  <template v-else>{{ r.cluster ?? '—' }}</template>
                </td>
                <td>{{ r.servers }}</td>
                <td>{{ when(r.last_synced) }}</td>
                <td>
                  <span v-if="r.error" class="error" :title="String(r.error)">
                    ✗ {{ r.error }}
                  </span>
                  <span v-else class="ok">✓ OK</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-for="s in sections" :key="s.title" class="cat card">
        <div class="cat-head">
          <h3>
            {{ s.title }}
            <span class="n">{{ (lists[s.title] ?? []).length }}</span>
          </h3>
        </div>
        <p v-if="!(lists[s.title] ?? []).length" class="muted empty">{{ s.empty }}</p>
        <div v-else class="table-wrap">
          <ObjectTable
            :items="lists[s.title] ?? []"
            :table="s.table"
            :link-to="linkTo(s.table)"
            :preferred="
              s.table === 'virtualization_virtual_machine'
                ? [
                    'status',
                    'cluster',
                    'virtual_machine_type',
                    'image',
                    'primary_ip4',
                    'vcpus',
                    'memory',
                  ]
                : undefined
            "
          />
        </div>
      </section>
    </template>

    <ObjectForm
      v-if="editing && resource.model"
      :model="resource.model"
      :endpoint="resource.endpoint"
      :object="obj"
      @saved="
        editing = false;
        load();
      "
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
.ok {
  color: var(--ok);
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
.rowlink {
  color: var(--primary);
  font-weight: 600;
  text-decoration: underline;
}
.cat {
  padding: 14px 16px;
  margin-bottom: 14px;
}
.cat-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.cat-head h3 {
  margin: 0;
  font-size: 1.05rem;
}
.cat-head .n {
  margin-left: 6px;
  font-size: 0.8rem;
  color: var(--muted);
}
.empty {
  margin: 4px 0 0;
}
.table-wrap {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.9rem;
}
th,
td {
  border-bottom: 1px solid var(--border);
  text-align: left;
  padding: 8px 12px;
}
th {
  color: var(--muted);
  font-weight: 600;
}
.term {
  background: #0f172a;
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 14px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
}
.term-bar {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 14px;
  background: #1e293b;
}
.dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
}
.dot.r {
  background: #ef4444;
}
.dot.y {
  background: #f59e0b;
}
.dot.g {
  background: #22c55e;
}
.term-title {
  margin-left: 8px;
  color: #cbd5e1;
  font-size: 0.82rem;
  font-weight: 600;
}
.term-meta {
  margin-left: auto;
  margin-right: 6px;
  color: #64748b;
  font-size: 0.75rem;
}
.term-body {
  margin: 0;
  padding: 14px 16px;
  color: #e2e8f0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.82rem;
  line-height: 1.5;
  overflow: auto;
  max-height: 560px;
  white-space: pre;
}
.req-tag {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--warn);
  border: 1px solid var(--warn);
}
.var-input {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85rem;
}
.var-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}
.term-btn {
  padding: 3px 12px;
  border-radius: 6px;
  border: 1px solid #475569;
  background: transparent;
  color: #e2e8f0;
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
}
.term-btn:hover:not(:disabled) {
  background: #334155;
}
.term-btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: white;
}
.term-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.term-edit {
  display: block;
  width: 100%;
  box-sizing: border-box;
  background: #0f172a;
  border: 0;
  outline: none;
  resize: none;
}
.btn.sm {
  padding: 3px 10px;
  font-size: 0.8rem;
}
.meta-ro td {
  padding: 3px 14px 3px 0;
  overflow-wrap: anywhere;
}
</style>
