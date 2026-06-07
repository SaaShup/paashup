// Generic "graph" visualization support. Any plugin can expose a
// `GET /api/plugins/<name>/graph/` endpoint returning the GraphData shape below; the
// Visualization view renders it and refreshes live from the WebSocket change-feed.
// Sources are discovered by probing each loaded plugin for that endpoint.
import { api } from './client.js';
import type { Resource } from './resources.js';

export interface GraphGroup {
  id: string;
  label: string;
  kind?: string;
}
export interface GraphNode {
  id: string;
  label: string;
  /** Group (cluster) this node belongs to, referencing a GraphGroup id. */
  group?: string;
  /** Free-form category used only to colour the node. */
  kind?: string;
  sublabel?: string;
  /** Component IP address — used to render link details as firewall rules. */
  ip?: string;
  /** Default listening port for this component (used as DST PORT fallback). */
  port?: number | string;
}
export interface GraphEdge {
  id: string;
  source: string; // GraphNode id (SRC)
  target: string; // GraphNode id (DST)
  label?: string | null;
  directed?: boolean;
  /** True when the edge crosses a group boundary (rendered with emphasis). */
  cross_group?: boolean;
  /** Destination port for this link (overrides the target component's port). */
  port?: number | string;
  /** Transport protocol, e.g. "tcp"/"udp" (shown alongside the rule). */
  protocol?: string;
  /** Firewall action — defaults to "ACCEPT". */
  action?: string;
}
export interface GraphData {
  groups: GraphGroup[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** A discovered, fetchable graph endpoint contributed by a plugin. */
export interface GraphSource {
  /** Plugin name, e.g. "ismanager". */
  name: string;
  /** Display label, e.g. "Ismanager". */
  label: string;
  /** Endpoint URL, e.g. "/api/plugins/ismanager/graph/". */
  url: string;
  /** Physical-table prefix for this plugin's change events, e.g. "plugin_ismanager_". */
  tablePrefix: string;
}

function titleize(slug: string): string {
  return slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Discover plugins (from the resource catalog) that expose a `…/graph/` endpoint, by
 * probing each once. Plugins without one (or that 404) are simply skipped.
 */
export async function discoverGraphs(resources: Resource[]): Promise<GraphSource[]> {
  const names = new Set<string>();
  for (const r of resources) {
    const parts = r.endpoint.split('/').filter(Boolean); // ["api","plugins",<name>,<res>]
    if (parts[0] === 'api' && parts[1] === 'plugins' && parts[2]) names.add(parts[2]);
  }
  const found: GraphSource[] = [];
  await Promise.all(
    [...names].map(async (name) => {
      const url = `/api/plugins/${name}/graph/`;
      try {
        await api.get<GraphData>(url); // 404/!ok throws → skipped
        found.push({ name, label: titleize(name), url, tablePrefix: `plugin_${name}_` });
      } catch {
        /* plugin has no graph endpoint */
      }
    }),
  );
  return found.sort((a, b) => a.label.localeCompare(b.label));
}

export const fetchGraph = (url: string): Promise<GraphData> => api.get<GraphData>(url);
