<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useUiStore } from '../stores/ui.js';
import { applyRoute, type Route } from '../router.js';
import RouteLink from '../components/RouteLink.vue';
import ObjectTable from '../components/ObjectTable.vue';
import ObjectForm from '../components/ObjectForm.vue';
import { api, type Obj } from '../api/client.js';
import { confirmDialog, confirmDialogChecked } from '../composables/confirm.js';
import { scalarText } from './containerDetail.js';
import { fieldLabel, formatUnit, pillFor } from '../format.js';
import StatusPill from '../components/StatusPill.vue';
import KeyValueEditor from '../components/KeyValueEditor.vue';
import SshKeyDeployments from '../components/SshKeyDeployments.vue';
import { fromPairs, toPairs, type Pair } from '../keyValue.js';
import { useConnectionStore } from '../stores/connection.js';
import { isValidDefault, setDefault } from '../initScript.js';
import { briefTarget, DETAIL, LINKABLE_TABLES, type RelatedSection } from './objectDetail.js';
import { flavorGroups, type Flavor } from '../flavors.js';

const ui = useUiStore();
const connection = useConnectionStore();
const resource = computed(() => ui.selected);
const config = computed(() => (resource.value ? DETAIL[resource.value.table] : undefined));

const obj = ref<Obj | null>(null);
const lists = ref<Record<string, Obj[]>>({});
const regionStatus = ref<Obj[]>([]);
const loading = ref(false);
const error = ref('');
const editing = ref(false);
const refreshing = ref(false);
// A VM that is a server of an OpenStack cloud: deleting it here deletes the server on OpenStack.
const OPENSTACK_SERVERS = '/api/plugins/openstack/servers/';
const vmServer = ref<{ cloud: string; cloudId: number; region: string } | null>(null);
const notice = ref('');
// The metadata of that server (key → value), read from OpenStack and editable in place.
const metaRows = ref<Pair[]>([]);
const metaSaved = ref<Pair[]>([]);
const metaError = ref('');
const savingMeta = ref(false);
const metaDirty = computed(
  () => JSON.stringify(metaRows.value) !== JSON.stringify(metaSaved.value),
);
const deleting = ref(false);
const rebooting = ref<'soft' | 'hard' | ''>('');
const rebootMenuOpen = ref(false);
const rebootMenuEl = ref<HTMLElement | null>(null);
// Set from a transient `_rebooting` hint on the live feed (never persisted): shown on the
// VM's status pill while OpenStack is still rebooting it.
const statusRebooting = ref(false);

const resizing = ref(false);
const resizeModalOpen = ref(false);
const flavors = ref<Flavor[]>([]);
const flavorsLoading = ref(false);
const flavorsError = ref('');
const selectedFlavorId = ref('');
// Set from a transient `_resizing` hint on the live feed (never persisted): shown on the
// VM's status pill while OpenStack is still resizing it.
const statusResizing = ref(false);

const HIDE = new Set(['id', 'url', 'display_url', 'display', 'custom_fields', 'tags']);
const get = (k: string): unknown => (obj.value as Record<string, unknown> | null)?.[k];
const title = computed(() => scalarText(get('display') ?? get('name')));

const fields = computed(() => {
  if (!obj.value) return [];
  const hidden = new Set([...HIDE, ...(config.value?.hide ?? [])]);
  return Object.entries(obj.value)
    .filter(([k, v]) => !hidden.has(k) && v !== '' && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => ({
      key: k,
      label: fieldLabel(resource.value?.table, k),
      text: formatUnit(resource.value?.table, k, v) ?? scalarText(v),
      pill: pillFor(resource.value?.table, k, v),
      to: routeOfBrief(v),
    }));
});

function routeOfBrief(v: unknown): Route | null {
  const t = briefTarget(v, ui.resources);
  return t ? { view: 'detail', table: t.table, id: t.id } : null;
}

const sections = computed(() =>
  (config.value?.sections ?? [])
    .map((s) => ({ ...s, resource: ui.resources.find((r) => r.table === s.table) }))
    .filter(
      (s): s is RelatedSection & { resource: NonNullable<typeof s.resource> } => !!s.resource,
    ),
);

/** Name link of a row → its own detail page, when that table has one. */
function linkTo(table: string) {
  return (row: Obj): Route | null =>
    LINKABLE_TABLES.has(table) ? { view: 'detail', table, id: (row as { id: number }).id } : null;
}

