<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Route } from '../router.js';
import RouteLink from './RouteLink.vue';
import type { Obj } from '../api/client.js';
import type { FilterOptions } from '../api/columnFilters.js';
import { useUiStore } from '../stores/ui.js';
import { briefTarget } from '../views/objectDetail.js';
import { columnLabel, formatUnit, pillFor, rowTone, valueLabel } from '../format.js';
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
  /** Long text columns (e.g. a journal entry's comments) shown clipped with a "show more"
   *  toggle instead of stretching the table or wrapping unreadably. */
  expandable?: string[];
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

// Expandable columns (`expandable` prop): clipped by default, a "Show more" toggle reveals
// the full text in place instead of stretching every row to the longest comment.
const expandedKeys = ref(new Set<string>());
const expandKey = (row: Obj, column: string): string => `${idOf(row)}:${column}`;
const isExpandableLong = (column: string, value: unknown): boolean =>
  !!props.expandable?.includes(column) && typeof value === 'string' && value.length > 120;
function toggleExpand(key: string): void {
  const s = new Set(expandedKeys.value);
  if (s.has(key)) s.delete(key);
  else s.add(key);
  expandedKeys.value = s;
}

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

/** A cell's text: a friendlier label for known raw values, else with its unit when the
 *  column has one (memory, disk…), else as is. */
const show = (row: Obj, column: string): string =>
  valueLabel(props.table, column, row[column]) ??
  formatUnit(props.table, column, row[column]) ??
  cell(row[column]);

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
        :class="[
          { selected: selectable && selectedSet.has(idOf(row)) },
          rowTone(table, row) && `tone-row-${rowTone(table, row)}`,
        ]"
      >
        <td v-if="selectable" class="selcol">
          <input
            type="checkbox"
            :checked="selectedSet.has(idOf(row))"
            @change="onToggle(row, $event)"
          />
        </td>
        <td
          v-for="c in columns"
          :key="c"
          :class="{ long: isLong(c, row[c]) || isExpandableLong(c, row[c]) }"
        >
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
          <span v-else-if="isExpandableLong(c, row[c])" class="expand">
            <span :class="{ 'expand-clamp': !expandedKeys.has(expandKey(row, c)) }">
              {{ show(row, c) }}
            </span>
            <button type="button" class="expand-btn" @click="toggleExpand(expandKey(row, c))">
              {{ expandedKeys.has(expandKey(row, c)) ? 'Show less' : 'Show more' }}
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
}
.rowlink:hover {
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
.expand {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
  width: 100%;
}
/* Both the clamped (collapsed) and plain (expanded) text need this: an unbreakable "word"
 * (a container id, a hash…) otherwise forces its line — and the row's action buttons —
 * wider than the cell's `max-width`, clamped or not. */
.expand > span {
  width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
}
/* Wraps onto a couple of lines instead of one unbreakable nowrap line: with `table-layout:
 * auto`, an unbreakable line forces the column (and the row's action buttons) wider than
 * its `max-width`, so wrapping is what actually keeps this column — and the row — in bounds. */
.expand-clamp {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: normal;
}
.expand-btn {
  flex: none;
  border: none;
  background: none;
  padding: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--primary-d);
  cursor: pointer;
}
.expand-btn:hover {
  text-decoration: underline;
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
  font-size: 0.74rem;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
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
  width: 1%;
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
/* row-level severity tint (journal entries): a soft tinted left border + background, same
 * palette as StatusPill (see its comment) — never the only cue, since the Severity column's
 * pill in the same row already carries its own colour + label. */
tbody tr.tone-row-danger {
  background: #fcebe9;
  box-shadow: inset 3px 0 0 #b81c0e;
}
tbody tr.tone-row-warn {
  background: #fbede2;
  box-shadow: inset 3px 0 0 #dd8a55;
}
tbody tr.tone-row-ok {
  background: #f0fdf4;
  box-shadow: inset 3px 0 0 #16a34a;
}
tbody tr.tone-row-info {
  background: #f5f8ff;
  box-shadow: inset 3px 0 0 #3b82f6;
}
tbody tr.tone-row-danger:hover,
tbody tr.tone-row-warn:hover,
tbody tr.tone-row-ok:hover,
tbody tr.tone-row-info:hover {
  filter: brightness(0.98);
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
