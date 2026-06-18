<script setup lang="ts">
import type { Obj } from '../api/client.js';
import { cellText, type CollectionColumn } from '../views/containerDetail.js';

defineProps<{
  title: string;
  empty: string;
  rows: Obj[];
  columns: CollectionColumn[];
}>();
</script>

<template>
  <section class="collection">
    <h4>
      {{ title }}
      <span class="n">{{ rows.length }}</span>
    </h4>
    <p v-if="!rows.length" class="empty">{{ empty }}</p>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th v-for="c in columns" :key="c.key">{{ c.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in rows" :key="i">
            <td v-for="c in columns" :key="c.key">{{ cellText(row[c.key], c) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.collection {
  margin-top: 18px;
}
h4 {
  margin: 0 0 8px;
  font-size: 0.95rem;
  display: flex;
  align-items: center;
  gap: 8px;
}
.n {
  font-weight: 600;
  font-size: 0.72rem;
  background: var(--surface-2);
  color: var(--primary-d);
  border-radius: 10px;
  padding: 0 7px;
}
.empty {
  color: var(--muted);
  font-size: 0.88rem;
  margin: 0;
}
.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}
table {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.88rem;
}
th,
td {
  border-bottom: 1px solid var(--border);
  text-align: left;
  padding: 7px 12px;
}
tbody tr:last-child td {
  border-bottom: none;
}
thead th {
  background: var(--surface);
  color: var(--muted);
  font-weight: 600;
}
</style>
