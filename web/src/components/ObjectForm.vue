<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { api, ApiError, type Obj } from '../api/client.js';
import { currentUsername } from '../auth/oidc.js';
import { formFields, modelEndpoints, getSchemaDoc, type FieldDef } from '../api/schema.js';

const props = defineProps<{
  model: string;
  endpoint: string;
  object?: Obj | null;
  /** Create-mode initial field values (e.g. { host: 14 } when adding from a host page). */
  defaults?: Obj | null;
}>();
const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>();

const fields = ref<FieldDef[]>([]);
const values = ref<Record<string, any>>({});
const options = ref<Record<string, { id: number; display: string }[]>>({});
const errors = ref<Record<string, unknown>>({});
const general = ref('');
const busy = ref(false);
const isEdit = !!props.object;

/** Readable tag name from a serialized json */
function tagName(t: unknown): string {
  if (t && typeof t === 'object') {
    const o = t as Record<string, unknown>;
    return String(o.name ?? o.display ?? o.id ?? '');
  }
  return String(t ?? '');
}

function initValue(f: FieldDef): unknown {
  const v = props.object?.[f.name];
  // On create, seed caller-provided defaults (e.g. host=<id> when adding from a host
  // page). For an FK field the default is the related id; the user can still change it.
  if (!isEdit) {
    const dv = props.defaults?.[f.name];
    if (dv !== undefined && dv !== null && dv !== '') {
      if (f.kind === 'tags') return Array.isArray(dv) ? dv.map(tagName) : [];
      return f.kind === 'multiselect' ? (Array.isArray(dv) ? [...dv] : []) : dv;
    }
    // prefill an origin-defaulted field (e.g. a host's netbox_base_url) with the current
    // browser origin; the user can still override it before saving.
    if (f.defaultOrigin && (v === undefined || v === null || v === '')) {
      return window.location.origin;
    }
  }
  if (f.kind === 'tags') return Array.isArray(v) ? v.map(tagName).filter(Boolean) : [];
  if (f.kind === 'multiselect') return Array.isArray(v) ? [...v] : [];
  if (v === undefined || v === null) return f.kind === 'boolean' ? false : '';
  if (f.kind === 'fk') return (v as { id?: number }).id ?? '';
  if (f.kind === 'select') return (v as { value?: unknown }).value ?? v;
  if (f.kind === 'iplist') return Array.isArray(v) ? v.join('\n') : String(v ?? '');
  if (f.kind === 'json') return JSON.stringify(v, null, 2);
  return v;
}

// FK pickers can depend on sibling FK fields: when this form has a *required* FK field
// (e.g. host) that also exists on an option's target model (e.g. DockerImage.host), the
// options are filtered by its current value — so a container's image picker only offers
// the chosen host's images, and re-loads when the host changes.
const fkDeps = ref<Record<string, string[]>>({});
const endpoints = ref<Record<string, string>>({});

/** Option label: the display string, with a `:version` suffix when the row has one
 *  (e.g. Docker images list as "nginx:alpine", not just "nginx"). */
function optionLabel(o: Obj): string {
  const row = o as { id: number; display?: unknown; version?: unknown };
  const d = String(row.display ?? row.id);
  return row.version ? `${d}:${row.version}` : d;
}

async function loadOptions(f: FieldDef): Promise<void> {
  const ep = f.targetModel ? endpoints.value[f.targetModel] : undefined;
  if (!ep) return;
  const params: Record<string, string | number> = { limit: 200 };
  for (const dep of fkDeps.value[f.name] ?? []) {
    const v = values.value[dep];
    if (v === '' || v === null || v === undefined) {
      options.value[f.name] = []; // wait for the dependency (e.g. pick the host first)
      return;
    }
    params[dep] = String(v);
  }
  const page = await api.list(ep, params);
  options.value[f.name] = page.results.map((o) => ({
    id: (o as { id: number }).id,
    display: optionLabel(o as Obj),
  }));
  // drop a selection that fell out of the (re-)filtered list
  const sel = values.value[f.name];
  if (sel !== '' && sel != null && !options.value[f.name]!.some((o) => o.id === Number(sel))) {
    values.value[f.name] = '';
  }
}

/** Placeholder for an FK select: names the sibling field to pick first when empty. */
function fkPlaceholder(f: FieldDef): string {
  for (const dep of fkDeps.value[f.name] ?? []) {
    const v = values.value[dep];
    if (v === '' || v === null || v === undefined) return `—`;
  }
  return '—';
}

