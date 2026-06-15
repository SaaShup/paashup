<script setup lang="ts">
// Enumerate the addresses of an IP range and let the user assign a name/reference
// (dns_name) + description to each — like BlueCat Proteus. Each address maps to an
// ipam_ipaddress record: existing ones are edited (PATCH), free ones are created (POST).
import { ref, computed, watch, onMounted } from 'vue';
import { api, type Obj } from '../api/client.js';
import { isV6, maskOf, bare, ipToBig, bigToV4 } from '../api/ip.js';

const props = defineProps<{ range: Obj }>();
const emit = defineEmits<{ (e: 'close'): void }>();

// The range's gateway (one address must be the gateway). Reuses ipam_iprange.gateway.
const gatewayIp = ref(bare(String(props.range.gateway ?? '')));
const settingGw = ref(false);

async function setGateway(ip: string) {
  settingGw.value = true;
  error.value = '';
  try {
    await api.update('/api/ipam/ip-ranges/', (props.range as { id: number }).id, { gateway: ip });
    gatewayIp.value = ip;
    (props.range as { gateway?: string }).gateway = ip; // reflect in the list row
  } catch (e) {
    error.value = `Could not set gateway: ${String(e)}`;
  } finally {
    settingGw.value = false;
  }
}

const PAGE = 256;
const startStr = String(props.range.start_address ?? '');
const endStr = String(props.range.end_address ?? '');
const v6 = isV6(startStr);
const start = ipToBig(startStr);
const end = ipToBig(endStr);
const mask = maskOf(startStr) || '32';
const total = start !== null && end !== null ? Number(end - start + 1n) : 0;

const offset = ref(0);
const existing = ref(new Map<string, Obj>());
const drafts = ref<Record<string, { dns_name: string; description: string }>>({});
const savingIp = ref<string | null>(null);
const error = ref('');
const loading = ref(false);

