<script setup lang="ts">
import { ref } from 'vue';
import { useUiStore } from '../stores/ui.js';
import { ApiError } from '../api/client.js';

const ui = useUiStore();
const tab = ref<'settings'>('settings');

interface GroupRow {
  label: string;
  visible: boolean;
}
interface SectionRow {
  id: string;
  label: string;
  visible: boolean;
  groups: GroupRow[];
}

// Local working copy: edited freely and only sent to the server on Save (so a stray
// click doesn't change what everyone sees). Order of `rows` is the menu order. A
// checkbox being checked means the chapter/sub-chapter is shown.
function init(): SectionRow[] {
  const hiddenSections = new Set(ui.hiddenSections);
  const hiddenGroups = new Set(ui.hiddenGroups);
  return ui.allSections.map((s) => ({
    id: s.id,
    label: s.label,
    visible: !hiddenSections.has(s.id),
    groups: s.groups.map((g) => ({ label: g, visible: !hiddenGroups.has(`${s.id}::${g}`) })),
  }));
}
const rows = ref<SectionRow[]>(init());

// Drag-and-drop reorder: drag a row's handle; `overIndex` tracks where it would land —
// hovering a row's top half targets landing before it, its bottom half after it (so even
// the last row offers an "after" position, with the trailing drop-end zone as backup).
const dragIndex = ref<number | null>(null);
const overIndex = ref<number | null>(null);

function onDragStart(i: number, e: DragEvent) {
  dragIndex.value = i;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i)); // Firefox needs real data to drag
  }
}
function onDragOverRow(i: number, e: DragEvent) {
  if (dragIndex.value === null) return;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  overIndex.value = e.clientY < rect.top + rect.height / 2 ? i : i + 1;
}
function onDrop() {
  const from = dragIndex.value;
  const to = overIndex.value;
  dragIndex.value = null;
  overIndex.value = null;
  if (from === null || to === null) return;
  // `to` counts positions as if `from` were already removed from in front of it.
  const insertAt = from < to ? to - 1 : to;
  if (insertAt === from) return; // dropped back where it started
  const row = rows.value[from]!;
  rows.value.splice(from, 1);
  rows.value.splice(insertAt, 0, row);
  edited();
}
function onDragEnd() {
  dragIndex.value = null;
  overIndex.value = null;
}

const saving = ref(false);
const error = ref('');
const saved = ref(false);

function edited() {
  saved.value = false;
}

async function save() {
  saving.value = true;
  error.value = '';
  saved.value = false;
  try {
    await ui.saveMenuSettings({
      hidden_sections: rows.value.filter((r) => !r.visible).map((r) => r.id),
      hidden_groups: rows.value.flatMap((r) =>
        r.groups.filter((g) => !g.visible).map((g) => `${r.id}::${g.label}`),
      ),
      section_order: rows.value.map((r) => r.id),
    });
    saved.value = true;
  } catch (e) {
    error.value =
      e instanceof ApiError && e.status === 403
        ? 'You need a read-write token to change this.'
        : String(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="config">
    <header class="head">
      <h2>Config</h2>
    </header>

    <nav class="tabs" role="tablist">
      <button
        role="tab"
        class="tab"
        :class="{ active: tab === 'settings' }"
        :aria-selected="tab === 'settings'"
        @click="tab = 'settings'"
      >
        Settings
      </button>
    </nav>

    <div v-show="tab === 'settings'" class="card">
      <h3>Menu chapters</h3>
      <p class="sub">
        Choose which sidebar chapters (and their sub-chapters) are shown, and in what order. This
        applies to everyone — changes need a read-write token. The Config chapter itself always
        stays visible, at the top.
      </p>

      <p v-if="error" class="notice err">{{ error }}</p>
      <p v-if="saved" class="notice ok">Saved.</p>
      <p v-if="!rows.length" class="muted">No chapters to configure yet.</p>

      <div v-else class="list">
        <div
          v-for="(row, i) in rows"
          :key="row.id"
          class="section-row"
          :class="{ dragging: dragIndex === i, 'drag-over': overIndex === i && dragIndex !== i }"
          @dragover.prevent="onDragOverRow(i, $event)"
          @drop.prevent="onDrop()"
        >
          <div class="row">
            <span
              class="drag-handle"
              draggable="true"
              aria-label="Drag to reorder"
              title="Drag to reorder"
              @dragstart="onDragStart(i, $event)"
              @dragend="onDragEnd"
              >⠿</span
            >
            <label class="check">
              <input v-model="row.visible" type="checkbox" @change="edited" />
              {{ row.label }}
            </label>
          </div>

          <label
            v-for="g in row.groups"
            :key="g.label"
            class="row sub"
            :class="{ muted: !row.visible }"
          >
            <input v-model="g.visible" type="checkbox" @change="edited" />
            {{ g.label }}
          </label>
        </div>

        <!-- A generous backup target for "after the last row" — the last row's own bottom
             half already does this too, but this forgives a slightly-off drop. -->
        <div
          class="drop-end"
          :class="{ 'drag-over': overIndex === rows.length }"
          @dragover.prevent="overIndex = rows.length"
          @drop.prevent="onDrop()"
        ></div>
      </div>

      <button class="btn" type="button" :disabled="saving" @click="save">
        {{ saving ? 'Saving…' : 'Save' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.head h2 {
  margin: 0 0 4px;
}
.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 16px;
}
.tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 8px 14px;
  font: inherit;
  font-weight: 550;
  color: var(--muted);
  cursor: pointer;
}
.tab:hover {
  color: var(--text);
}
.tab.active {
  color: var(--primary-d);
  border-bottom-color: var(--primary);
}
.card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px 18px;
}
.card h3 {
  margin: 0 0 4px;
}
.sub {
  color: var(--muted);
  margin: 0 0 14px;
  font-size: 0.9rem;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 16px;
}
.section-row {
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
  border-top: 2px solid transparent;
}
.section-row:last-of-type {
  border-bottom: none;
}
.section-row.dragging {
  opacity: 0.4;
}
.section-row.drag-over {
  border-top-color: var(--primary);
}
/* Generous hit area (not just a sliver) so dropping past the last row is easy to land. */
.drop-end {
  height: 28px;
  margin-top: -14px;
  border-top: 2px solid transparent;
}
.drop-end.drag-over {
  border-top-color: var(--primary);
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.92rem;
  padding: 2px 0;
}
.row.sub {
  margin-left: 52px;
  font-size: 0.86rem;
  color: var(--muted);
}
.row.sub.muted {
  opacity: 0.55;
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
.drag-handle {
  cursor: grab;
  color: var(--muted);
  font-size: 1.1rem;
  line-height: 1;
  padding: 0 2px;
  user-select: none;
}
.drag-handle:active {
  cursor: grabbing;
}
.muted {
  color: var(--muted);
}
.notice {
  padding: 8px 12px;
  border-radius: 8px;
  margin-bottom: 12px;
  font-size: 0.9rem;
}
.notice.err {
  background: var(--danger-soft-bg);
  color: var(--danger-soft-fg);
}
.notice.ok {
  background: var(--ok-soft-bg);
  color: var(--ok-soft-fg);
}
.btn {
  padding: 7px 14px;
  border-radius: 6px;
  border: 1px solid var(--primary);
  background: var(--primary);
  color: white;
  cursor: pointer;
}
.btn:hover {
  background: var(--primary-d);
}
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
