<script setup lang="ts">
// Create a VM on an OpenStack cloud: the cloud and region, then the pickers read live from
// OpenStack (flavor, image, networks, security groups) and the SSH key — one of the region's
// keypairs or one of the paasbox keys (uploaded to the region when the VM is created).
import { ref, computed, onMounted, watch } from 'vue';
import { api, ApiError, type Obj, type Page } from '../api/client.js';
import { confirmDialog } from '../composables/confirm.js';
import KeyValueEditor from './KeyValueEditor.vue';
import { fromPairs, type Pair } from '../keyValue.js';

const emit = defineEmits<{
  (e: 'saved', vmId: number | null): void;
  (e: 'cancel'): void;
  (e: 'back'): void;
}>();

const CLOUDS = '/api/plugins/openstack/clouds/';
const KEYS = '/api/virtualization/ssh-keys/';
const SCRIPTS = '/api/virtualization/init-scripts/';
// what OpenStack accepts as a keypair name; a paasbox key named otherwise cannot be used
const KEYPAIR_NAME = /^[A-Za-z0-9_-]+(?: [A-Za-z0-9_-]+)*$/;

interface Named {
  id?: string;
  name: string;
}
interface Network extends Named {
  external?: boolean;
  shared?: boolean;
}
interface Flavor extends Named {
  vcpus: number;
  ram: number;
  disk: number;
}

const clouds = ref<Obj[]>([]);
const regions = ref<string[]>([]);
const flavors = ref<Flavor[]>([]);
const images = ref<Named[]>([]);
const networks = ref<Network[]>([]);
const groups = ref<Named[]>([]);
const cloudKeys = ref<Named[]>([]);
const paasboxKeys = ref<Obj[]>([]);
const scripts = ref<Obj[]>([]);

const cloudId = ref<number | ''>('');
const region = ref('');
const name = ref('');
const flavorId = ref('');
const imageId = ref('');
const networkIds = ref<string[]>([]);
const securityGroups = ref<string[]>([]);
const sshKey = ref(''); // "cloud:<name>" or "paasbox:<id>"
const metadata = ref<Pair[]>([]);
const scriptId = ref<number | ''>('');
const varValues = ref<Record<string, string>>({}); // init script variable → value

const loading = ref(false);
const busy = ref(false);
const general = ref('');
const errors = ref<Record<string, string[]>>({});

const cloud = computed(() => clouds.value.find((c) => (c as { id: number }).id === cloudId.value));
const cloudName = computed(() => String(cloud.value?.name ?? ''));
const ready = computed(
  () =>
    !!(cloudId.value && region.value && name.value.trim() && flavorId.value && imageId.value) &&
    networkIds.value.length > 0 &&
    !!sshKey.value,
);
/** A paasbox key already present in the region (same name) is listed once, as the cloud's. */
const otherKeys = computed(() =>
  paasboxKeys.value.filter((k) => !cloudKeys.value.some((c) => c.name === k.name)),
);

interface ScriptVar {
  name: string;
  default: string;
}
const script = computed(() =>
  scripts.value.find((x) => (x as { id: number }).id === scriptId.value),
);
const scriptVars = computed<ScriptVar[]>(() => {
  const v = script.value?.variables;
  return Array.isArray(v) ? (v as ScriptVar[]) : [];
});
// the variables the script's author put first are shown as fields; the others keep their
// default unless the user opens the "other variables" section
const featuredVars = computed(() => {
  const names = script.value?.featured_variables;
  const featured = Array.isArray(names) ? names : [];
  return scriptVars.value.filter((v) => featured.includes(v.name));
});
const otherVars = computed(() => scriptVars.value.filter((v) => !featuredVars.value.includes(v)));
watch(scriptId, () => {
  varValues.value = Object.fromEntries(scriptVars.value.map((v) => [v.name, v.default]));
});

const read = async <T,>(kind: string): Promise<T[]> =>
  (
    await api.get<Page<T>>(
      `${CLOUDS}${cloudId.value}/${kind}/?region=${encodeURIComponent(region.value)}`,
    )
  ).results;

// Flavors are named "<family><generation>-<size>" (b2-7, d2-2, win-c3-8…): group them by
// family so the list can be browsed. The families below are OVHcloud's; any other name
// (m1.small…) is grouped by its prefix, and what has none goes under "Other".
const FAMILIES: Record<string, string> = {
  d: 'Discovery',
  b: 'General purpose',
  c: 'CPU optimised',
  r: 'RAM optimised',
  i: 'IOPS',
  t: 'GPU',
};
const familyOf = (flavor: string): string =>
  flavor.match(/^((?:win-)?[a-z]+\d*)[-.]/i)?.[1]?.toLowerCase() ?? '';