async function loadExisting() {
  if (v6 || start === null || end === null) return;
  loading.value = true;
  try {
    // pull existing IP addresses and index those that fall inside the range
    const page = await api.list('/api/ipam/ip-addresses/', { limit: 1000 });
    const m = new Map<string, Obj>();
    for (const a of page.results) {
      const ip = String((a as { address?: unknown }).address ?? '').split('/')[0];
      const n = ip ? ipToBig(ip) : null;
      if (n !== null && n >= start && n <= end) m.set(ip!, a);
    }
    existing.value = m;
    error.value = '';
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}
onMounted(loadExisting);

const rows = computed(() => {
  if (v6 || start === null || end === null) return [];
  const out: { ip: string; existing: Obj | null }[] = [];
  for (let i = 0; i < PAGE; i++) {
    const n = start + BigInt(offset.value + i);
    if (n > end) break;
    const ip = bigToV4(n);
    out.push({ ip, existing: existing.value.get(ip) ?? null });
  }
  return out;
});

// keep a draft (editable name/description) per visible address
watch(
  rows,
  (list) => {
    for (const r of list) {
      if (!drafts.value[r.ip]) {
        const ex = r.existing as { dns_name?: string; description?: string } | null;
        drafts.value[r.ip] = { dns_name: ex?.dns_name ?? '', description: ex?.description ?? '' };
      }
    }
  },
  { immediate: true },
);

const rangeFrom = computed(() => offset.value + 1);
const rangeTo = computed(() => Math.min(offset.value + PAGE, total));
function go(d: number) {
  offset.value = Math.max(0, Math.min(offset.value + d * PAGE, Math.max(0, total - 1)));
}

async function save(row: { ip: string; existing: Obj | null }) {
  const d = drafts.value[row.ip]!;
  savingIp.value = row.ip;
  error.value = '';
  try {
    if (row.existing) {
      const updated = await api.update('/api/ipam/ip-addresses/', (row.existing as { id: number }).id, {
        dns_name: d.dns_name,
        description: d.description,
      });
      existing.value.set(row.ip, updated);
    } else {
      const created = await api.create('/api/ipam/ip-addresses/', {
        address: `${row.ip}/${mask}`,
        dns_name: d.dns_name,
        description: d.description,
        status: 'active',
      });
      existing.value.set(row.ip, created);
    }
  } catch (e) {
    const detail = (e as { detail?: unknown }).detail;
    error.value = typeof detail === 'object' ? JSON.stringify(detail) : `${row.ip}: ${String(e)}`;
  } finally {
    savingIp.value = null;
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="panel">
      <header class="ph">
        <h3>Addresses · {{ startStr }} – {{ endStr }}</h3>
        <span class="muted">{{ total }} addresses</span>
        <span class="spacer" />
        <button class="x" @click="emit('close')">✕</button>
      </header>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="!v6 && !gatewayIp" class="warn">
        ⚠ This range has no gateway — select one below (at least one address must be the gateway).
      </p>
      <p v-else-if="!v6" class="gw-now">Gateway: <strong>{{ gatewayIp }}</strong></p>
      <p v-if="v6" class="muted note">
        IPv6 ranges are too large to enumerate. Manage individual addresses from IPAM → IP Addresses.
      </p>

      <template v-else>
        <div class="table-wrap">
          <table>
            <thead>
            <tr>
              <th>GW</th>
              <th>Address</th>
              <th>Status</th>
              <th>Name (DNS)</th>
              <th>Description</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.ip" :class="{ used: r.existing, gw: gatewayIp === r.ip }">
              <td class="gwcell">
                <input
                  type="radio"
                  name="range-gw"
                  :checked="gatewayIp === r.ip"
                  :disabled="settingGw"
                  title="Make this address the gateway"
                  @change="setGateway(r.ip)"
                />
              </td>
              <td class="mono">{{ r.ip }}</td>
              <td>
                <span class="tag" :class="r.existing ? 'on' : 'off'">
                  {{ r.existing ? 'assigned' : 'available' }}
                </span>
              </td>
              <td><input v-model="drafts[r.ip]!.dns_name" placeholder="hostname / device" /></td>
              <td><input v-model="drafts[r.ip]!.description" placeholder="reference" /></td>
              <td>
                <button class="save" :disabled="savingIp === r.ip" @click="save(r)">
                  {{ savingIp === r.ip ? '…' : r.existing ? 'Save' : 'Assign' }}
                </button>
              </td>
            </tr>
          </tbody>
          </table>
        </div>

        <div v-if="total > PAGE" class="pager">
          <button class="btn-ghost" :disabled="offset === 0" @click="go(-1)">‹ Prev</button>
          <span class="muted">{{ rangeFrom }}–{{ rangeTo }} of {{ total }}</span>
          <button class="btn-ghost" :disabled="rangeTo >= total" @click="go(1)">Next ›</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 4vh 0;
  overflow: auto;
  z-index: 50;
}
.panel {
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  width: 860px;
  max-width: 94vw;
}
.ph {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.ph h3 {
  margin: 0;
  font-size: 1.05rem;
}
.spacer {
  flex: 1;
}
.x {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 1rem;
  color: var(--muted);
}
.error {
  color: var(--danger);
  font-size: 0.85rem;
}
.note {
  padding: 14px 0;
}
.warn {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fde68a;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 0.85rem;
}
.gw-now {
  font-size: 0.85rem;
  color: var(--muted);
}
.gw-now strong {
  color: var(--primary-d);
  font-family: ui-monospace, monospace;
}
tr.gw {
  background: #eff6ff;
}
.gwcell {
  text-align: center;
  width: 38px;
}
.table-wrap {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.88rem;
}
th,
td {
  border-bottom: 1px solid var(--border);
  text-align: left;
  padding: 6px 8px;
}
thead th {
  background: var(--surface);
  color: var(--muted);
  position: sticky;
  top: 0;
}
.mono {
  font-family: ui-monospace, monospace;
}
tr.used {
  background: var(--surface);
}
input {
  width: 100%;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 5px;
}
.tag {
  font-size: 0.72rem;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 10px;
}
.tag.on {
  background: #dcfce7;
  color: #166534;
}
.tag.off {
  background: var(--surface-2);
  color: var(--muted);
}
.save {
  border: 1px solid var(--primary);
  background: var(--primary);
  color: #fff;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
}
.save:disabled {
  opacity: 0.6;
}
.pager {
  display: flex;
  gap: 14px;
  align-items: center;
  justify-content: flex-end;
  margin-top: 12px;
}
.btn-ghost {
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 6px;
  padding: 5px 10px;
  cursor: pointer;
}
</style>
