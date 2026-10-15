<script setup lang="ts">
// Rows of key / value inputs, like the environment variables of a Docker container: add a row,
// remove one.
import type { Pair } from '../keyValue.js';

const model = defineModel<Pair[]>({ required: true });
defineProps<{
  keyLabel?: string;
  valueLabel?: string;
  /** hide the "+ Add" button when the page puts its own in its header */
  noAdd?: boolean;
}>();

const add = () => model.value.push({ key: '', value: '' });
const remove = (i: number) => model.value.splice(i, 1);
</script>

<template>
  <div class="kv">
    <table v-if="model.length" class="kv-table">
      <thead>
        <tr>
          <th>{{ keyLabel ?? 'key' }}</th>
          <th>{{ valueLabel ?? 'value' }}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(p, i) in model" :key="i">
          <td>
            <input v-model="p.key" :placeholder="keyLabel ?? 'key'" spellcheck="false" />
          </td>
          <td>
            <input v-model="p.value" :placeholder="valueLabel ?? 'value'" spellcheck="false" />
          </td>
          <td class="tight">
            <button type="button" class="rm" aria-label="Remove" @click="remove(i)">✕</button>
          </td>
        </tr>
      </tbody>
    </table>
    <button v-if="!noAdd" type="button" class="add" @click="add">+ Add</button>
  </div>
</template>

<style scoped>
.kv-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
.kv-table th {
  text-align: left;
  font-size: 0.72rem;
  text-transform: uppercase;
  color: var(--muted);
  padding: 0 8px 4px 0;
}
.kv-table td {
  padding: 3px 8px 3px 0;
}
.kv-table td.tight {
  width: 1%;
  white-space: nowrap;
  padding-right: 0;
}
.kv-table input {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 7px;
  border: 1px solid var(--border);
  border-radius: 5px;
  font: inherit;
  background: #fff;
}
.kv-table input:disabled {
  background: var(--surface-2);
  color: var(--muted);
}
.rm {
  border: 0;
  background: transparent;
  color: var(--danger);
  cursor: pointer;
  font-size: 0.9rem;
}
.add {
  margin-top: 6px;
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--primary-d);
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
}
</style>
