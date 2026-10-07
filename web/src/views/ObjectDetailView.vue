<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useUiStore } from '../stores/ui.js';
import type { Route } from '../router.js';
import RouteLink from '../components/RouteLink.vue';
import ObjectTable from '../components/ObjectTable.vue';
import ObjectForm from '../components/ObjectForm.vue';
import { api, type Obj } from '../api/client.js';
import { scalarText } from './containerDetail.js';
import { briefTarget, DETAIL, LINKABLE_TABLES, type RelatedSection } from './objectDetail.js';

const ui = useUiStore();
const resource = computed(() => ui.selected);
const config = computed(() => (resource.value ? DETAIL[resource.value.table] : undefined));

const obj = ref<Obj | null>(null);
const lists = ref<Record<string, Obj[]>>({});
const regionStatus = ref<Obj[]>([]);
const loading = ref(false);
const error = ref('');
const editing = ref(false);
const refreshing = ref(false);

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
      label: k.replace(/_/g, ' '),
      text: scalarText(v),
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

async function load(): Promise<void> {
  const r = resource.value;
  const id = ui.detailId;
  if (!r || id == null) return;
  loading.value = true;
  error.value = '';
  try {
    obj.value = await api.retrieve<Obj>(r.endpoint, id);
    lists.value = {};
    regionStatus.value = [];
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

onMounted(load);
onBeforeUnmount(() => clearTimeout(poll));
watch(() => [ui.detailId, ui.selected?.table], load);

const backTo = computed<Route | null>(() =>
  resource.value ? { view: 'list', table: resource.value.table } : null,
);
const clusterTo = (row: Obj): Route | null =>
  ui.resources.some((r) => r.table === 'virtualization_cluster') && row.cluster_id
    ? { view: 'detail', table: 'virtualization_cluster', id: Number(row.cluster_id) }
    : null;
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
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">Loading…</p>

    <template v-if="obj && !loading">
      <section class="card props">
        <div v-for="f in fields" :key="f.key" class="prop">
          <span class="k">{{ f.label }}</span>
          <span class="v">
            <RouteLink v-if="f.to" class="rowlink" :to="f.to">{{ f.text }}</RouteLink>
            <template v-else>{{ f.text }}</template>
          </span>
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
</style>
