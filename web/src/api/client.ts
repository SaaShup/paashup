// Thin REST client for the paashup API. Same-origin (Vite proxies /api in dev,
// the API serves the built SPA in prod). Auth: the paashup token in localStorage —
// minted by the SSO login (BFF exchange) or a static API key the user pasted in.
import { getToken, handleUnauthorized } from '../auth/oidc.js';
import { withBase } from '../base.js';

export interface Page<T = Record<string, unknown>> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export type Obj = Record<string, unknown>;

function authHeader(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Token ${token}` } : {};
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(withBase(path), {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...authHeader(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  // Infrastructure in front of the API (e.g. Cloudflare) can return an HTML error page
  // instead of JSON on a 50x; parse defensively so that ends up as a clean ApiError
  // rather than a raw SyntaxError with the HTML body embedded in its message.
  let data: unknown;
  let parseFailed = false;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      parseFailed = true;
    }
  }
  if (!res.ok || parseFailed) {
    // A 403 for anything other than "this key can't write" means our session itself
    // isn't accepted any more (typically: it expired) — drop it so the UI prompts for
    // a fresh login instead of leaving the user looking at a bare error.
    const detail = !parseFailed ? (data as { detail?: unknown } | undefined)?.detail : undefined;
    if (res.status === 403 && detail !== 'This token is read-only.') handleUnauthorized();
    throw new ApiError(res.status, detail ?? `Server error (${res.status})`);
  }
  return data as T;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
  ) {
    super(`API ${status}`);
  }
}

function qs(params?: Record<string, string | number | undefined>): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const api = {
  get: <T = Obj>(path: string) => request<T>('GET', path),
  post: <T = Obj>(path: string, data?: Obj) => request<T>('POST', path, data),
  put: <T = Obj>(path: string, data?: Obj) => request<T>('PUT', path, data),
  list: <T = Obj>(endpoint: string, params?: Record<string, string | number | undefined>) =>
    request<Page<T>>('GET', endpoint + qs(params)),
  retrieve: <T = Obj>(endpoint: string, id: number) => request<T>('GET', `${endpoint}${id}/`),
  create: <T = Obj>(endpoint: string, data: Obj) => request<T>('POST', endpoint, data),
  update: <T = Obj>(endpoint: string, id: number, data: Obj) =>
    request<T>('PATCH', `${endpoint}${id}/`, data),
  remove: (endpoint: string, id: number) => request<void>('DELETE', `${endpoint}${id}/`),
  bulkRemove: (endpoint: string, ids: number[]) =>
    request<void>(
      'DELETE',
      endpoint,
      ids.map((id) => ({ id })),
    ),
  schema: () => request<OpenApiDoc>('GET', '/api/schema/'),
};

export interface OpenApiDoc {
  paths: Record<string, Record<string, { operationId?: string }>>;
  components: { schemas: Record<string, unknown> };
}
