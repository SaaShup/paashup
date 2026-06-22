<script setup lang="ts">
import { computed } from 'vue';
import type { Obj } from '../api/client.js';
import type { FilterOptions } from '../api/columnFilters.js';

const props = defineProps<{
  items: Obj[];
  editable?: boolean;
  extraAction?: string;
  /** Render a leading checkbox column for row selection (e.g. Docker containers). */
  selectable?: boolean;
  /** Currently-selected row ids (controlled by the parent). */
  selected?: readonly number[];
  /** Active per-column filters: { columnName -> selected value }. */
  filters?: Record<string, string>;
  /** Selectable values per column; a column gets a header dropdown when present. */
  filterOptions?: FilterOptions;
  /** Render the name (`display`) cell as a link that emits `open` (e.g. host → detail). */
  linkable?: boolean;
}>();
const emit = defineEmits<{
  (e: 'delete', id: number): void;
  (e: 'edit', row: Obj): void;
  (e: 'action', row: Obj): void;
  (e: 'open', row: Obj): void;
  (e: 'toggle', payload: { id: number; checked: boolean }): void;
  (e: 'toggle-all', checked: boolean): void;
  (e: 'filter', payload: { field: string; value: string }): void;
}>();

function onFilter(field: string, e: Event): void {
  emit('filter', { field, value: (e.target as HTMLSelectElement).value });
}

const idOf = (row: Obj): number => (row as { id: number }).id;
const selectedSet = computed(() => new Set(props.selected ?? []));
const allSelected = computed(
  () => props.items.length > 0 && props.items.every((r) => selectedSet.value.has(idOf(r))),
);
const someSelected = computed(() => props.items.some((r) => selectedSet.value.has(idOf(r))));

function onToggle(row: Obj, e: Event): void {
  emit('toggle', { id: idOf(row), checked: (e.target as HTMLInputElement).checked });
}
function onToggleAll(e: Event): void {
  emit('toggle-all', (e.target as HTMLInputElement).checked);
}

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
        <th v-if="selectable" class="selcol">
          <input
            type="checkbox"
            :checked="allSelected"
            :indeterminate.prop="someSelected && !allSelected"
            title="Select all"
            @change="onToggleAll"
          />
        </th>
        <th v-for="c in columns" :key="c" class="colhead">
          <div class="th-title">{{ c }}</div>
          <select
            v-if="filterOptions && filterOptions[c]"
            class="col-filter"
            :value="filters?.[c] ?? ''"
            :title="`Filter by ${c}`"
            @change="onFilter(c, $event)"
          >
            <option value="">All</option>
            <option v-for="o in filterOptions[c]" :key="o.value" :value="o.value">
              {{ o.label }}
            </option>
          </select>
        </th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="row in items"
        :key="(row as any).id"
        :class="{ selected: selectable && selectedSet.has(idOf(row)) }"
      >
        <td v-if="selectable" class="selcol">
          <input
            type="checkbox"
            :checked="selectedSet.has(idOf(row))"
            @change="onToggle(row, $event)"
          />
        </td>
        <td v-for="c in columns" :key="c">
          <button
            v-if="linkable && (c === 'display' || c === 'id')"
            class="rowlink"
            @click="emit('open', row)"
          >
            {{ cell(row[c]) }}
          </button>
          <template v-else>{{ cell(row[c]) }}</template>
        </td>
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
          <button
            v-if="editable"
            class="del"
            title="Delete"
            @click="emit('delete', (row as any).id)"
          >
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
.rowlink {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--primary);
  font: inherit;
  font-weight: 600;
  text-align: left;
  text-decoration: underline;
}
.rowlink:hover {
  color: var(--primary-d);
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
.colhead {
  vertical-align: top;
}
.th-title {
  margin-bottom: 2px;
}
.col-filter {
  display: block;
  width: 100%;
  max-width: 180px;
  margin-top: 2px;
  padding: 3px 6px;
  font-size: 0.76rem;
  font-weight: 400;
  color: var(--text);
}
tbody tr:hover {
  background: var(--surface);
}
.ops {
  white-space: nowrap;
  text-align: right;
}
.selcol {
  width: 1%;
  white-space: nowrap;
  text-align: center;
}
.selcol input {
  cursor: pointer;
}
tbody tr.selected {
  background: var(--surface-2);
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