function familyLabel(code: string): string {
  if (!code) return 'Other';
  const windows = code.startsWith('win-');
  const base = windows ? code.slice(4) : code;
  const name = FAMILIES[base[0] ?? ''];
  return `${windows ? 'Windows — ' : ''}${name ? `${name} (${base})` : base}`;
}
const flavorGroups = computed(() => {
  const byFamily = new Map<string, Flavor[]>();
  for (const f of flavors.value) {
    const code = familyOf(f.name);
    byFamily.set(code, [...(byFamily.get(code) ?? []), f]);
  }
  const rank = (code: string): number => {
    const i = Object.keys(FAMILIES).indexOf((code.replace('win-', '')[0] ?? '') as string);
    return (code.startsWith('win-') ? 100 : 0) + (code ? (i < 0 ? 50 : i) : 99);
  };
  return [...byFamily.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([code, items]) => ({
      label: familyLabel(code),
      items: [...items].sort((a, b) => a.vcpus - b.vcpus || a.ram - b.ram),
    }));
});

// public networks first: they are what gives the VM an address reachable from the Internet
const sortedNetworks = computed(() =>
  [...networks.value].sort(
    (a, b) => Number(!!b.external) - Number(!!a.external) || a.name.localeCompare(b.name),
  ),
);
const networkHint = (n: Network): string =>
  n.external ? 'public (Internet)' : n.shared ? 'private, shared' : 'private';

const flavorLabel = (f: Flavor): string =>
  `${f.name} — ${f.vcpus} vCPU · ${Math.round((f.ram / 1024) * 10) / 10} GB RAM · ${f.disk} GB disk`;

onMounted(async () => {
  try {
    clouds.value = (await api.list(CLOUDS, { limit: 200 })).results;
    paasboxKeys.value = (await api.list(KEYS, { limit: 500 })).results;
    scripts.value = (await api.list(SCRIPTS, { limit: 500 })).results;
    if (clouds.value.length === 1) cloudId.value = (clouds.value[0] as { id: number }).id;
  } catch (e) {
    general.value = String(e);
  }
});

