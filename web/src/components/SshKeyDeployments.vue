<script setup lang="ts">
// Where SSH keys of the catalog are deployed (read from the VMs' agents), from either side:
// on a key's page (`sshKeyId`) the VMs it is on, on a VM's page (`vmId`) the keys it has.
// Add one more (SshKeyAddForm), or remove one. The backend does the agent calls; the rows are what it
// last read (when the VMs' cloud is added or synced, or after a change made here).
import { ref, computed, onMounted, watch } from 'vue';
import { api, type Obj } from '../api/client.js';
import { useUiStore } from '../stores/ui.js';
import { useConnectionStore } from '../stores/connection.js';
import ObjectTable from './ObjectTable.vue';
import { confirmDialog } from '../composables/confirm.js';
import SshKeyAddForm from './SshKeyAddForm.vue';

const props = defineProps<{ sshKeyId?: number; vmId?: number }>();
const byVm = computed(() => props.vmId != null);

const TABLE = 'plugin_docker_vm_ssh_key';
const ui = useUiStore();
const connection = useConnectionStore();
const resource = computed(() => ui.resources.find((r) => r.table === TABLE));

type Brief = { id?: number; display?: string };
type Deployment = Obj & { id: number; virtual_machine?: Brief; ssh_key?: Brief | null };
const items = ref<Deployment[]>([]);
const formOpen = ref(false);
const error = ref('');

// on a VM's page the key is the row, on a key's page the VM is
const VM_HIDDEN = ['display', 'name', 'virtual_machine', 'public_key', 'comment', 'created'];
const KEY_HIDDEN = [
  'display',
  'name',
  'ssh_key',
  'public_key',
  'key_type',
  'fingerprint',
  'comment',
  'created',
];
const vmIdOf = (d: Deployment): number | undefined => d.virtual_machine?.id;
// the other side of each row (keys of the VM, VMs with the key): not offered again
const present = computed(() =>
  items.value
    .map((d) => (byVm.value ? d.ssh_key?.id : vmIdOf(d)))
    .filter((id): id is number => id != null),
);

async function load(): Promise<void> {
  const r = resource.value;
  if (!r) return;
  try {
    items.value = (
      await api.list(r.endpoint, {
        ...(byVm.value ? { virtual_machine_id: props.vmId } : { ssh_key_id: props.sshKeyId }),
        ordering: byVm.value ? 'name' : 'virtual_machine',
        limit: 1000,
      })
    ).results as Deployment[];
  } catch (e) {
    error.value = String(e);
  }
}
onMounted(load);
watch(() => [props.sshKeyId, props.vmId], load);

// rows come and go with syncs and changes: re-read on their events
let pending: ReturnType<typeof setTimeout> | null = null;
watch(
  () => connection.log[0],
  (e) => {
    if (e?.table !== TABLE || pending) return;
    pending = setTimeout(() => {
      pending = null;
      void load();
    }, 300);
  },
);

async function onSaved(): Promise<void> {
  formOpen.value = false;
  await load();
}

async function remove(id: number): Promise<void> {
  const r = resource.value;
  const row = items.value.find((d) => d.id === id);
  if (!r || !row) return;
  const vm = row.virtual_machine?.display ?? 'the VM';
  // the last key of the VM: removing it ends key-based SSH access to it
  let last = byVm.value && items.value.length <= 1;
  if (!byVm.value) {
    try {
      const others = await api.list(r.endpoint, { virtual_machine_id: vmIdOf(row), limit: 1 });
      last = others.count <= 1;
    } catch {
      /* unknown: no warning */
    }
  }
  const ok = await confirmDialog({
    title: 'Remove from VM',
    message:
      `Remove ${row.ssh_key?.display ?? 'this key'} from ${vm}? Its agent deletes it from authorized_keys; the key stays in paashup.` +
      (last ? '\n\nIt is the last key of this VM: key-based SSH access to it will be lost.' : ''),
    confirmLabel: 'Remove',
    tone: 'danger',
  });
  if (!ok) return;
  error.value = '';
  try {
    await api.remove(r.endpoint, id);
  } catch (e) {
    error.value = String(e);
  }
  await load();
}
</script>

<template>
  <section v-if="resource" class="card cat">
    <div class="cat-head">
      <h3>
        {{ byVm ? 'SSH keys' : 'Deployed on' }} <span class="n">{{ items.length }}</span>
      </h3>
      <span class="spacer" />
      <button
        v-if="resource.writable"
        class="btn btn-ghost sm"
        :title="byVm ? 'Add an SSH key to this VM' : 'Deploy this key to a VM'"
        @click="formOpen = true"
      >
        + Add
      </button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="!items.length" class="muted empty">
      {{ byVm ? 'No SSH keys read from this VM.' : 'Not found on any VM.' }} The keys of the VMs are
      read from their agent when their cloud is added or synchronised.
    </p>
    <div v-else class="table-wrap">
      <ObjectTable
        :items="items"
        :table="TABLE"
        :preferred="
          byVm
            ? ['ssh_key', 'account', 'key_type', 'fingerprint', 'options']
            : ['virtual_machine', 'account', 'options', 'last_updated']
        "
        :hidden="byVm ? VM_HIDDEN : KEY_HIDDEN"
        :editable="resource.writable"
        @delete="remove"
      />
    </div>
    <SshKeyAddForm
      v-if="formOpen"
      :vm-id="vmId"
      :ssh-key-id="sshKeyId"
      :present="present"
      @saved="onSaved"
      @cancel="formOpen = false"
    />
  </section>
</template>

<style scoped>
/* the same look as the other sections of the detail pages (ObjectDetailView) */
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
.spacer {
  flex: 1;
}
.btn.sm {
  padding: 3px 10px;
  font-size: 0.8rem;
}
.empty {
  margin: 4px 0 0;
}
.table-wrap {
  overflow-x: auto;
}
</style>
