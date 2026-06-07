<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api, ApiError, type Obj } from '../api/client.js';
import { formFields, modelEndpoints, type FieldDef } from '../api/schema.js';

const props = defineProps<{ model: string; endpoint: string; object?: Obj | null }>();
const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>();

const fields = ref<FieldDef[]>([]);
const values = ref<Record<string, any>>({});
const options = ref<Record<string, { id: number; display: string }[]>>({});
const errors = ref<Record<string, unknown>>({});
const general = ref('');
const busy = ref(false);
const isEdit = !!props.object;

function initValue(f: FieldDef): unknown {
  const v = props.object?.[f.name];
  if (v === undefined || v === null) return f.kind === 'boolean' ? false : '';
  if (f.kind === 'fk') return (v as { id?: number }).id ?? '';
  if (f.kind === 'select') return (v as { value?: unknown }).value ?? v;
  if (f.kind === 'iplist') return Array.isArray(v) ? v.join('\n') : String(v ?? '');
  if (f.kind === 'json') return JSON.stringify(v, null, 2);
  return v;
}

onMounted(async () => {
  fields.value = await formFields(props.model);
  for (const f of fields.value) values.value[f.name] = initValue(f);
  // load FK picker options
  const eps = await modelEndpoints();
  for (const f of fields.value) {
    if (f.kind !== 'fk' || !f.targetModel) continue;
    const ep = eps[f.targetModel];
    if (!ep) continue;
    const page = await api.list(ep, { limit: 200 });
    options.value[f.name] = page.results.map((o) => ({
      id: (o as { id: number }).id,
      display: String((o as { display?: unknown }).display ?? (o as { id: number }).id),
    }));
  }
});

function fieldErr(name: string): string {
  const e = errors.value[name];
  if (!e) return '';
  return Array.isArray(e) ? e.join(' ') : JSON.stringify(e);
}

function buildPayload(): Obj | null {
  const out: Obj = {};
  for (const f of fields.value) {
    const v = values.value[f.name];
    switch (f.kind) {
      case 'boolean':
        out[f.name] = !!v;
        break;
      case 'number':
      case 'fk':
        if (v === '' || v === null) {
          if (f.nullable) out[f.name] = null;
        } else out[f.name] = Number(v);
        break;
      case 'select':
        if (v !== '') out[f.name] = v;
        else if (f.nullable) out[f.name] = null;
        break;
      case 'iplist': {
        const list = String(v)
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean);
        out[f.name] = list.length ? list : f.nullable ? null : [];
        break;
      }
      case 'json':
        if (String(v).trim() !== '') {
          try {
            out[f.name] = JSON.parse(v);
          } catch {
            errors.value = { ...errors.value, [f.name]: ['Invalid JSON.'] };
            return null;
          }
        }
        break;
      default:
        out[f.name] = v;
    }
  }
  return out;
}

async function submit() {
  errors.value = {};
  general.value = '';
  const payload = buildPayload();
  if (!payload) return;
  busy.value = true;
  try {
    if (isEdit) await api.update(props.endpoint, (props.object as { id: number }).id, payload);
    else await api.create(props.endpoint, payload);
    emit('saved'); // the WebSocket event updates the list
  } catch (e) {
    if (e instanceof ApiError && e.detail && typeof e.detail === 'object') {
      const d = e.detail as Record<string, unknown>;
      if ('detail' in d) general.value = String(d.detail);
      errors.value = d;
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
      <h3>{{ isEdit ? 'Edit' : 'Add' }} {{ model }}</h3>
      <p v-if="general" class="general">{{ general }}</p>
      <form @submit.prevent="submit">
        <div v-for="f in fields" :key="f.name" class="row">
          <label :class="{ req: f.required }">{{ f.name }}</label>
          <div class="control">
            <input v-if="f.kind === 'boolean'" type="checkbox" v-model="values[f.name]" />
            <select v-else-if="f.kind === 'select'" v-model="values[f.name]">
              <option value="">—</option>
              <option v-for="c in f.choices" :key="String(c)" :value="c">{{ c }}</option>
            </select>
            <select v-else-if="f.kind === 'fk'" v-model="values[f.name]">
              <option value="">—</option>
              <option v-for="o in options[f.name] ?? []" :key="o.id" :value="o.id">
                {{ o.display }}
              </option>
            </select>
            <textarea
              v-else-if="f.kind === 'iplist'"
              v-model="values[f.name]"
              rows="3"
              placeholder="one IP per line"
            />
            <textarea v-else-if="f.kind === 'json'" v-model="values[f.name]" rows="3" placeholder="{ }" />
            <input
              v-else
              :type="f.kind === 'number' ? 'number' : 'text'"
              v-model="values[f.name]"
              :maxlength="f.maxLength"
            />
            <span v-if="fieldErr(f.name)" class="err">{{ fieldErr(f.name) }}</span>
          </div>
        </div>
        <div class="actions">
          <button type="button" class="ghost" @click="emit('cancel')">Cancel</button>
          <button type="submit" :disabled="busy">{{ busy ? 'Saving…' : 'Save' }}</button>
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
  margin-bottom: 8px;
}
label {
  font-size: 0.85rem;
  color: #555;
  padding-top: 6px;
  overflow-wrap: anywhere;
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
select,
textarea {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font: inherit;
  width: 100%;
  box-sizing: border-box;
}
input:focus,
select:focus,
textarea:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.15);
}
input[type='checkbox'] {
  width: auto;
}
.err {
  color: var(--danger);
  font-size: 0.78rem;
}
.general {
  color: var(--danger);
  font-size: 0.85rem;
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
  border: 1px solid var(--primary);
  background: var(--primary);
  color: white;
  cursor: pointer;
}
button:hover {
  background: var(--primary-d);
}
button.ghost {
  background: white;
  color: var(--text);
  border-color: var(--border);
}
</style>