// a cloud gives its regions; a region gives everything the form lets you pick
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
  for (const list of [flavors, images, networks, groups, cloudKeys]) list.value = [];
  flavorId.value = imageId.value = sshKey.value = '';
  networkIds.value = [];
  securityGroups.value = [];
  if (!r) return;
  loading.value = true;
  general.value = '';
  try {
    [flavors.value, images.value, networks.value, groups.value, cloudKeys.value] =
      await Promise.all([
        read<Flavor>('flavors'),
        read<Named>('images'),
        read<Network>('networks'),
        read<Named>('security-groups'),
        read<Named>('keypairs'),
      ]);
  } catch (e) {
    general.value = e instanceof ApiError ? detailOf(e) : String(e);
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
  const meta = fromPairs(metadata.value);
  if (meta.error) {
    errors.value = { metadata: [meta.error] };
    return;
  }
  const ok = await confirmDialog({
    title: 'Create a billable VM',
    message:
      `Create "${name.value.trim()}" on ${cloudName.value} (${region.value})?\n\n` +
      'This creates a billable resource: the cloud provider charges you for as long as the VM exists (and its disk, IP…), until you delete it.',
    confirmLabel: 'Create VM',
    tone: 'warning',
  });
  if (!ok) return;
  const [source, value] = [sshKey.value.split(':')[0], sshKey.value.split(':').slice(1).join(':')];
  busy.value = true;
  try {
    const created = await api.post<{ vm_id: number | null }>(`${CLOUDS}${cloudId.value}/servers/`, {
      region: region.value,
      name: name.value.trim(),
      flavor_id: flavorId.value,
      image_id: imageId.value,
      network_ids: networkIds.value,
      security_groups: securityGroups.value,
      ssh_key: source === 'cloud' ? { source, name: value } : { source, id: Number(value) },
      metadata: meta.value,
      ...(scriptId.value
        ? { init_script: { id: scriptId.value, variables: varValues.value } }
        : {}),
    });
    emit('saved', created.vm_id ?? null);
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
    <div class="panel" :class="{ wide: scriptVars.length > 0 }">
      <h3>Add virtual machine — OpenStack</h3>
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
            <label class="req">flavor</label>
            <div class="control">
              <select v-model="flavorId">
                <option value="" disabled>—</option>
                <optgroup v-for="g in flavorGroups" :key="g.label" :label="g.label">
                  <option v-for="f in g.items" :key="f.id" :value="f.id">
                    {{ flavorLabel(f) }}
                  </option>
                </optgroup>
              </select>
              <span v-for="m in errors.flavor_id" :key="m" class="err">{{ m }}</span>
            </div>
          </div>
          <div class="row">
            <label class="req">image</label>
            <div class="control">
              <select v-model="imageId">
                <option value="" disabled>—</option>
                <option v-for="i in images" :key="i.id" :value="i.id">{{ i.name }}</option>
              </select>
              <span v-for="m in errors.image_id" :key="m" class="err">{{ m }}</span>
            </div>
          </div>
          <div class="row">
            <label class="req">networks</label>
            <div class="control">
              <label v-for="n in sortedNetworks" :key="n.id" class="check">
                <input v-model="networkIds" type="checkbox" :value="n.id" />
                <span class="check-name">{{ n.name }}</span>
                <span class="hint">{{ networkHint(n) }}</span>
              </label>
              <span v-if="!networks.length" class="hint">No network in this region.</span>
              <span v-for="m in errors.network_ids" :key="m" class="err">{{ m }}</span>
            </div>
          </div>
          <div class="row">
            <label>security groups</label>
            <div class="control">
              <label v-for="g in groups" :key="g.id" class="check">
                <input v-model="securityGroups" type="checkbox" :value="g.name" />
                <span class="check-name">{{ g.name }}</span>
              </label>
              <span class="hint">None selected: the project's default group.</span>
            </div>
          </div>
          <div class="row">
            <label class="req">SSH key</label>
            <div class="control">
              <select v-model="sshKey">
                <option value="" disabled>—</option>
                <optgroup v-if="cloudKeys.length" :label="`Keys in ${region}`">
                  <option v-for="k in cloudKeys" :key="k.name" :value="`cloud:${k.name}`">
                    {{ k.name }}
                  </option>
                </optgroup>
                <optgroup v-if="otherKeys.length" label="paasbox keys">
                  <option
                    v-for="k in otherKeys"
                    :key="(k as any).id"
                    :value="`paasbox:${(k as any).id}`"
                    :disabled="!KEYPAIR_NAME.test(String(k.name))"
                  >
                    {{ k.name
                    }}{{
                      KEYPAIR_NAME.test(String(k.name)) ? '' : ' (name not valid for OpenStack)'
                    }}
                  </option>
                </optgroup>
              </select>
              <span v-for="m in errors.ssh_key" :key="m" class="err">{{ m }}</span>
            </div>
          </div>
          <div class="row">
            <label>metadata</label>
            <div class="control">
              <KeyValueEditor v-model="metadata" key-label="key" value-label="value" />
              <span v-for="m in errors.metadata" :key="m" class="err">{{ m }}</span>
            </div>
          </div>
          <div class="row">
            <label>init script</label>
            <div class="control">
              <select v-model="scriptId">
                <option value="">None</option>
                <option v-for="x in scripts" :key="(x as any).id" :value="(x as any).id">
                  {{ x.name }}
                </option>
              </select>
              <span class="hint">Run once, at the VM's first boot.</span>
              <span v-for="m in errors.init_script" :key="m" class="err">{{ m }}</span>
            </div>
          </div>
          <div v-for="v in featuredVars" :key="v.name" class="row">
            <label>{{ v.name }}</label>
            <input v-model="varValues[v.name]" />
          </div>
          <details v-if="otherVars.length" class="others">
            <summary>Other variables ({{ otherVars.length }})</summary>
            <div v-for="v in otherVars" :key="v.name" class="row">
              <label>{{ v.name }}</label>
              <input v-model="varValues[v.name]" />
            </div>
          </details>
          <p class="billing">
            ⚠ Creating a VM is billed by the cloud provider until the VM is deleted.
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
.panel.wide {
  width: 760px;
}
.panel {
  background: white;
  border-radius: 10px;
  padding: 20px 24px;
  width: 560px;
  max-width: 92vw;
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
  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.15);
}
.check {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 2px 0;
  color: var(--text);
  font-size: 0.9rem;
  cursor: pointer;
}
.check input {
  width: auto;
  flex: none;
}
.check-name {
  font-weight: 600;
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
.others {
  margin: 4px 0 8px;
  font-size: 0.85rem;
}
.others summary {
  cursor: pointer;
  color: var(--muted);
  margin-bottom: 8px;
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
