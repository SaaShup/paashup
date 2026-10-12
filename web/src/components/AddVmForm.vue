<script setup lang="ts">
// "Add" on the VMs page: pick the stack the VM runs on first, then show the form of that
// stack. Add a stack by listing it in STACKS and giving it a form below.
import { ref } from 'vue';
import ObjectForm from './ObjectForm.vue';
import OpenStackVmForm from './OpenStackVmForm.vue';

defineProps<{ model: string; endpoint: string }>();
const emit = defineEmits<{ (e: 'saved', vmId?: number | null): void; (e: 'cancel'): void }>();

const STACKS = [
  { id: 'openstack', label: 'OpenStack' },
  // a VM only described in paasbox (nothing is created anywhere)
  { id: 'manual', label: 'No cloud (record only)' },
] as const;
const stack = ref<(typeof STACKS)[number]['id'] | ''>('');
</script>

<template>
  <OpenStackVmForm
    v-if="stack === 'openstack'"
    @saved="(vmId) => emit('saved', vmId)"
    @cancel="emit('cancel')"
    @back="stack = ''"
  />
  <ObjectForm
    v-else-if="stack === 'manual'"
    :model="model"
    :endpoint="endpoint"
    @saved="emit('saved')"
    @cancel="emit('cancel')"
  />
  <div v-else class="overlay" @click.self="emit('cancel')">
    <div class="panel">
      <h3>Add virtual machine</h3>
      <form @submit.prevent>
        <div class="row">
          <label class="req">stack</label>
          <select v-model="stack" autofocus>
            <option value="" disabled>Choose where the VM runs…</option>
            <option v-for="s in STACKS" :key="s.id" :value="s.id">{{ s.label }}</option>
          </select>
        </div>
        <div class="actions">
          <button type="button" class="ghost" @click="emit('cancel')">Cancel</button>
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
}
h3 {
  margin-top: 0;
}
.row {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 10px;
  align-items: start;
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
select {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font: inherit;
  width: 100%;
  box-sizing: border-box;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
button {
  padding: 7px 14px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: white;
  color: var(--text);
  cursor: pointer;
}
</style>
