<script setup lang="ts">
// Create a Cinder volume on an OpenStack cloud: pick the cloud and region, a size, and
// optionally a type and a VM to attach it to right away (left unattached otherwise — see
// src/plugins/openstack/volumes.ts). To attach/detach/resize one later, edit its Volume:
// paashup reconciles the cloud to match (see the plugin's hook on virtualization_virtual_disk).
import { ref, computed, onMounted, watch } from 'vue';
import { api, ApiError, type Obj, type Page } from '../api/client.js';
import { confirmDialog } from '../composables/confirm.js';

const emit = defineEmits<{
  (e: 'saved', diskId: number): void;
  (e: 'cancel'): void;
  (e: 'back'): void;
}>();

const CLOUDS = '/api/plugins/openstack/clouds/';
const SERVERS = '/api/plugins/openstack/servers/';
const VMS = '/api/virtualization/virtual-machines/';

interface Candidate {
  id: number;
  name: string;
}

const clouds = ref<Obj[]>([]);
const regions = ref<string[]>([]);
const volumeTypes = ref<{ id: string; name: string }[]>([]);
const candidates = ref<Candidate[]>([]);

const cloudId = ref<number | ''>('');
const region = ref('');
const name = ref('');
const sizeGb = ref<number | ''>('');
const volumeType = ref('');
const vmId = ref<number | ''>('');

const loading = ref(false);
const busy = ref(false);
const general = ref('');
const errors = ref<Record<string, string[]>>({});

const ready = computed(
  () => !!cloudId.value && !!region.value && !!name.value.trim() && !!sizeGb.value,
);
const cloudName = computed(() =>
  String(clouds.value.find((c) => (c as { id: number }).id === cloudId.value)?.name ?? ''),
);

onMounted(async () => {
  try {
    clouds.value = (await api.list(CLOUDS, { limit: 200 })).results;
    if (clouds.value.length === 1) cloudId.value = (clouds.value[0] as { id: number }).id;
  } catch (e) {
    general.value = String(e);
  }
});

watch(cloudId, async (id) => {
  regions.value = [];
  region.value = '';
  if (!id) return;
  try {
    const rows = (await api.get<Page<Obj>>(`${CLOUDS}${id}/region-status/`)).results;
    regions.value = rows.map((r) => String(r.name));
    if (regions.value.length === 1) region.value = regions.value[0]!;
  } catch (e) {
    general.value = String(e);
  }
});

