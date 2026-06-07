<script setup lang="ts">
// Generic graph visualization for any plugin exposing a `…/graph/` endpoint. Renders a
// dependency-free SVG: nodes grouped into columns by their `group` (cluster), edges as
// arrows between nodes (cross-group edges emphasised). Refreshes live from the WebSocket
// change-feed whenever the active plugin's tables change.
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useUiStore } from '../stores/ui.js';
import { fetchGraph, type GraphData, type GraphNode } from '../api/graphs.js';
import { socket } from '../websocket/socket.js';
import { isChange } from '../websocket/events.js';

const ui = useUiStore();
const graph = ref<GraphData>({ groups: [], nodes: [], edges: [] });
const loading = ref(false);
const error = ref<string | null>(null);
const flash = ref(false); // brief highlight when a live update lands

// firewall-rule panel shown when a link (edge) is clicked
const nodeById = computed(() => new Map(graph.value.nodes.map((n) => [n.id, n])));
const selectedId = ref<string | null>(null);
interface FwRule {
  srcLabel: string;
  src: string;
  dstLabel: string;
  dst: string;
  port: string;
  protocol?: string;
  action: string;
}
const selectedRule = ref<FwRule | null>(null);

function selectEdge(id: string): void {
  const e = graph.value.edges.find((x) => x.id === id);
  if (!e) return;
  const s = nodeById.value.get(e.source);
  const t = nodeById.value.get(e.target);
  selectedId.value = id;
  selectedRule.value = {
    srcLabel: s?.label ?? e.source,
    src: String(s?.ip ?? s?.label ?? e.source),
    dstLabel: t?.label ?? e.target,
    dst: String(t?.ip ?? t?.label ?? e.target),
    port: String(e.port ?? t?.port ?? 'any'),
    protocol: e.protocol,
    action: (e.action ?? 'ACCEPT').toUpperCase(),
  };
}
function clearRule(): void {
  selectedId.value = null;
  selectedRule.value = null;
}

let debounce: ReturnType<typeof setTimeout> | undefined;
let unsubscribe: (() => void) | undefined;

async function refresh(): Promise<void> {
  const src = ui.selectedGraph;
  if (!src) return;
  loading.value = true;
  try {
    graph.value = await fetchGraph(src.url);
    error.value = null;
    clearRule(); // selection may be stale after a reload
  } catch {
    error.value = 'Could not load the graph.';
  } finally {
    loading.value = false;
  }
}

function scheduleRefresh(): void {
  clearTimeout(debounce);
  debounce = setTimeout(async () => {
    await refresh();
    flash.value = true;
    setTimeout(() => (flash.value = false), 600);
  }, 200);
}

onMounted(() => {
  void refresh();
  // Live updates: re-fetch when a change event touches the active plugin's tables.
  unsubscribe = socket.on((e) => {
    const prefix = ui.selectedGraph?.tablePrefix;
    if (isChange(e) && prefix && e.table.startsWith(prefix)) scheduleRefresh();
  });
});
onUnmounted(() => {
  unsubscribe?.();
  clearTimeout(debounce);
});
watch(() => ui.selectedGraph, refresh);

// ---- layout (deterministic, no physics) -------------------------------------
const NODE_W = 168;
const NODE_H = 48;
const NODE_GAP = 24;
const COL_GAP = 120;
const MARGIN = 28;
const BOX_TOP = 16;
const HEADER_H = 30;
const NODES_TOP = BOX_TOP + HEADER_H + 12;

const PALETTE: Record<string, string> = {
  app: '#2563eb',
  database: '#7c3aed',
  idp: '#db2777',
  log: '#059669',
  proxy: '#d97706',
  cache: '#0891b2',
  other: '#64748b',
};
function colorFor(kind?: string): string {
  if (!kind) return PALETTE.other!;
  if (PALETTE[kind]) return PALETTE[kind]!;
  let h = 0;
  for (let i = 0; i < kind.length; i++) h = (h * 31 + kind.charCodeAt(i)) % 360;
  return `hsl(${h} 52% 46%)`;
}

interface Pos {
  cx: number;
  cy: number;
  left: number;
  col: number;
}