onMounted(async () => {
  fields.value = await formFields(props.model);
  for (const f of fields.value) values.value[f.name] = initValue(f);
  // load FK picker options (dependent ones filtered by their sibling's value)
  endpoints.value = await modelEndpoints();
  const doc = await getSchemaDoc();
  const fks = fields.value.filter((f) => f.kind === 'fk' && f.targetModel);
  for (const f of fks) {
    fkDeps.value[f.name] = fks
      .filter(
        (g) =>
          g.name !== f.name &&
          g.required &&
          doc.components?.schemas?.[`${f.targetModel}Request`]?.properties?.[g.name],
      )
      .map((g) => g.name);
  }
  await Promise.all(fks.map((f) => loadOptions(f)));
  // a new SSH key belongs to the signed-in user by default (still editable)
  if (!isEdit && props.model === 'SshKey' && !values.value.owner) {
    const me = currentUsername()?.toLowerCase();
    const mine = options.value.owner?.find((o) => o.display.toLowerCase() === me);
    if (mine) values.value.owner = mine.id;
  }
  // re-filter dependent pickers when the field they depend on changes
  for (const f of fks) {
    if (!fkDeps.value[f.name]?.length) continue;
    watch(
      () => fkDeps.value[f.name]!.map((d) => values.value[d]).join('|'),
      () => void loadOptions(f),
    );
  }
});

// tags chips editor
const tagDraft = ref<Record<string, string>>({});

function addTag(name: string) {
  const t = (tagDraft.value[name] ?? '').trim().replace(/,+$/, '');
  tagDraft.value[name] = '';
  if (!t) return;
  const list = values.value[name] as string[];
  if (!list.includes(t)) list.push(t);
}
function removeTag(name: string, i: number) {
  (values.value[name] as string[]).splice(i, 1);
}
function onTagKeydown(e: KeyboardEvent, name: string) {
  if (e.key !== 'Enter' && e.key !== ',') return;
  e.preventDefault(); // Enter adds the chip instead of submitting the form
  addTag(name);
}

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
      case 'multiselect':
        out[f.name] = Array.isArray(v) ? v : [];
        break;
      case 'tags':
        out[f.name] = (Array.isArray(v) ? (v as string[]) : []).map((name) => ({ name }));
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
  for (const f of fields.value) if (f.kind === 'tags') addTag(f.name);
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
            <select
              v-else-if="f.kind === 'multiselect'"
              v-model="values[f.name]"
              multiple
              :size="Math.min(10, (f.choices?.length ?? 0) || 1)"
            >
              <option v-for="c in f.choices" :key="String(c)" :value="c">{{ c }}</option>
            </select>
            <select v-else-if="f.kind === 'fk'" v-model="values[f.name]">
              <option value="">{{ fkPlaceholder(f) }}</option>
              <option v-for="o in options[f.name] ?? []" :key="o.id" :value="o.id">
                {{ o.display }}
              </option>
            </select>
            <div v-else-if="f.kind === 'tags'" class="tags">
              <span v-for="(t, i) in values[f.name]" :key="t" class="chip">
                {{ t }}
                <button
                  type="button"
                  class="chip-x"
                  :aria-label="`Remove tag ${t}`"
                  @click="removeTag(f.name, i)"
                >
                  ✕
                </button>
              </span>
              <input
                class="tag-input"
                v-model="tagDraft[f.name]"
                placeholder="add tag…"
                @keydown="onTagKeydown($event, f.name)"
                @blur="addTag(f.name)"
              />
            </div>
            <textarea
              v-else-if="f.kind === 'iplist'"
              v-model="values[f.name]"
              rows="3"
              placeholder="one IP per line"
            />
            <textarea
              v-else-if="f.kind === 'json'"
              v-model="values[f.name]"
              rows="3"
              placeholder="{ }"
            />
            <textarea
              v-else-if="f.kind === 'textarea'"
              v-model="values[f.name]"
              class="long-text"
              rows="6"
              spellcheck="false"
            />
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
/* narrow screens: stack the label above its control */
@media (max-width: 560px) {
  .row {
    grid-template-columns: 1fr;
    gap: 2px;
  }
  label {
    padding-top: 0;
  }
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
textarea.long-text {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85rem;
  word-break: break-all;
  resize: vertical;
}
input[type='checkbox'] {
  width: auto;
}
.err {
  color: var(--danger);
  font-size: 0.78rem;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.tags:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.15);
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--surface-2, #eef2f7);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px 6px 2px 10px;
  font-size: 0.82rem;
  line-height: 1.4;
}
.chip-x {
  border: none;
  background: none;
  color: var(--muted, #64748b);
  padding: 0 2px;
  font-size: 0.72rem;
  line-height: 1;
  cursor: pointer;
}
.chip-x:hover {
  color: var(--danger);
  background: none;
}
.tag-input {
  flex: 1;
  min-width: 90px;
  border: none;
  padding: 3px 2px;
  width: auto;
}
.tag-input:focus {
  border: none;
  box-shadow: none;
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
