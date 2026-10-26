<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Route } from '../router.js';
import RouteLink from './RouteLink.vue';
import type { Obj } from '../api/client.js';
import type { FilterOptions } from '../api/columnFilters.js';
import { useUiStore } from '../stores/ui.js';
import { briefTarget } from '../views/objectDetail.js';
import { columnLabel, formatUnit, pillFor } from '../format.js';
import StatusPill from './StatusPill.vue';

const props = defineProps<{
  items: Obj[];
  /** Table of the rows: gives memory, disk… their unit. */
  table?: string;
  editable?: boolean;
  extraAction?: string;
  /** Columns to show right after id/name, ahead of the others (the table shows at most 8). */
  preferred?: string[];
  /** Columns never shown in this table (large text, derived data…). */
  hidden?: string[];
  /** Render a leading checkbox column for row selection (e.g. Docker containers). */
  selectable?: boolean;
  /** Currently-selected row ids (controlled by the parent). */
  selected?: readonly number[];
  /** Active per-column filters: { columnName -> selected value }. */
  filters?: Record<string, string>;
  /** Selectable values per column; a column gets a header dropdown when present. */
  filterOptions?: FilterOptions;
  /** Render the name (`display`) cell as a real link to this route (e.g. host → detail). */
  linkTo?: (row: Obj) => Route | null;
  /** Route of the extra-action link; when it returns null the button emits `action` instead. */
  actionTo?: (row: Obj) => Route | null;
}>();
const emit = defineEmits<{
  (e: 'delete', id: number): void;
  (e: 'edit', row: Obj): void;
  (e: 'action', row: Obj): void;
  (e: 'toggle', payload: { id: number; checked: boolean }): void;
  (e: 'toggle-all', checked: boolean): void;
  (e: 'filter', payload: { field: string; value: string }): void;
}>();

function onFilter(field: string, e: Event): void {
  emit('filter', { field, value: (e.target as HTMLSelectElement).value });
}

const ui = useUiStore();
/** A foreign-key cell whose target has a detail page links to it. */
function briefRoute(value: unknown): Route | null {
  const t = briefTarget(value, ui.resources);
  return t ? { view: 'detail', table: t.table, id: t.id } : null;
}

const idOf = (row: Obj): number => (row as { id: number }).id;
// Rows that are added and removed but never edited (a VM's SSH key goes through its agent).
const NO_EDIT_TABLES = new Set(['plugin_docker_vm_ssh_key']);
const canEdit = computed(() => props.editable && !NO_EDIT_TABLES.has(props.table ?? ''));
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

// source_type / source_id are the raw halves of the `source` link shown instead
const HIDE = new Set(['url', 'display_url', 'custom_fields', 'tags', 'source_type', 'source_id']);
const FIRST = ['id', 'display'];

const columns = computed(() => {
  const keys = new Set<string>();
  for (const row of props.items.slice(0, 20)) {
    for (const k of Object.keys(row)) if (!HIDE.has(k) && !props.hidden?.includes(k)) keys.add(k);
  }
  const front = [...FIRST, ...(props.preferred ?? [])].filter((k) => keys.has(k));
  const rest = [...keys].filter((k) => !front.includes(k));
  return [...front, ...rest].slice(0, 8);
});

/** The value of a column listed in CLIPPED_COLUMNS (an SSH key…) is cut with an ellipsis instead of
 *  stretching the table; a Copy button puts the full value on the clipboard. */
const CLIPPED_COLUMNS = new Set(['public_key']);
const isLong = (column: string, value: unknown): boolean =>
  CLIPPED_COLUMNS.has(column) && typeof value === 'string' && value.length > 48;

const copied = ref('');
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function copyValue(value: unknown, key: string): Promise<void> {
  const text = String(value);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // no clipboard API (plain-http origin): select + copy from a temporary field
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
  copied.value = key;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copied.value = ''), 1500);
}

/** A cell's text: with its unit when the column has one (memory, disk…), else as is. */
const show = (row: Obj, column: string): string =>
  formatUnit(props.table, column, row[column]) ?? cell(row[column]);

function cell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if ('label' in o) return String(o.label); // choice {value,label}
    if ('display' in o) return o.version ? `${o.display}:${o.version}` : String(o.display); // nested brief (+ image version)
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
          <div class="th-title">{{ columnLabel(table, c) }}</div>
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
        <td v-for="c in columns" :key="c" :class="{ long: isLong(c, row[c]) }">
          <RouteLink
            v-if="linkTo && (c === 'display' || c === 'id') && linkTo(row)"
            class="rowlink"
            :to="linkTo(row)!"
          >
            {{ show(row, c) }}
          </RouteLink>
          <StatusPill v-else-if="pillFor(table, c, row[c])" v-bind="pillFor(table, c, row[c])!" />
          <RouteLink v-else-if="briefRoute(row[c])" class="rowlink" :to="briefRoute(row[c])!">
            {{ show(row, c) }}
          </RouteLink>
          <span v-else-if="isLong(c, row[c])" class="clip">
            <span class="clip-text" :title="show(row, c)">{{ show(row, c) }}</span>
            <button
              type="button"
              class="copy"
              title="Copy the full value"
              @click="copyValue(row[c], `${idOf(row)}:${c}`)"
            >
              {{ copied === `${idOf(row)}:${c}` ? '✓ Copied' : 'Copy' }}
            </button>
          </span>
          <template v-else>{{ show(row, c) }}</template>
        </td>
        <td class="ops">
          <template v-if="extraAction">
            <RouteLink v-if="actionTo?.(row)" class="extra" :to="actionTo(row)!">
              {{ extraAction }}
            </RouteLink>
            <button v-else class="extra" @click="emit('action', row)">
              {{ extraAction }}
            </button>
          </template>
          <a
            v-if="(row as any).url"
            class="api"
            :href="(row as any).url"
            target="_blank"
            rel="noopener"
            title="Open this object's API endpoint"
            >API</a
          >
          <button v-if="canEdit" class="edit" title="Edit" @click="emit('edit', row)">✎</button>
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
td.long {
  max-width: 320px;
}
.clip {
  display: flex;
  align-items: center;
  gap: 6px;
}
.clip-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.copy {
  flex: none;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 0.75rem;
  cursor: pointer;
}
.copy:hover {
  border-color: var(--primary);
  color: var(--primary);
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
  text-decoration: none;
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