const layout = computed(() => {
  const g = graph.value;
  // Column order: declared groups first, then an "Ungrouped" column if needed.
  const colIndex = new Map<string, number>();
  const columns: { id: string; label: string; kind?: string }[] = [];
  for (const grp of g.groups) {
    colIndex.set(grp.id, columns.length);
    columns.push({ id: grp.id, label: grp.label, kind: grp.kind });
  }
  const nodesByCol: GraphNode[][] = columns.map(() => []);
  const ungrouped: GraphNode[] = [];
  for (const n of g.nodes) {
    const ci = n.group != null ? colIndex.get(n.group) : undefined;
    if (ci === undefined) ungrouped.push(n);
    else nodesByCol[ci]!.push(n);
  }
  if (ungrouped.length) {
    colIndex.set('__ungrouped__', columns.length);
    columns.push({ id: '__ungrouped__', label: 'Ungrouped' });
    nodesByCol.push(ungrouped);
  }

  const pos = new Map<string, Pos>();
  const boxes: { x: number; y: number; w: number; h: number; label: string; color: string }[] = [];
  const placedNodes: {
    id: string;
    x: number;
    y: number;
    label: string;
    sublabel?: string;
    color: string;
  }[] = [];

  columns.forEach((col, ci) => {
    const left = MARGIN + ci * (NODE_W + COL_GAP);
    const items = nodesByCol[ci]!;
    items.forEach((n, ni) => {
      const top = NODES_TOP + ni * (NODE_H + NODE_GAP);
      pos.set(n.id, { cx: left + NODE_W / 2, cy: top + NODE_H / 2, left, col: ci });
      placedNodes.push({
        id: n.id,
        x: left,
        y: top,
        label: n.label,
        sublabel: n.sublabel,
        color: colorFor(n.kind),
      });
    });
    const h = NODES_TOP - BOX_TOP + Math.max(items.length, 1) * (NODE_H + NODE_GAP) - NODE_GAP + 12;
    boxes.push({
      x: left - 14,
      y: BOX_TOP,
      w: NODE_W + 28,
      h,
      label: col.label,
      color: colorFor(col.kind ?? 'group'),
    });
  });

  // Edges
  const edges: {
    id: string;
    source: string;
    target: string;
    path: string;
    lx: number;
    ly: number;
    label?: string | null;
    cross: boolean;
  }[] = [];
  for (const e of g.edges) {
    const s = pos.get(e.source);
    const t = pos.get(e.target);
    if (!s || !t) continue;
    let path: string;
    let lx: number;
    let ly: number;
    if (s.col === t.col) {
      // same column: bulge out to the right so the line clears the nodes
      const bx = s.left + NODE_W + 46;
      const x0 = s.left + NODE_W;
      const x1 = t.left + NODE_W;
      path = `M ${x0} ${s.cy} C ${bx} ${s.cy}, ${bx} ${t.cy}, ${x1} ${t.cy}`;
      lx = bx;
      ly = (s.cy + t.cy) / 2;
    } else {
      const rightward = t.col > s.col;
      const sx = rightward ? s.left + NODE_W : s.left;
      const tx = rightward ? t.left : t.left + NODE_W;
      const mx = (sx + tx) / 2;
      path = `M ${sx} ${s.cy} C ${mx} ${s.cy}, ${mx} ${t.cy}, ${tx} ${t.cy}`;
      lx = mx;
      ly = (s.cy + t.cy) / 2 - 7;
    }
    edges.push({
      id: e.id,
      source: e.source,
      target: e.target,
      path,
      lx,
      ly,
      label: e.label,
      cross: !!e.cross_group,
    });
  }

  const cols = columns.length || 1;
  const svgW = MARGIN * 2 + cols * NODE_W + (cols - 1) * COL_GAP;
  const svgH = Math.max(...boxes.map((b) => b.y + b.h), 200) + MARGIN;
  return { boxes, nodes: placedNodes, edges, svgW, svgH };
});

const kindsPresent = computed(() => {
  const set = new Set<string>();
  for (const n of graph.value.nodes) if (n.kind) set.add(n.kind);
  return [...set].sort();
});
</script>

