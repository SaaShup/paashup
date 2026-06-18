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

async function load() {
  const r = resource.value;
  const id = ui.detailId;
  if (!r || id == null) return;
  loading.value = true;
  error.value = '';
  try {
    container.value = await api.retrieve<Obj>(r.endpoint, id);
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

      <!-- attached collections -->
      <CollectionTable
        v-for="c in CONTAINER_COLLECTIONS"
        :key="c.field"
        :title="c.title"
        :empty="c.empty"
        :rows="rows(c.field)"
        :columns="c.columns"
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
</style>
