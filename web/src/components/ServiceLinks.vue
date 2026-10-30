<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api, ApiError } from '../api/client.js';
import { confirmDialog } from '../composables/confirm.js';

interface ServiceLink {
  id: number;
  key: string;
  label: string;
  override_url: string | null;
  icon_url: string | null;
  auto_icon_url: string | null;
  pinned: boolean;
}

const ENDPOINT = '/api/extras/service-links/';

const links = ref<ServiceLink[]>([]);
const loading = ref(false);
const error = ref('');

const editingId = ref<number | null>(null);
const editLabel = ref('');
const editUrl = ref('');
const editIcon = ref('');
const editAttempted = ref(false);

const adding = ref(false);
const newLabel = ref('');
const newUrl = ref('');
const newIcon = ref('');
const addAttempted = ref(false);

/** `key` is just an internal unique id for the row (how a re-sync recognizes an
 *  already-known service); derived from the label so nobody has to pick one. */
function slugify(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `link-${Date.now()}`
  );
}

function effectiveUrl(l: ServiceLink): string | null {
  return l.override_url || null;
}
function effectiveIcon(l: ServiceLink): string | null {
  // An admin-set icon, or the one the backend resolved by fetching the page and
  // reading its <link rel="icon"> (see resolveFaviconUrl) — no client-side
  // /favicon.ico guessing, since most self-hosted services don't serve one there and
  // it just produces a wrong/broken image flash before the real icon loads.
  return l.icon_url || l.auto_icon_url || null;
}
function onIconError(e: Event): void {
  (e.target as HTMLImageElement).style.visibility = 'hidden';
}
/** A link with a URL but no manual icon only gets its favicon the next time the
 *  backend resolves it — kick that off right after it gets a URL, instead of making
 *  the admin wait for the next server restart. Fire-and-forget on purpose: the lookup
 *  fetches the page itself and can take a few seconds, so the card shows up right away
 *  (with the client-side /favicon.ico guess meanwhile) and the real icon fills in once
 *  this resolves, rather than making the admin stare at the form until it's done. */
function requestIconRefresh(url: string | null, icon: string | null): void {
  if (!url || icon) return;
  api
    .post(`${ENDPOINT}refresh-icons/`)
    .then(() => load())
    .catch(() => {
      /* best-effort */
    });
}
function errText(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    const d = e.detail as { detail?: string } | string | undefined;
    return typeof d === 'string' ? d : (d?.detail ?? JSON.stringify(d));
  }
  return fallback;
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const page = await api.list<ServiceLink>(ENDPOINT, { limit: 100 });
    links.value = page.results
      .filter((l) => l.pinned)
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch (e) {
    error.value = errText(e, 'Failed to load services.');
  } finally {
    loading.value = false;
  }
}

/** On page load, any link that has a URL but neither a manual nor a resolved icon
 *  hasn't had its real <link rel="icon"> looked up yet (e.g. it was added before the
 *  server last restarted, or a previous lookup failed) — ask the backend to try again
 *  rather than leaving it to the client-side /favicon.ico guess forever. Runs once. */
async function ensureIconsResolved() {
  const missing = links.value.some((l) => l.override_url && !l.icon_url && !l.auto_icon_url);
  if (!missing) return;
  try {
    await api.post(`${ENDPOINT}refresh-icons/`);
    await load();
  } catch {
    /* best-effort */
  }
}

function startEdit(l: ServiceLink) {
  editingId.value = l.id;
  editLabel.value = l.label;
  editUrl.value = l.override_url ?? '';
  editIcon.value = l.icon_url ?? '';
  editAttempted.value = false;
}
function cancelEdit() {
  editingId.value = null;
}
async function saveEdit(l: ServiceLink) {
  editAttempted.value = true;
  if (!editLabel.value.trim() || !editUrl.value.trim()) return;
  try {
    const url = editUrl.value.trim() || null;
    const icon = editIcon.value.trim() || null;
    await api.update(ENDPOINT, l.id, {
      label: editLabel.value.trim(),
      override_url: url,
      icon_url: icon,
    });
    editingId.value = null;
    await load();
    requestIconRefresh(url, icon);
  } catch (e) {
    error.value = errText(e, 'Could not save.');
  }
}

