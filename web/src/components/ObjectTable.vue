<script setup lang="ts">
import { computed } from 'vue';
import type { Obj } from '../api/client.js';

const props = defineProps<{ items: Obj[]; editable?: boolean; extraAction?: string }>();
const emit = defineEmits<{
  (e: 'delete', id: number): void;
  (e: 'edit', row: Obj): void;
  (e: 'action', row: Obj): void;
}>();

const HIDE = new Set(['url', 'display_url', 'custom_fields', 'tags']);
const FIRST = ['id', 'display'];

const columns = computed(() => {
  const keys = new Set<string>();
  for (const row of props.items.slice(0, 20)) {
    for (const k of Object.keys(row)) if (!HIDE.has(k)) keys.add(k);
  }
  const rest = [...keys].filter((k) => !FIRST.includes(k));
  return [...FIRST.filter((k) => keys.has(k)), ...rest].slice(0, 8);
});

function cell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if ('label' in o) return String(o.label); // choice {value,label}
    if ('display' in o) return String(o.display); // nested brief
    return '{…}';
  }
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  return String(value);
}
</script>

<template>
  <table v-if="items.length">
    <thead>
      <tr>
        <th v-for="c in columns" :key="c">{{ c }}</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in items" :key="(row as any).id">
        <td v-for="c in columns" :key="c">{{ cell(row[c]) }}</td>
        <td class="ops">
          <button v-if="extraAction" class="extra" @click="emit('action', row)">
            {{ extraAction }}
          </button>
          <a
            v-if="(row as any).url"
            class="api"
            :href="(row as any).url"
            target="_blank"
            rel="noopener"
            title="Open this object's API endpoint"
            >API</a
          >
          <button v-if="editable" class="edit" title="Edit" @click="emit('edit', row)">✎</button>
          <button v-if="editable" class="del" title="Delete" @click="emit('delete', (row as any).id)">
            ✕
          </button>
        </td>
      </tr>
    </tbody>
  </table>
  <p v-else class="empty">No records.</p>
</template>

<style scoped>
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
thead th {
  background: var(--surface);
  color: var(--muted);
  font-weight: 600;
  position: sticky;
  top: 0;
}
tbody tr:hover {
  background: var(--surface);
}
.ops {
  white-space: nowrap;
  text-align: right;
}
.api,
.extra {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--primary-d);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 1px 6px;
  margin-right: 8px;
  cursor: pointer;
  background: #fff;
}
.api:hover,
.extra:hover {
  background: var(--surface-2);
}
.del,
.edit {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 0.95rem;
}
.del {
  color: var(--danger);
}
.edit {
  color: var(--primary-d);
}
.empty {
  color: var(--muted);
  padding: 14px;
}
</style>
