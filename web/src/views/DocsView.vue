<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { marked } from 'marked';
import { docs } from '../docs/index.js';

const search = ref('');
const current = ref(docs[0]!.id);

/** Docs whose title or body (source Markdown, so headings/prose/code all count) matches
 *  the query — the whole corpus is small (< 1000 lines total), so a client-side scan of
 *  every page on each keystroke is cheap; no need for an index or a server round-trip. */
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return docs;
  return docs.filter((d) => d.title.toLowerCase().includes(q) || d.body.toLowerCase().includes(q));
});

// the selected page falling out of the filtered list (search narrowed it away) jumps to
// the first remaining match, so the article shown always matches what's in the sidebar
watch(filtered, (list) => {
  if (list.length && !list.some((d) => d.id === current.value)) current.value = list[0]!.id;
});

const page = computed(() => docs.find((d) => d.id === current.value) ?? docs[0]!);

/** Wraps matches of the search query in `<mark>`, but only inside text content — never
 *  inside a tag (so it can't land in an href/attribute and break the markup). */
function highlight(html: string, query: string): string {
  const q = query.trim();
  if (!q) return html;
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return html.replace(/(<[^>]+>)|([^<]+)/g, (_m, tag: string, text: string) =>
    tag ? tag : text.replace(re, '<mark>$&</mark>'),
  );
}

const html = computed(() => {
  const rendered = marked.parse(page.value.body, { async: false }) as string;
  return highlight(rendered, search.value);
});
</script>

<template>
  <div class="docs">
    <nav class="toc">
      <div class="toc-title">Documentation</div>
      <input class="toc-search" type="search" v-model="search" placeholder="Search docs…" />
      <p v-if="!filtered.length" class="toc-empty muted">No matching page.</p>
      <button
        v-for="d in filtered"
        :key="d.id"
        class="toc-item"
        :class="{ active: d.id === current }"
        @click="current = d.id"
      >
        {{ d.title }}
      </button>
    </nav>
    <article class="md card" v-html="html" />
  </div>
</template>

<style scoped>
.docs {
  display: flex;
  gap: 22px;
  align-items: flex-start;
}
.toc {
  flex: 0 0 200px;
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.toc-title {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--muted);
  text-transform: uppercase;
  padding: 6px 10px;
}
.toc-search {
  margin: 0 6px 6px;
  font-size: 0.85rem;
}
.toc-empty {
  padding: 4px 10px;
  font-size: 0.82rem;
}
.toc-item {
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text);
  padding: 7px 12px;
  border-radius: 6px;
  font-size: 0.9rem;
}
.toc-item:hover {
  background: var(--surface-2);
}
.toc-item.active {
  background: var(--primary);
  color: #fff;
}
.md {
  flex: 1;
  min-width: 0;
  padding: 8px 30px 30px;
  max-width: 820px;
}
/* narrow screens: stack the table-of-contents above the content */
@media (max-width: 768px) {
  .docs {
    flex-direction: column;
  }
  .toc {
    flex: 0 0 auto;
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 4px;
  }
  .md {
    padding: 8px 0 24px;
    max-width: none;
  }
}
</style>

<style>
/* markdown content (unscoped so it styles v-html output) */
.md h1 {
  font-size: 1.7rem;
  border-bottom: 2px solid var(--surface-2);
  padding-bottom: 8px;
  margin-top: 22px;
}
.md h2 {
  font-size: 1.25rem;
  margin-top: 26px;
  color: var(--primary-d);
}
.md h3 {
  font-size: 1.02rem;
  margin-top: 18px;
}
.md p,
.md li {
  line-height: 1.65;
}
.md a {
  color: var(--primary-d);
}
.md code {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 0.85em;
}
.md pre {
  background: #0f172a;
  color: #e2e8f0;
  padding: 14px 16px;
  border-radius: 8px;
  overflow-x: auto;
}
.md pre code {
  background: none;
  border: none;
  color: inherit;
  padding: 0;
}
.md table {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
  font-size: 0.9rem;
}
.md th,
.md td {
  border: 1px solid var(--border);
  padding: 7px 10px;
  text-align: left;
}
.md th {
  background: var(--surface);
}
.md blockquote {
  border-left: 3px solid var(--secondary);
  margin: 12px 0;
  padding: 4px 14px;
  color: var(--muted);
  background: var(--surface);
  border-radius: 0 6px 6px 0;
}
.md mark {
  background: #fef9c3;
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
}
</style>