async function unpin(l: ServiceLink) {
  const ok = await confirmDialog({
    title: 'Remove service link',
    message: `Remove "${l.label}"? This can't be undone.`,
    confirmLabel: 'Remove',
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await api.remove(ENDPOINT, l.id);
    await load();
  } catch (e) {
    error.value = errText(e, 'Could not remove.');
  }
}

async function addCustom() {
  addAttempted.value = true;
  if (!newLabel.value.trim() || !newUrl.value.trim()) return;
  try {
    const url = newUrl.value.trim() || null;
    const icon = newIcon.value.trim() || null;
    await api.create(ENDPOINT, {
      key: slugify(newLabel.value),
      label: newLabel.value.trim(),
      override_url: url,
      icon_url: icon,
    });
    newLabel.value = '';
    newUrl.value = '';
    newIcon.value = '';
    adding.value = false;
    await load();
    requestIconRefresh(url, icon);
  } catch (e) {
    error.value = errText(e, 'Could not add the link.');
  }
}

onMounted(async () => {
  await load();
  await ensureIconsResolved();
});
</script>

<template>
  <div class="services">
    <div class="services-head">
      <h3>Quick links</h3>
      <div class="services-actions">
        <button
          class="refresh"
          @click="
            adding = !adding;
            addAttempted = false;
          "
        >
          + Add link
        </button>
      </div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <form v-if="adding" class="add-form" @submit.prevent="addCustom">
      <input
        v-model="newLabel"
        placeholder="Link name, ex Saashup"
        :class="{ invalid: addAttempted && !newLabel.trim() }"
      />
      <input
        v-model="newUrl"
        placeholder="https://saashup.com"
        :class="{ invalid: addAttempted && !newUrl.trim() }"
      />
      <input v-model="newIcon" placeholder="Icon url (optional)" />
      <button type="submit">Save</button>
      <button type="button" class="ghost" @click="adding = false">Cancel</button>
    </form>

    <div class="link-grid">
      <div
        v-for="l in links"
        :key="l.id"
        class="link-card"
        :class="{ editing: editingId === l.id }"
      >
        <template v-if="editingId === l.id">
          <input
            v-model="editLabel"
            placeholder="Link name, ex Saashup"
            :class="{ invalid: editAttempted && !editLabel.trim() }"
          />
          <input
            v-model="editUrl"
            placeholder="https://saashup.com"
            :class="{ invalid: editAttempted && !editUrl.trim() }"
          />
          <input v-model="editIcon" placeholder="Icon url (optional)" />
          <div class="edit-actions">
            <button @click="saveEdit(l)">Save</button>
            <button class="ghost" @click="cancelEdit">Cancel</button>
          </div>
        </template>
        <template v-else>
          <a
            v-if="effectiveUrl(l)"
            :href="effectiveUrl(l)!"
            target="_blank"
            rel="noopener"
            class="link-main"
          >
            <img
              v-if="effectiveIcon(l)"
              :src="effectiveIcon(l)!"
              alt=""
              class="link-icon"
              @error="onIconError"
            />
            <span class="link-label">{{ l.label }}</span>
          </a>
          <div v-else class="link-main muted">
            <span class="link-label">{{ l.label }}</span>
            <span class="no-url">no URL yet</span>
          </div>
          <div class="link-tools">
            <button class="icon-btn" title="Edit URL / icon" @click="startEdit(l)">✎</button>
            <button class="icon-btn" title="Remove" @click="unpin(l)">×</button>
          </div>
        </template>
      </div>
      <p v-if="!links.length && !loading" class="muted empty-state">
        No pinned services yet — add one with "+ Add link".
      </p>
    </div>
  </div>
</template>

<style scoped>
.services {
  margin-top: 26px;
}
.services-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.services-head h3 {
  margin: 0;
}
.services-actions {
  display: flex;
  gap: 8px;
}
.refresh {
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text);
  border-radius: 999px;
  padding: 5px 12px;
  cursor: pointer;
  font-size: 0.82rem;
}
.refresh:hover {
  background: var(--surface);
}
.error {
  color: #b42318;
  font-size: 0.85rem;
}
.add-form input.invalid,
.link-card input.invalid {
  border-color: #b42318;
  background: #fef2f2;
}
.add-form {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 10px 0;
}
.add-form input {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 0.85rem;
}
.add-form button {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
  background: var(--primary);
  color: #fff;
  font-size: 0.85rem;
}
.add-form button.ghost {
  background: #fff;
  color: var(--text);
}
.link-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
  margin: 12px 0 8px;
}
.link-card {
  position: relative;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 10px 10px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.link-card.editing {
  grid-column: span 2;
  align-items: stretch;
}
.link-card input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 0.8rem;
}
.empty-state {
  grid-column: 1 / -1;
}
.edit-actions {
  display: flex;
  gap: 6px;
}
.edit-actions button {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 10px;
  cursor: pointer;
  font-size: 0.78rem;
}
.link-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: inherit;
  text-align: center;
}
.link-main.muted {
  color: var(--muted);
}
.link-icon {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  flex: none;
  object-fit: contain;
}
.link-label {
  font-weight: 600;
  font-size: 0.85rem;
}
.no-url {
  font-size: 0.74rem;
  color: var(--muted);
}
.link-tools {
  display: flex;
  gap: 6px;
}
.icon-btn {
  border: none;
  background: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 0.85rem;
  padding: 2px 4px;
}
.icon-btn:hover {
  color: var(--text);
}
.muted {
  color: var(--muted);
  font-size: 0.85rem;
}
</style>
