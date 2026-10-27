<script setup lang="ts">
// Add an SSH key to a VM, through its agent. From a VM's page (`vmId`): a key of the
// catalog, or a new one — created in the catalog first, then deployed. From a key's page
// (`sshKeyId`): the VM to deploy it to. `present` are the ids already there (keys of the
// VM, or VMs having the key), left out of the choices.
import { ref, computed, onMounted } from 'vue';
import { api, ApiError } from '../api/client.js';

const props = defineProps<{ vmId?: number; sshKeyId?: number; present: number[] }>();
const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>();

const DEPLOY = '/api/plugins/docker/vm-ssh-keys/';
const VMS = '/api/virtualization/virtual-machines/';
const KEYS = '/api/virtualization/ssh-keys/';
const byVm = computed(() => props.vmId != null);

const mode = ref<'existing' | 'new'>('existing');
const options = ref<{ id: number; name: string }[]>([]);
const chosen = ref('');
const name = ref('');
const publicKey = ref('');
const busy = ref(false);
const general = ref('');
const errors = ref<Record<string, unknown>>({});

const choices = computed(() => {
  const have = new Set(props.present);
  return options.value.filter((o) => !have.has(o.id));
});

onMounted(async () => {
  try {
    // a key goes to VMs with an IP: their agent is reached there
    const page = byVm.value
      ? await api.list(KEYS, { ordering: 'name', limit: 1000 })
      : await api.list(VMS, { primary_ip4__empty: 'false', ordering: 'name', limit: 1000 });
    options.value = page.results.map((o) => ({
      id: (o as { id: number }).id,
      name: String((o as { name?: unknown }).name ?? `#${(o as { id: number }).id}`),
    }));
  } catch (e) {
    general.value = String(e);
  }
  if (byVm.value && !choices.value.length) mode.value = 'new';
});

const fieldErr = (f: string): string => {
  const v = errors.value[f];
  return Array.isArray(v) ? v.join(' ') : '';
};

/** Show an API failure: its field errors next to the fields, the rest on top. */
function fail(e: unknown, prefix = ''): void {
  if (e instanceof ApiError && e.detail && typeof e.detail === 'object') {
    const d = e.detail as Record<string, unknown>;
    errors.value = d;
    const fields = Object.entries(d)
      .filter(([k]) => !['name', 'public_key'].includes(k) || mode.value !== 'new')
      .map(([, v]) => (Array.isArray(v) ? v.join(' ') : String(v)));
    general.value = prefix + fields.join(' ');
  } else {
    general.value = prefix + String(e);
  }
}

async function submit(): Promise<void> {
  busy.value = true;
  general.value = '';
  errors.value = {};
  try {
    let keyId = props.sshKeyId;
    let vmId = props.vmId;
    let createdNow = false;
    if (!byVm.value) vmId = Number(chosen.value);
    else if (mode.value === 'existing') keyId = Number(chosen.value);
    else {
      // a new key: into the catalog first (its own validation), then onto the VM
      try {
        const created = await api.post<{ id: number }>(KEYS, {
          name: name.value.trim(),
          public_key: publicKey.value.trim(),
        });
        keyId = created.id;
        createdNow = true;
      } catch (e) {
        fail(e);
        return;
      }
      // if the deployment fails, the key is in the catalog: retry with it as an existing key
      options.value = [...options.value, { id: keyId, name: name.value.trim() }];
      mode.value = 'existing';
      chosen.value = String(keyId);
    }
    try {
      await api.post(DEPLOY, { virtual_machine: vmId, ssh_key: keyId });
    } catch (e) {
      fail(e, createdNow ? 'Key saved in paashup, but not added to the VM: ' : '');
      return;
    }
    emit('saved');
  } finally {
    busy.value = false;
  }
}

const canSubmit = computed(() =>
  byVm.value && mode.value === 'new'
    ? !!name.value.trim() && !!publicKey.value.trim()
    : !!chosen.value,
);
</script>

<template>
  <div class="overlay" @click.self="emit('cancel')">
    <div class="panel">
      <h3>{{ byVm ? 'Add an SSH key to this VM' : 'Deploy this key to a VM' }}</h3>
      <p v-if="general" class="general">{{ general }}</p>
      <form @submit.prevent="submit">
        <div v-if="byVm" class="row">
          <label>Key</label>
          <div class="control modes">
            <label class="mode">
              <input v-model="mode" type="radio" value="existing" :disabled="!choices.length" />
              Existing key
            </label>
            <label class="mode"><input v-model="mode" type="radio" value="new" /> New key</label>
          </div>
        </div>

        <template v-if="byVm && mode === 'new'">
          <div class="row">
            <label class="req">Name</label>
            <div class="control">
              <input v-model="name" maxlength="100" />
              <span v-if="fieldErr('name')" class="err">{{ fieldErr('name') }}</span>
            </div>
          </div>
          <div class="row">
            <label class="req">Public key</label>
            <div class="control">
              <textarea
                v-model="publicKey"
                rows="4"
                spellcheck="false"
                placeholder="ssh-ed25519 AAAA… comment"
              />
              <span v-if="fieldErr('public_key')" class="err">{{ fieldErr('public_key') }}</span>
            </div>
          </div>
        </template>

        <div v-else class="row">
          <label class="req">{{ byVm ? 'SSH key' : 'Virtual machine' }}</label>
          <div class="control">
            <select v-model="chosen">
              <option value="">
                {{
                  choices.length
                    ? 'Choose…'
                    : byVm
                      ? 'No other key in paashup'
                      : 'No other VM with an IP'
                }}
              </option>
              <option v-for="o in choices" :key="o.id" :value="String(o.id)">{{ o.name }}</option>
            </select>
          </div>
        </div>

        <div class="actions">
          <button type="button" class="btn btn-ghost" @click="emit('cancel')">Cancel</button>
          <button type="submit" class="btn btn-ok" :disabled="busy || !canSubmit">
            {{ busy ? 'Adding…' : 'Add' }}
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
  z-index: 10;
}
.panel {
  background: var(--card, white);
  border-radius: 10px;
  padding: 20px 24px;
  width: 520px;
  max-width: 92vw;
  margin: auto 0; /* vertically centred; top-aligned (and scrollable) when taller than the screen */
}
h3 {
  margin-top: 0;
}
.row {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 10px;
  align-items: start;
  margin-bottom: 10px;
}
@media (max-width: 560px) {
  .row {
    grid-template-columns: 1fr;
    gap: 2px;
  }
}
label {
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
.modes {
  flex-direction: row;
  gap: 16px;
}
.mode {
  display: flex;
  align-items: center;
  gap: 6px;
  color: inherit;
}
.mode input {
  width: auto;
}
input,
select,
textarea {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font: inherit;
  width: 100%;
  box-sizing: border-box;
}
textarea {
  font-family: monospace;
  font-size: 0.85rem;
}
.err {
  color: #dc2626;
  font-size: 0.8rem;
}
.general {
  color: #dc2626;
  white-space: pre-line;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
</style>