/** Load the object and its related lists. `quiet` refreshes them in place (live updates). */
async function load(quiet = false): Promise<void> {
  const r = resource.value;
  const id = ui.detailId;
  if (!r || id == null) return;
  if (!quiet) loading.value = true;
  error.value = '';
  try {
    obj.value = await api.retrieve<Obj>(r.endpoint, id);
    if (!quiet) vmServer.value = null;
    await loadVmServer(r.table, id);
    if (!quiet) {
      lists.value = {};
      regionStatus.value = [];
      metaRows.value = metaSaved.value = [];
      metaError.value = '';
      statusRebooting.value = false;
      statusResizing.value = false;
    }
    await Promise.all([
      ...sections.value.map(async (s) => {
        try {
          // await first: spreading `lists.value` before the await would overwrite the
          // sections that finished meanwhile
          const rows = await s.load(s.resource.endpoint, id, obj.value!);
          lists.value = { ...lists.value, [s.title]: rows };
        } catch (e) {
          error.value = `${s.title}: ${String(e)}`;
        }
      }),
      config.value?.regionStatus ? loadRegionStatus(r.endpoint, id) : Promise.resolve(),
    ]);
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

async function loadVmServer(table: string, id: number): Promise<void> {
  // not reset to null first: the Metadata card would disappear and come back on every reload
  if (table !== 'virtualization_virtual_machine') {
    vmServer.value = null;
    return;
  }
  try {
    const row = (await api.list(OPENSTACK_SERVERS, { virtual_machine_id: id })).results[0];
    if (row) {
      vmServer.value = {
        cloud: String(row.cloud),
        cloudId: Number(row.cloud_id),
        region: String(row.region),
      };
      void loadMetadata(id); // a live call to the cloud: the page does not wait for it
    } else {
      vmServer.value = null;
    }
  } catch {
    vmServer.value = null; // no OpenStack plugin: a plain VM
  }
}

interface MetadataReply {
  metadata: Record<string, string>;
}
function applyMetadata(r: MetadataReply): void {
  metaSaved.value = toPairs(r.metadata);
  metaRows.value = toPairs(r.metadata);
}
async function loadMetadata(id: number): Promise<void> {
  try {
    const r = await api.get<MetadataReply>(`${OPENSTACK_SERVERS}${id}/metadata/`);
    if (ui.detailId !== id) return; // the page moved on meanwhile
    if (!metaDirty.value) applyMetadata(r); // a live update never overwrites what is being typed
  } catch (e) {
    metaError.value = `Metadata unavailable: ${errorText(e)}`;
  }
}
function discardMetadata(): void {
  metaRows.value = metaSaved.value.map((p) => ({ ...p }));
  metaError.value = '';
}
async function saveMetadata(): Promise<void> {
  const id = ui.detailId;
  if (id == null) return;
  const meta = fromPairs(metaRows.value);
  if (meta.error) {
    metaError.value = meta.error;
    return;
  }
  savingMeta.value = true;
  metaError.value = '';
  try {
    applyMetadata(
      await api.put<MetadataReply>(`${OPENSTACK_SERVERS}${id}/metadata/`, { metadata: meta.value }),
    );
  } catch (e) {
    metaError.value = errorText(e);
  } finally {
    savingMeta.value = false;
    ignoreLiveUntil = Date.now() + 1500; // the change feed echoes our own save
  }
}
/** The message an API error carries (a field error or `detail`), else its text. */
function errorText(e: unknown): string {
  const d = (e as { detail?: Record<string, unknown> }).detail;
  if (d && typeof d === 'object') {
    if (typeof d.detail === 'string') return d.detail;
    for (const v of Object.values(d))
      if (Array.isArray(v) && v.length) return v.map(String).join(' ');
  }
  return String(e);
}

/**
 * The generic edit form just saved the VM. If its name changed and it's backed by an
 * OpenStack server, push the new name to Nova too, so the two don't drift apart — a failure
 * here is surfaced but the edit itself already succeeded, so it isn't rolled back.
 */
async function onEditSaved(): Promise<void> {
  const previousName = get('name');
  editing.value = false;
  await load();
  const newName = get('name');
  if (
    vmServer.value &&
    typeof previousName === 'string' &&
    typeof newName === 'string' &&
    newName !== previousName
  ) {
    try {
      await api.put(`${OPENSTACK_SERVERS}${ui.detailId}/rename/`, { name: newName });
    } catch (e) {
      error.value = `Renamed in paashup, but OpenStack wasn't updated: ${errorText(e)}`;
    }
  }
}

/** Delete the VM's server on OpenStack, then follow the VM until it is gone. */
async function deleteOnOpenStack(): Promise<void> {
  const r = resource.value;
  const id = ui.detailId;
  if (!r || id == null || !vmServer.value) return;
  const { ok, checked: deleteVolumes } = await confirmDialogChecked({
    title: 'Delete on OpenStack',
    message: `Delete "${title.value}" on OpenStack (cloud "${vmServer.value.cloud}")?\n\nThe server is destroyed, a Docker host registered on this VM is deleted too, and this cannot be undone.`,
    confirmLabel: 'Delete',
    tone: 'danger',
    checkbox: { label: 'Also delete its data volume(s), if any (kept otherwise)' },
  });
  if (!ok) return;
  deleting.value = true;
  error.value = '';
  try {
    await api.del(`${OPENSTACK_SERVERS}${id}/`, { delete_volumes: deleteVolumes });
    notice.value = 'Deletion requested on OpenStack. This page closes when the server is gone.';
    const tick = async (): Promise<void> => {
      try {
        obj.value = await api.retrieve<Obj>(r.endpoint, id);
      } catch {
        applyRoute(ui, { view: 'list', table: r.table }); // the VM is gone
        return;
      }
      poll = setTimeout(tick, 4000);
    };
    poll = setTimeout(tick, 2000);
  } catch (e) {
    deleting.value = false;
    const d = (e as { detail?: { detail?: unknown } }).detail;
    error.value = typeof d?.detail === 'string' ? d.detail : String(e);
  }
}

/** Delete a Volume: if it mirrors a Cinder volume, the backend detaches/deletes it there too. */
async function deleteVolume(): Promise<void> {
  const r = resource.value;
  const id = ui.detailId;
  if (!r || id == null) return;
  const ok = await confirmDialog({
    title: 'Delete volume',
    message: `Delete "${title.value}"?\n\nIf it is backed by a cloud (OpenStack), the real volume is detached (if needed) and deleted there too — this cannot be undone.`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  deleting.value = true;
  error.value = '';
  try {
    await api.remove(r.endpoint, id);
    applyRoute(ui, { view: 'list', table: r.table });
  } catch (e) {
    deleting.value = false;
    const d = (e as { detail?: { detail?: unknown } }).detail;
    error.value = typeof d?.detail === 'string' ? d.detail : String(e);
  }
}

/** Reboot the VM's server on OpenStack: soft asks the guest to shut down first, hard power-cycles it. */
async function rebootOnOpenStack(type: 'soft' | 'hard'): Promise<void> {
  const id = ui.detailId;
  if (id == null || !vmServer.value) return;
  const ok = await confirmDialog({
    title: type === 'hard' ? 'Hard reboot on OpenStack' : 'Soft reboot on OpenStack',
    message:
      type === 'hard'
        ? `Hard reboot "${title.value}" on OpenStack (cloud "${vmServer.value.cloud}")?\n\nThis power-cycles the server without asking the guest OS to shut down first; use it only if a soft reboot is stuck.`
        : `Soft reboot "${title.value}" on OpenStack (cloud "${vmServer.value.cloud}")?\n\nThe guest OS is asked to shut down, then the server is started again.`,
    confirmLabel: 'Reboot',
    tone: type === 'hard' ? 'danger' : 'warning',
  });
  if (!ok) return;
  rebooting.value = type;
  error.value = '';
  try {
    await api.post(`${OPENSTACK_SERVERS}${id}/reboot/`, { type });
  } catch (e) {
    const d = (e as { detail?: { detail?: unknown } }).detail;
    error.value = typeof d?.detail === 'string' ? d.detail : String(e);
  } finally {
    rebooting.value = '';
  }
}

/** Fetch the region's flavors live from OpenStack, once, when the Resize menu is first opened. */
async function loadFlavors(): Promise<void> {
  if (!vmServer.value || flavors.value.length || flavorsLoading.value) return;
  flavorsLoading.value = true;
  flavorsError.value = '';
  try {
    flavors.value = (
      await api.get<{ results: Flavor[] }>(
        `/api/plugins/openstack/clouds/${vmServer.value.cloudId}/flavors/?region=${encodeURIComponent(vmServer.value.region)}`,
      )
    ).results;
  } catch (e) {
    flavorsError.value = String(e);
  } finally {
    flavorsLoading.value = false;
  }
}

/** The VM's current sizes, as last synced from OpenStack. */
const currentSizes = computed(() => ({
  vcpus: Number(get('vcpus') ?? NaN),
  ram: Number(get('memory') ?? NaN),
  disk: Number(get('disk') ?? NaN),
}));
// The VM's current flavor, by name: paashup's VM type is created from the flavor's own name
// (plugins/openstack/sync.ts), so this is the actual flavor running, not just a size match —
// several flavors can share the same vCPU/RAM/disk (e.g. a "-flex" variant).
const currentFlavorName = computed(
  () => (get('virtual_machine_type') as { name?: string } | null)?.name ?? '',
);

/** Why a flavor can't be picked: it's the VM's current one, or its disk is smaller than the
 *  VM's current disk — OpenStack itself refuses to shrink a disk on resize. Empty when it can. */
function flavorDisabledReason(f: Flavor): string {
  if (f.name === currentFlavorName.value) return ' (current flavor)';
  if (f.disk < currentSizes.value.disk) return ' (smaller disk, unavailable)';
  return '';
}
const flavorDisabled = (f: Flavor): boolean => flavorDisabledReason(f) !== '';

const selectedFlavor = computed(
  () => flavors.value.find((f) => f.id === selectedFlavorId.value) ?? null,
);
const groupedFlavors = computed(() => flavorGroups(flavors.value));

/** One row of the current-vs-new comparison: a base bar for the current value, then a green
 *  segment for an increase or a red one marking what a decrease takes away. Widths are a
 *  percentage of the larger of the two values, so the bar always fits its row. */
function compareBar(
  current: number,
  next: number,
): { basePct: number; deltaPct: number; tone: 'more' | 'less' | 'same' } {
  const scale = Math.max(current, next, 1);
  if (next === current) return { basePct: (current / scale) * 100, deltaPct: 0, tone: 'same' };
  if (next > current) {
    return {
      basePct: (current / scale) * 100,
      deltaPct: ((next - current) / scale) * 100,
      tone: 'more',
    };
  }
  return {
    basePct: (next / scale) * 100,
    deltaPct: ((current - next) / scale) * 100,
    tone: 'less',
  };
}

/** Open the resize popup and fetch the region's flavors live from OpenStack, once. */
function openResizeModal(): void {
  resizeModalOpen.value = true;
  selectedFlavorId.value = '';
  void loadFlavors();
}

function closeResizeModal(): void {
  resizeModalOpen.value = false;
}

/** Resize the VM's server on OpenStack to the flavor picked in the popup. */
async function resizeOnOpenStack(): Promise<void> {
  const id = ui.detailId;
  const f = selectedFlavor.value;
  if (id == null || !vmServer.value || !f) return;
  resizing.value = true;
  error.value = '';
  try {
    await api.post(`${OPENSTACK_SERVERS}${id}/resize/`, { flavor_id: f.id });
    resizeModalOpen.value = false;
  } catch (e) {
    const d = (e as { detail?: { detail?: unknown } }).detail;
    error.value = typeof d?.detail === 'string' ? d.detail : String(e);
  } finally {
    resizing.value = false;
  }
}

async function loadRegionStatus(endpoint: string, id: number): Promise<void> {
  regionStatus.value = (
    await api.get<{ results: Obj[] }>(`${endpoint}${id}/region-status/`)
  ).results;
}

let poll: ReturnType<typeof setTimeout> | undefined;
/** Ask for a new synchronisation, then follow the cloud until it is done. */
async function refresh(): Promise<void> {
  const r = resource.value;
  const id = ui.detailId;
  if (!r || id == null) return;
  refreshing.value = true;
  error.value = '';
  try {
    await api.update(r.endpoint, id, { operation: 'refresh' });
    const tick = async (): Promise<void> => {
      const o = await api.retrieve<Obj>(r.endpoint, id);
      const state = (o.state as { value?: string } | undefined)?.value;
      if (state === 'refreshing' || state === 'created') {
        poll = setTimeout(tick, 2000);
        return;
      }
      refreshing.value = false;
      await load();
    };
    poll = setTimeout(tick, 1500);
  } catch (e) {
    refreshing.value = false;
    error.value = String(e);
  }
}

function onDocClick(e: MouseEvent): void {
  if (rebootMenuOpen.value && !rebootMenuEl.value?.contains(e.target as Node)) {
    rebootMenuOpen.value = false;
  }
}

onMounted(() => {
  load();
  document.addEventListener('click', onDocClick);
});
onBeforeUnmount(() => {
  clearTimeout(poll);
  clearTimeout(liveTimer);
  document.removeEventListener('click', onDocClick);
});
watch(
  () => [ui.detailId, ui.selected?.table],
  () => load(),
);

// Follow the object live: when the change feed reports this object (a VM going from
// "planned" to "active", its address, a journal entry…), reload it in place. If it was
// deleted, go back to the list.
let liveTimer: ReturnType<typeof setTimeout> | undefined;
let ignoreLiveUntil = 0;
watch(
  () => connection.log[0],
  (e) => {
    const r = resource.value;
    const id = ui.detailId;
    if (!e || !r || id == null || e.table !== r.table || String(e.id) !== String(id)) return;
    if (e.event === 'deleted') {
      applyRoute(ui, { view: 'list', table: r.table });
      return;
    }
    const data = e.data as Record<string, unknown> | undefined;
    const stillRebooting = data?._rebooting === true;
    const stillResizing = data?._resizing === true;
    statusRebooting.value = stillRebooting;
    statusResizing.value = stillResizing;
    if (stillRebooting || stillResizing) return; // nothing persisted changed, just the hint above
    // the page just saved its own metadata: it already shows the result, a reload would flash
    if (savingMeta.value || Date.now() < ignoreLiveUntil) return;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => void load(true), 250);
  },
);

const backTo = computed<Route | null>(() =>
  resource.value ? { view: 'list', table: resource.value.table } : null,
);
const clusterTo = (row: Obj): Route | null =>
  ui.resources.some((r) => r.table === 'virtualization_cluster') && row.cluster_id
    ? { view: 'detail', table: 'virtualization_cluster', id: Number(row.cluster_id) }
    : null;
// an init script: its text, and the variables found in it
interface ScriptVar {
  name: string;
  default: string;
  featured: boolean;
  secret: boolean;
}
const scriptText = computed(() => String(get('content') ?? ''));
const scriptVars = computed<ScriptVar[]>(() => {
  const vars = get('variables');
  const feat = get('featured_variables');
  const featured = Array.isArray(feat) ? feat : [];
  const sec = get('secret_variables');
  const secret = Array.isArray(sec) ? sec : [];
  return Array.isArray(vars)
    ? (vars as { name: string; default: string }[]).map((v) => ({
        ...v,
        featured: featured.includes(v.name),
        secret: secret.includes(v.name),
      }))
    : [];
});
// Editing the variables in place: a default is rewritten in the script's text, "shown first" is
// the list kept next to it. Both are saved together.
const draft = ref<Record<string, { default: string; featured: boolean; secret: boolean }>>({});
const savingVars = ref(false);
watch(
  scriptVars,
  (vars) => {
    draft.value = Object.fromEntries(
      vars.map((v) => [v.name, { default: v.default, featured: v.featured, secret: v.secret }]),
    );
  },
  { immediate: true },
);
const badDefault = computed(() =>
  scriptVars.value.find((v) => !isValidDefault(draft.value[v.name]?.default ?? v.default)),
);
const varsDirty = computed(() =>
  scriptVars.value.some((v) => {
    const d = draft.value[v.name];
    return !!d && (d.default !== v.default || d.featured !== v.featured || d.secret !== v.secret);
  }),
);
function resetVars(): void {
  draft.value = Object.fromEntries(
    scriptVars.value.map((v) => [
      v.name,
      { default: v.default, featured: v.featured, secret: v.secret },
    ]),
  );
}
async function saveVars(): Promise<void> {
  const r = resource.value;
  const id = ui.detailId;
  if (!r || id == null || badDefault.value) return;
  let content = scriptText.value;
  for (const v of scriptVars.value) {
    const d = draft.value[v.name];
    if (d && d.default !== v.default) content = setDefault(content, v.name, d.default);
  }
  savingVars.value = true;
  error.value = '';
  try {
    await api.update(r.endpoint, id, {
      content,
      featured_variables: scriptVars.value
        .filter((v) => draft.value[v.name]?.featured)
        .map((v) => v.name),
      secret_variables: scriptVars.value
        .filter((v) => draft.value[v.name]?.secret)
        .map((v) => v.name),
    });
    await load(true);
  } catch (e) {
    const d = (e as { detail?: { content?: unknown } }).detail;
    error.value = Array.isArray(d?.content) ? d.content.join(' ') : String(e);
  } finally {
    savingVars.value = false;
  }
}
// Editing the script's text in the terminal itself.
const termEditing = ref(false);
const termDraft = ref('');
const savingText = ref(false);
function editText(): void {
  termDraft.value = scriptText.value;
  termEditing.value = true;
}
async function saveText(): Promise<void> {
  const r = resource.value;
  const id = ui.detailId;
  if (!r || id == null) return;
  savingText.value = true;
  error.value = '';
  try {
    await api.update(r.endpoint, id, {
      content: termDraft.value,
      // the variables the new text still declares keep their "shown first" and "secret" marks
      featured_variables: scriptVars.value.filter((v) => v.featured).map((v) => v.name),
      secret_variables: scriptVars.value.filter((v) => v.secret).map((v) => v.name),
    });
    termEditing.value = false;
    await load(true);
  } catch (e) {
    const d = (e as { detail?: { content?: unknown } }).detail;
    error.value = Array.isArray(d?.content) ? d.content.join(' ') : String(e);
  } finally {
    savingText.value = false;
  }
}
const when = (v: unknown): string => (v ? new Date(String(v)).toLocaleString() : '—');
</script>

<template>
  <div v-if="resource" class="detail">
    <div class="crumb muted">
      {{ resource.section.toUpperCase() }} › {{ resource.label }} › detail
    </div>
    <div class="head">
      <RouteLink v-if="backTo" class="btn btn-ghost" :to="backTo" back>‹ Back</RouteLink>
      <h2>{{ title || resource.label }}</h2>
      <span class="spacer" />
      <button v-if="config?.refresh" class="btn btn-ok" :disabled="refreshing" @click="refresh">
        {{ refreshing ? 'Refreshing…' : 'Refresh' }}
      </button>
      <button v-if="resource.writable && resource.model" class="btn" @click="editing = true">
        Edit
      </button>
      <div v-if="vmServer && resource.writable" ref="rebootMenuEl" class="reboot-wrap">
        <button class="btn" :disabled="!!rebooting" @click="rebootMenuOpen = !rebootMenuOpen">
          Reboot ▾
        </button>
        <div v-if="rebootMenuOpen" class="card reboot-menu">
          <button
            class="btn btn-ghost sm"
            title="Ask the guest OS to shut down, then start the server again"
            @click="
              rebootMenuOpen = false;
              rebootOnOpenStack('soft');
            "
          >
            Soft reboot
          </button>
          <button
            class="btn btn-ghost sm"
            title="Power-cycle the server without asking the guest OS first"
            @click="
              rebootMenuOpen = false;
              rebootOnOpenStack('hard');
            "
          >
            Hard reboot
          </button>
        </div>
      </div>
      <button v-if="vmServer && resource.writable" class="btn" @click="openResizeModal">
        Resize
      </button>
      <button
        v-if="vmServer && resource.writable"
        class="btn btn-danger"
        :disabled="deleting"
        title="Delete the server on OpenStack"
        @click="deleteOnOpenStack"
      >
        {{ deleting ? 'Deleting…' : 'Delete' }}
      </button>
      <button
        v-if="resource.table === 'virtualization_virtual_disk' && resource.writable"
        class="btn btn-danger"
        :disabled="deleting"
        @click="deleteVolume"
      >
        {{ deleting ? 'Deleting…' : 'Delete' }}
      </button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="notice" class="muted">{{ notice }}</p>
    <p v-if="loading" class="muted">Loading…</p>

    <template v-if="obj && !loading">
      <section class="card props">
        <div v-for="f in fields" :key="f.key" class="prop">
          <span class="k">{{ f.label }}</span>
          <span class="v">
            <StatusPill
              v-if="f.key === 'status' && vmServer && statusRebooting"
              label="Rebooting…"
              tone="warn"
              busy
            />
            <StatusPill
              v-else-if="f.key === 'status' && vmServer && statusResizing"
              label="Resizing…"
              tone="warn"
              busy
            />
            <StatusPill v-else-if="f.pill" v-bind="f.pill" />
            <RouteLink v-else-if="f.to" class="rowlink" :to="f.to">{{ f.text }}</RouteLink>
            <template v-else>{{ f.text }}</template>
          </span>
        </div>
      </section>

      <section v-if="vmServer" class="card cat">
        <div class="cat-head">
          <h3>
            Metadata <span class="n">{{ metaRows.length }}</span>
          </h3>
          <span class="spacer" />
          <template v-if="resource.writable">
            <button class="btn btn-ghost sm" @click="metaRows.push({ key: '', value: '' })">
              + Add
            </button>
            <button
              class="btn btn-ok sm"
              :disabled="!metaDirty || savingMeta"
              @click="saveMetadata"
            >
              {{ savingMeta ? 'Saving…' : 'Save' }}
            </button>
            <button
              class="btn btn-ghost sm"
              :disabled="!metaDirty || savingMeta"
              @click="discardMetadata"
            >
              Discard
            </button>
          </template>
        </div>
        <p v-if="metaError" class="error">{{ metaError }}</p>
        <KeyValueEditor v-if="resource.writable" v-model="metaRows" no-add />
        <table v-else-if="metaRows.length" class="meta-ro">
          <tr v-for="p in metaRows" :key="p.key">
            <td>
              <code>{{ p.key }}</code>
            </td>
            <td>{{ p.value }}</td>
          </tr>
        </table>
      </section>

      <section v-if="config?.script" class="term">
        <div class="term-bar">
          <span class="dot r" /><span class="dot y" /><span class="dot g" />
          <span class="term-title">{{ title }}</span>
          <span class="term-meta">
            {{ (termEditing ? termDraft : scriptText).split('\n').length }} lines
          </span>
          <template v-if="resource.writable">
            <button v-if="!termEditing" class="term-btn" @click="editText">Edit</button>
            <template v-else>
              <button class="term-btn" :disabled="savingText" @click="termEditing = false">
                Cancel
              </button>
              <button class="term-btn primary" :disabled="savingText" @click="saveText">
                {{ savingText ? 'Saving…' : 'Save' }}
              </button>
            </template>
          </template>
        </div>
        <textarea
          v-if="termEditing"
          v-model="termDraft"
          class="term-body term-edit"
          spellcheck="false"
          :rows="Math.max(termDraft.replace(/\n$/, '').split('\n').length, 1)"
          wrap="off"
        />
        <pre v-else class="term-body">{{ scriptText }}</pre>
      </section>

      <section v-if="config?.script" class="card cat">
        <div class="cat-head">
          <h3>
            Variables <span class="n">{{ scriptVars.length }}</span>
          </h3>
        </div>
        <p v-if="!scriptVars.length" class="muted empty">
          No variable: the script is sent as it is.
        </p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>name</th>
                <th>default value</th>
                <th>first in the VM form</th>
                <th>secret</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in scriptVars" :key="v.name">
                <td>
                  <code>{{ v.name }}</code>
                </td>
                <td>
                  <input
                    v-if="draft[v.name]"
                    v-model="draft[v.name]!.default"
                    class="var-input"
                    :disabled="!resource.writable"
                    spellcheck="false"
                  />
                </td>
                <td>
                  <input
                    v-if="draft[v.name]"
                    v-model="draft[v.name]!.featured"
                    type="checkbox"
                    :disabled="!resource.writable"
                  />
                </td>
                <td>
                  <input
                    v-if="draft[v.name]"
                    v-model="draft[v.name]!.secret"
                    type="checkbox"
                    :disabled="!resource.writable"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="badDefault" class="error">
          The default of {{ badDefault.name }} has unbalanced braces.
        </p>
        <div v-if="resource.writable && scriptVars.length" class="var-actions">
          <button class="btn btn-ghost" :disabled="!varsDirty || savingVars" @click="resetVars">
            Reset
          </button>
          <button
            class="btn"
            :disabled="!varsDirty || savingVars || !!badDefault"
            @click="saveVars"
          >
            {{ savingVars ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </section>

      <section v-if="config?.regionStatus" class="card cat">
        <div class="cat-head">
          <h3>
            Regions <span class="n">{{ regionStatus.length }}</span>
          </h3>
        </div>
        <p v-if="!regionStatus.length" class="muted">No region synchronised yet</p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>region</th>
                <th>cluster</th>
                <th>VMs</th>
                <th>last synced</th>
                <th>status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in regionStatus" :key="String(r.name)">
                <td>{{ r.name }}</td>
                <td>
                  <RouteLink v-if="clusterTo(r)" class="rowlink" :to="clusterTo(r)!">
                    {{ r.cluster }}
                  </RouteLink>
                  <template v-else>{{ r.cluster ?? '—' }}</template>
                </td>
                <td>{{ r.servers }}</td>
                <td>{{ when(r.last_synced) }}</td>
                <td>
                  <span v-if="r.error" class="error" :title="String(r.error)">
                    ✗ {{ r.error }}
                  </span>
                  <span v-else class="ok">✓ OK</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- an SSH key of the catalog: the VMs it is on, deployed / removed through their agent -->
      <SshKeyDeployments
        v-if="resource.table === 'virtualization_ssh_key' && ui.detailId != null"
        :ssh-key-id="ui.detailId"
      />
      <!-- a VM: its SSH keys, added / removed through its agent -->
      <SshKeyDeployments
        v-if="resource.table === 'virtualization_virtual_machine' && ui.detailId != null"
        :vm-id="ui.detailId"
      />

      <section v-for="s in sections" :key="s.title" class="cat card">
        <div class="cat-head">
          <h3>
            {{ s.title }}
            <span class="n">{{ (lists[s.title] ?? []).length }}</span>
          </h3>
        </div>
        <p v-if="!(lists[s.title] ?? []).length" class="muted empty">{{ s.empty }}</p>
        <div v-else class="table-wrap">
          <ObjectTable
            :items="lists[s.title] ?? []"
            :table="s.table"
            :link-to="linkTo(s.table)"
            :preferred="
              s.table === 'virtualization_virtual_machine'
                ? [
                    'status',
                    'cluster',
                    'virtual_machine_type',
                    'image',
                    'primary_ip4',
                    'vcpus',
                    'memory',
                  ]
                : undefined
            "
          />
        </div>
      </section>
    </template>

    <ObjectForm
      v-if="editing && resource.model"
      :model="resource.model"
      :endpoint="resource.endpoint"
      :object="obj"
      @saved="onEditSaved"
      @cancel="editing = false"
    />

    <Teleport to="body">
      <div
        v-if="resizeModalOpen"
        class="confirm-overlay"
        @click.self="closeResizeModal"
        @keydown.esc="closeResizeModal"
      >
        <div
          class="confirm-panel resize-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="resize-title"
        >
          <h3 id="resize-title">Resize "{{ title }}" on OpenStack</h3>
          <p class="muted" style="margin-top: -6px">
            Cloud "{{ vmServer?.cloud }}", region {{ vmServer?.region }}
          </p>

          <p v-if="flavorsLoading" class="muted">Loading flavors…</p>
          <p v-else-if="flavorsError" class="error">{{ flavorsError }}</p>
          <template v-else>
            <label class="resize-field">
              New flavor
              <select v-model="selectedFlavorId">
                <option value="" disabled>Choose a flavor…</option>
                <optgroup v-for="g in groupedFlavors" :key="g.label" :label="g.label">
                  <option
                    v-for="f in g.items"
                    :key="f.id"
                    :value="f.id"
                    :disabled="flavorDisabled(f)"
                  >
                    {{ f.name }} — {{ f.vcpus }} vCPU / {{ f.ram }} MB / {{ f.disk }} GB{{
                      flavorDisabledReason(f)
                    }}
                  </option>
                </optgroup>
              </select>
            </label>

            <div v-if="selectedFlavor" class="resize-compare">
              <div
                v-for="row in [
                  {
                    label: 'vCPUs',
                    unit: '',
                    current: currentSizes.vcpus,
                    next: selectedFlavor.vcpus,
                  },
                  { label: 'RAM', unit: 'MB', current: currentSizes.ram, next: selectedFlavor.ram },
                  {
                    label: 'Disk',
                    unit: 'GB',
                    current: currentSizes.disk,
                    next: selectedFlavor.disk,
                  },
                ]"
                :key="row.label"
                class="resize-row"
              >
                <div class="resize-row-head">
                  <span>{{ row.label }}</span>
                  <span class="muted">
                    {{ row.current }}{{ row.unit }} → {{ row.next }}{{ row.unit }}
                  </span>
                </div>
                <div class="resize-bar">
                  <div
                    class="resize-bar-base"
                    :style="{ width: compareBar(row.current, row.next).basePct + '%' }"
                  />
                  <div
                    v-if="compareBar(row.current, row.next).deltaPct > 0"
                    class="resize-bar-delta"
                    :class="compareBar(row.current, row.next).tone"
                    :style="{ width: compareBar(row.current, row.next).deltaPct + '%' }"
                  />
                </div>
              </div>
            </div>
          </template>

          <p v-if="error" class="error">{{ error }}</p>

          <div class="confirm-actions">
            <button
              type="button"
              class="btn btn-ghost"
              :disabled="resizing"
              @click="closeResizeModal"
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-warn"
              :disabled="!selectedFlavor || resizing"
              @click="resizeOnOpenStack"
            >
              {{ resizing ? 'Resizing…' : 'Resize' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
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
.ok {
  color: var(--ok);
}
.props {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px 24px;
  padding: 16px 18px;
  margin-bottom: 14px;
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
.rowlink {
  color: var(--primary);
  font-weight: 600;
  text-decoration: underline;
}
.cat {
  padding: 14px 16px;
  margin-bottom: 14px;
}
.cat-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.cat-head h3 {
  margin: 0;
  font-size: 1.05rem;
}
.cat-head .n {
  margin-left: 6px;
  font-size: 0.8rem;
  color: var(--muted);
}
.empty {
  margin: 4px 0 0;
}
.table-wrap {
  overflow-x: auto;
}
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
th {
  color: var(--muted);
  font-weight: 600;
}
.term {
  background: #0f172a;
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 14px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
}
.term-bar {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 14px;
  background: #1e293b;
}
.dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
}
.dot.r {
  background: #ef4444;
}
.dot.y {
  background: #f59e0b;
}
.dot.g {
  background: #22c55e;
}
.term-title {
  margin-left: 8px;
  color: #cbd5e1;
  font-size: 0.82rem;
  font-weight: 600;
}
.term-meta {
  margin-left: auto;
  margin-right: 6px;
  color: #64748b;
  font-size: 0.75rem;
}
.term-body {
  margin: 0;
  padding: 14px 16px;
  color: #e2e8f0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.82rem;
  line-height: 1.5;
  overflow: auto;
  max-height: 560px;
  white-space: pre;
}
.req-tag {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--warn);
  border: 1px solid var(--warn);
}
.var-input {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85rem;
}
.var-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}
.term-btn {
  padding: 3px 12px;
  border-radius: 6px;
  border: 1px solid #475569;
  background: transparent;
  color: #e2e8f0;
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
}
.term-btn:hover:not(:disabled) {
  background: #334155;
}
.term-btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: white;
}
.term-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.term-edit {
  display: block;
  width: 100%;
  box-sizing: border-box;
  background: #0f172a;
  border: 0;
  outline: none;
  resize: none;
}
.btn.sm {
  padding: 3px 10px;
  font-size: 0.8rem;
}
.reboot-wrap {
  position: relative;
}
.reboot-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  min-width: 140px;
}
.reboot-menu .btn {
  width: 100%;
  justify-content: flex-start;
}
.meta-ro td {
  padding: 3px 14px 3px 0;
  overflow-wrap: anywhere;
}
.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 10vh 16px 0;
  overflow: auto;
}
.confirm-panel {
  background: #fff;
  border-radius: 10px;
  border-top: 4px solid var(--primary);
  padding: 20px 24px;
  width: 440px;
  max-width: 100%;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.25);
}
.confirm-panel h3 {
  margin: 0 0 10px;
}
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}
.resize-panel {
  border-top-color: var(--warn);
  width: 480px;
}
.resize-field {
  display: block;
  margin: 14px 0 6px;
  font-size: 0.85rem;
  font-weight: 600;
}
.resize-field select {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 6px 8px;
  font-size: 0.9rem;
}
.resize-compare {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.resize-row-head {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  margin-bottom: 4px;
}
.resize-bar {
  position: relative;
  height: 8px;
  border-radius: 4px;
  background: #e2e8f0;
  overflow: hidden;
  display: flex;
}
.resize-bar-base {
  height: 100%;
  background: var(--primary);
}
.resize-bar-delta {
  height: 100%;
}
.resize-bar-delta.more {
  background: #22c55e;
}
.resize-bar-delta.less {
  background: #ef4444;
}
</style>
