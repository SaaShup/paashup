<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useUiStore } from '../stores/ui.js';
import { useObjectsStore } from '../stores/objects.js';
import type { Obj } from '../api/client.js';
import ObjectTable from '../components/ObjectTable.vue';
import ObjectForm from '../components/ObjectForm.vue';
import IpRangeAddresses from '../components/IpRangeAddresses.vue';

const PAGE = 50;
const ui = useUiStore();
const objects = useObjectsStore();

const offset = ref(0);
const search = ref('');
const error = ref('');
const formOpen = ref(false);
const editing = ref<Obj | null>(null);
const addrRange = ref<Obj | null>(null); // IP range whose addresses are being browsed

const resource = computed(() => ui.selected!);
const slot = computed(() => (resource.value ? objects.byTable[resource.value.table] : undefined));
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
  try {
    await objects.load(resource.value.table, resource.value.endpoint, {
      limit: PAGE,
      offset: offset.value,
      ...(search.value ? { q: search.value } : {}),
    });
  } catch (e) {
    error.value = String(e);
  }
}

watch(
  () => resource.value?.table,
  () => {
    offset.value = 0;
    search.value = '';
    load();
  },
  { immediate: true },
);

function go(delta: number) {
  offset.value = Math.max(0, offset.value + delta * PAGE);
  load();
}
async function del(id: number) {
  if (resource.value) await objects.remove(resource.value.table, id);
}
function add() {
  editing.value = null;
  formOpen.value = true;
}
function edit(row: Obj) {
  editing.value = row;
  formOpen.value = true;
}
</script>

<template>
  <div v-if="resource" class="list">
    <div class="crumb muted">{{ resource.section.toUpperCase() }} › {{ resource.label }}</div>
    <div class="head">
      <h2>{{ resource.label }}</h2>
      <span v-if="slot" class="total muted">{{ slot.count }} records</span>
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
      <span class="spacer" />
      <a class="api-pill" :href="apiUrl" target="_blank" rel="noopener" title="Open this endpoint's JSON">
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
        :editable="resource.writable"
        :extra-action="resource.table === 'ipam_iprange' ? 'IPs' : undefined"
        @delete="del"
        @edit="edit"
        @action="(row) => (addrRange = row)"
      />
    </div>

    <div v-if="slot" class="pager">
      <button class="btn btn-ghost" :disabled="offset === 0" @click="go(-1)">‹ Prev</button>
      <span class="muted">{{ rangeFrom }}–{{ rangeTo }} of {{ slot.count }}</span>
      <button class="btn btn-ghost" :disabled="rangeTo >= slot.count" @click="go(1)">Next ›</button>
    </div>

    <ObjectForm
      v-if="formOpen && resource.model"
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