watch(region, async (r) => {
  volumeTypes.value = [];
  candidates.value = [];
  volumeType.value = '';
  vmId.value = '';
  if (!r || !cloudId.value) return;
  loading.value = true;
  general.value = '';
  try {
    const [types, links, vms] = await Promise.all([
      api.list<{ id: string; name: string }>(`${CLOUDS}${cloudId.value}/volume-types/`, {
        region: r,
      }),
      api.list<Obj>(SERVERS, { limit: 5000 }),
      api.list<Obj>(VMS, { limit: 5000 }),
    ]);
    volumeTypes.value = types.results;
    const names = new Map(
      vms.results.map((v) => [Number((v as { id: number }).id), String(v.name)]),
    );
    candidates.value = links.results
      .filter((l) => Number(l.cloud_id) === cloudId.value && l.region === r)
      .map((l) => ({
        id: Number(l.virtual_machine_id),
        name: names.get(Number(l.virtual_machine_id)) ?? `#${l.virtual_machine_id}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    general.value = String(e);
  } finally {
    loading.value = false;
  }
});

function detailOf(e: ApiError): string {
  const d = e.detail as Record<string, unknown> | undefined;
  return typeof d?.detail === 'string' ? d.detail : `Request failed (${e.status})`;
}

async function submit(): Promise<void> {
  errors.value = {};
  general.value = '';
  const vm = candidates.value.find((c) => c.id === vmId.value);
  const ok = await confirmDialog({
    title: 'Create a billable volume',
    message:
      `Create "${name.value.trim()}" (${sizeGb.value} GB) on ${cloudName.value} (${region.value})` +
      `${vm ? `, attached to "${vm.name}"` : ', unattached'}?\n\n` +
      'This creates a billable resource: the cloud provider charges you for as long as it exists, until you delete it.',
    confirmLabel: 'Create volume',
    tone: 'warning',
  });
  if (!ok) return;
  busy.value = true;
  try {
    const created = await api.post<{ id: number }>(`${CLOUDS}${cloudId.value}/volumes/`, {
      region: region.value,
      name: name.value.trim(),
      size_gb: Number(sizeGb.value),
      ...(volumeType.value ? { volume_type: volumeType.value } : {}),
      ...(vmId.value ? { virtual_machine_id: Number(vmId.value) } : {}),
    });
    emit('saved', created.id);
  } catch (e) {
    if (e instanceof ApiError && e.detail && typeof e.detail === 'object') {
      const d = e.detail as Record<string, unknown>;
      if (typeof d.detail === 'string') general.value = d.detail;
      for (const [k, v] of Object.entries(d)) {
        if (Array.isArray(v)) errors.value[k] = v.map(String);
      }
      if (!general.value && !Object.keys(errors.value).length) general.value = detailOf(e);
    } else {
      general.value = String(e);
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('cancel')">
    <div class="panel">
      <h3>Add volume — OpenStack</h3>
      <p v-if="general" class="general">{{ general }}</p>
      <form @submit.prevent="submit">
        <div class="row">
          <label class="req">cloud</label>
          <div class="control">
            <select v-model="cloudId">
              <option value="" disabled>—</option>
              <option v-for="c in clouds" :key="(c as any).id" :value="(c as any).id">
                {{ c.name }}
              </option>
            </select>
            <span v-if="!clouds.length" class="hint">No OpenStack cloud yet: add one first.</span>
          </div>
        </div>
        <div class="row">
          <label class="req">region</label>
          <select v-model="region" :disabled="!regions.length">
            <option value="" disabled>—</option>
            <option v-for="r in regions" :key="r" :value="r">{{ r }}</option>
          </select>
        </div>
        <p v-if="loading" class="hint">Reading the cloud…</p>

        <template v-if="region && !loading">
          <div class="row">
            <label class="req">name</label>
            <div class="control">
              <input v-model="name" maxlength="64" />
              <span v-for="m in errors.name" :key="m" class="err">{{ m }}</span>
            </div>
          </div>
          <div class="row">
            <label class="req">size (GB)</label>
            <div class="control">
              <input v-model.number="sizeGb" type="number" min="1" max="2000" step="1" />
              <span v-for="m in errors.size_gb" :key="m" class="err">{{ m }}</span>
            </div>
          </div>
          <div class="row">
            <label>type</label>
            <select v-model="volumeType">
              <option value="">Default</option>
              <option v-for="t in volumeTypes" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </div>
          <div class="row">
            <label>attach to</label>
            <div class="control">
              <select v-model="vmId">
                <option value="">Don't attach (keep it unattached)</option>
                <option v-for="c in candidates" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
              <span v-for="m in errors.virtual_machine_id" :key="m" class="err">{{ m }}</span>
            </div>
          </div>
          <p class="billing">
            ⚠ Creating a volume is billed by the cloud provider until it is deleted.
          </p>
        </template>

        <div class="actions">
          <button type="button" class="ghost" @click="emit('back')">‹ Back</button>
          <span class="spacer" />
          <button type="button" class="ghost" @click="emit('cancel')">Cancel</button>
          <button type="submit" :disabled="busy || !ready">
            {{ busy ? 'Creating…' : 'Create' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 5vh 0;
  overflow: auto;
}
.panel {
  background: white;
  border-radius: 10px;
  padding: 20px 24px;
  width: 520px;
  max-width: 92vw;
  margin: auto 0;
}
h3 {
  margin-top: 0;
}
.row {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  margin-bottom: 8px;
}
@media (max-width: 560px) {
  .row {
    grid-template-columns: 1fr;
    gap: 2px;
  }
}
label {
  overflow-wrap: anywhere;
  font-size: 0.85rem;
  color: #555;
  padding-top: 6px;
}
label.req::after {
  content: ' *';
  color: #dc2626;
}
.control {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
input,
select {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font: inherit;
  width: 100%;
  box-sizing: border-box;
}
input:focus,
select:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: var(--ring);
}
.err {
  color: var(--danger);
  font-size: 0.78rem;
}
.hint {
  color: var(--muted);
  font-size: 0.78rem;
}
.general {
  color: var(--danger);
  font-size: 0.85rem;
}
.billing {
  margin: 12px 0 0;
  padding: 8px 10px;
  border: 1px solid var(--warn);
  border-radius: 6px;
  color: var(--warn);
  font-size: 0.85rem;
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
}
.spacer {
  flex: 1;
}
button {
  padding: 7px 14px;
  border-radius: 6px;
  border: 1px solid var(--primary);
  background: var(--primary);
  color: white;
  cursor: pointer;
}
button:hover:not(:disabled) {
  background: var(--primary-d);
}
button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
button.ghost {
  background: white;
  color: var(--text);
  border-color: var(--border);
}
</style>
