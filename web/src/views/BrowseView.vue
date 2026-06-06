<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { loadResources, type Resource } from '../api/resources.js';
import { useObjectsStore } from '../stores/objects.js';
import type { Obj } from '../api/client.js';
import ObjectTable from '../components/ObjectTable.vue';
import ObjectForm from '../components/ObjectForm.vue';

const objects = useObjectsStore();
const resources = ref<Resource[]>([]);
const selected = ref<string>(''); // table name
const search = ref('');
const error = ref('');
const formOpen = ref(false);
const editing = ref<Obj | null>(null);

const current = computed(() => resources.value.find((r) => r.table === selected.value));
const slot = computed(() => (selected.value ? objects.byTable[selected.value] : undefined));

async function open(table: string) {
  selected.value = table;
  const res = resources.value.find((r) => r.table === table);
  if (!res) return;
  error.value = '';
  try {
    await objects.load(table, res.endpoint, search.value ? { q: search.value, limit: 100 } : { limit: 100 });
  } catch (e) {
    error.value = String(e);
  }
}

async function del(id: number) {
  if (selected.value) await objects.remove(selected.value, id);
}

function add() {
  editing.value = null;
  formOpen.value = true;
}
function edit(row: Obj) {
  editing.value = row;
  formOpen.value = true;
}

onMounted(async () => {
  resources.value = await loadResources();
  const first = resources.value.find((r) => r.section === 'dcim') ?? resources.value[0];
  if (first) await open(first.table);
});
</script>

<template>
  <section>
    <div class="toolbar">
      <select :value="selected" @change="open(($event.target as HTMLSelectElement).value)">
        <option v-for="r in resources" :key="r.table" :value="r.table">
          {{ r.section }} / {{ r.label }}
        </option>
      </select>
      <input v-model="search" placeholder="search (q)…" @keyup.enter="open(selected)" />
      <button @click="open(selected)">Search</button>
      <span v-if="slot" class="count">{{ slot.count }} records</span>
      <span v-if="slot?.loading" class="count">loading…</span>
      <button v-if="current?.writable" class="add" @click="add">+ Add</button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <h3 v-if="current">{{ current.label }} <small>{{ current.endpoint }}</small></h3>
    <ObjectTable v-if="slot" :items="slot.items" :editable="current?.writable" @delete="del" @edit="edit" />

    <ObjectForm
      v-if="formOpen && current?.model"
      :model="current.model"
      :endpoint="current.endpoint"
      :object="editing"
      @saved="formOpen = false"
      @cancel="formOpen = false"
    />
  </section>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
select,
input,
button {
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 0.9rem;
}
button {
  cursor: pointer;
  background: #2563eb;
  color: white;
  border-color: #2563eb;
}
.add {
  margin-left: auto;
  background: #16a34a;
  border-color: #16a34a;
}
.count {
  color: #777;
  font-size: 0.85rem;
}
.error {
  color: #b91c1c;
}
small {
  color: #999;
  font-weight: 400;
  font-size: 0.8rem;
}
</style>