<template>
  <section class="viz">
    <header class="viz-head">
      <h2>Visualization</h2>
      <select
        v-if="ui.graphs.length > 1"
        :value="ui.selectedGraph?.name"
        @change="ui.selectGraph(ui.graphs.find((g) => g.name === ($event.target as HTMLSelectElement).value)!)"
      >
        <option v-for="g in ui.graphs" :key="g.name" :value="g.name">{{ g.label }}</option>
      </select>
      <span class="meta">{{ graph.nodes.length }} components · {{ graph.edges.length }} links</span>
      <span class="live" :class="{ flash }">● live</span>
      <span class="spacer" />
      <button class="refresh" :disabled="loading" @click="refresh()">↻ Refresh</button>
    </header>

    <div class="legend">
      <span v-for="k in kindsPresent" :key="k" class="lg">
        <i class="dot" :style="{ background: PALETTE[k] ?? '#888' }" />{{ k }}
      </span>
      <span class="lg"><i class="line cross" />cross-IS link</span>
      <span class="lg"><i class="line" />intra-IS link</span>
      <span class="hint">arrow points consumer → producer</span>
    </div>

    <!-- firewall-rule readout for the clicked link -->
    <div v-if="selectedRule" class="fw-rule">
      <code class="rule">
        <span class="ip">{{ selectedRule.src }}</span>
        <span class="arrow">→</span>
        <span class="ip">{{ selectedRule.dst }}</span><span class="port">:{{ selectedRule.port }}</span>
        <span v-if="selectedRule.protocol" class="proto">/{{ selectedRule.protocol }}</span>
        <span class="eq">=</span>
        <span class="action" :class="selectedRule.action.toLowerCase()">{{ selectedRule.action }}</span>
      </code>
      <span class="who">{{ selectedRule.srcLabel }} → {{ selectedRule.dstLabel }}</span>
      <button class="close" title="Close" @click="clearRule">✕</button>
    </div>

    <div v-if="error" class="empty">{{ error }}</div>
    <div v-else-if="!graph.nodes.length" class="empty">
      No components yet. Add an Information System and components to see the diagram.
    </div>

    <div v-else class="canvas">
      <svg :width="layout.svgW" :height="layout.svgH" :viewBox="`0 0 ${layout.svgW} ${layout.svgH}`">
        <defs>
          <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L9,3 L0,6 Z" fill="var(--muted, #64748b)" />
          </marker>
          <marker id="arrow-x" markerWidth="11" markerHeight="11" refX="9" refY="3.2" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L10,3.2 L0,6.4 Z" fill="var(--primary, #b91c1c)" />
          </marker>
        </defs>

        <!-- group/cluster boxes -->
        <g v-for="b in layout.boxes" :key="b.label">
          <rect :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="10" class="cluster" />
          <rect :x="b.x" :y="b.y" :width="b.w" height="4" rx="2" :fill="b.color" />
          <text :x="b.x + 12" :y="b.y + 21" class="cluster-label">{{ b.label }}</text>
        </g>

        <!-- edges (click a link to see it as a firewall rule) -->
        <g v-for="e in layout.edges" :key="e.id" class="edge-g" @click="selectEdge(e.id)">
          <path :d="e.path" class="edge-hit" />
          <path
            :d="e.path"
            class="edge"
            :class="{ cross: e.cross, sel: selectedId === e.id }"
            :marker-end="e.cross ? 'url(#arrow-x)' : 'url(#arrow)'"
          />
          <text v-if="e.label" :x="e.lx" :y="e.ly" class="edge-label" text-anchor="middle">
            {{ e.label }}
          </text>
        </g>

        <!-- nodes -->
        <g v-for="n in layout.nodes" :key="n.id" class="node">
          <title>{{ n.label }}{{ n.sublabel ? ' — ' + n.sublabel : '' }}</title>
          <rect :x="n.x" :y="n.y" :width="NODE_W" :height="NODE_H" rx="8" class="node-box" />
          <rect :x="n.x" :y="n.y" width="5" :height="NODE_H" rx="2" :fill="n.color" />
          <text :x="n.x + 16" :y="n.y + (n.sublabel ? 20 : 29)" class="node-label">{{ n.label }}</text>
          <text v-if="n.sublabel" :x="n.x + 16" :y="n.y + 37" class="node-sub">{{ n.sublabel }}</text>
        </g>
      </svg>
    </div>
  </section>
</template>

<style scoped>
.viz {
  padding: 16px 20px 40px;
}
.viz-head {
  display: flex;
  align-items: center;
  gap: 14px;
}
.viz-head h2 {
  margin: 0;
  font-size: 18px;
}
.viz-head select {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
}
.meta {
  color: var(--muted, #64748b);
  font-size: 13px;
}
.live {
  font-size: 12px;
  color: #059669;
  transition: opacity 0.3s;
}
.live.flash {
  opacity: 0.25;
}
.spacer {
  flex: 1;
}
.refresh {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: center;
  margin: 10px 0 14px;
  font-size: 12px;
  color: var(--muted, #64748b);
}
.legend .lg {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.legend .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
.legend .line {
  width: 18px;
  height: 0;
  border-top: 2px solid var(--muted, #94a3b8);
  display: inline-block;
}
.legend .line.cross {
  border-top: 2px solid var(--primary, #b91c1c);
}
.legend .hint {
  font-style: italic;
  opacity: 0.8;
}
.empty {
  padding: 40px;
  text-align: center;
  color: var(--muted, #64748b);
  border: 1px dashed var(--border);
  border-radius: 10px;
}
.canvas {
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  background:
    radial-gradient(circle, rgba(0, 0, 0, 0.05) 1px, transparent 1px) 0 0 / 22px 22px,
    var(--surface);
}
.cluster {
  fill: rgba(100, 116, 139, 0.06);
  stroke: var(--border);
  stroke-width: 1;
}
.cluster-label {
  font-size: 13px;
  font-weight: 700;
  fill: var(--text, #1e293b);
}
.node-box {
  fill: var(--surface, #fff);
  stroke: var(--border);
  stroke-width: 1;
}
.node-label {
  font-size: 13px;
  font-weight: 600;
  fill: var(--text, #1e293b);
}
.node-sub {
  font-size: 11px;
  fill: var(--muted, #64748b);
}
.edge-g {
  cursor: pointer;
}
.edge-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 14;
}
.edge {
  fill: none;
  stroke: var(--muted, #94a3b8);
  stroke-width: 1.5;
}
.edge.cross {
  stroke: var(--primary, #b91c1c);
  stroke-width: 2;
}
.edge-g:hover .edge {
  stroke: var(--primary-d, #0284c7);
}
.edge.sel {
  stroke: var(--primary-d, #0284c7);
  stroke-width: 3;
}
.fw-rule {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin: 4px 0 14px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-left: 4px solid var(--primary);
  border-radius: 8px;
  background: var(--surface);
}
.fw-rule .rule {
  font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.fw-rule .ip {
  font-weight: 700;
  color: var(--text, #0f172a);
}
.fw-rule .arrow {
  color: var(--muted, #64748b);
}
.fw-rule .port {
  color: var(--primary-d, #0284c7);
  font-weight: 700;
}
.fw-rule .proto {
  color: var(--muted, #64748b);
  text-transform: uppercase;
}
.fw-rule .eq {
  color: var(--muted, #64748b);
  margin: 0 2px;
}
.fw-rule .action {
  font-weight: 800;
  letter-spacing: 0.04em;
  padding: 1px 8px;
  border-radius: 5px;
}
.fw-rule .action.accept {
  color: #fff;
  background: #16a34a;
}
.fw-rule .action.deny,
.fw-rule .action.drop,
.fw-rule .action.reject {
  color: #fff;
  background: #dc2626;
}
.fw-rule .who {
  color: var(--muted, #64748b);
  font-size: 12.5px;
}
.fw-rule .close {
  margin-left: auto;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--muted, #64748b);
  font-size: 14px;
}
.edge-label {
  font-size: 10.5px;
  fill: var(--muted, #475569);
  paint-order: stroke;
  stroke: var(--surface, #fff);
  stroke-width: 3px;
}
</style>
