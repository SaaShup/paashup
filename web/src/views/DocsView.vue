<script setup lang="ts">
import { ref, computed } from 'vue';
import { marked } from 'marked';
import { docs } from '../docs/index.js';

const current = ref(docs[0]!.id);
const page = computed(() => docs.find((d) => d.id === current.value) ?? docs[0]!);
const html = computed(() => marked.parse(page.value.body, { async: false }) as string);
</script>

<template>
  <div class="docs">
    <nav class="toc">
      <div class="toc-title">Documentation</div>
      <button
        v-for="d in docs"
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
</style>
