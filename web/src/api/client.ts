// Thin REST client for the paas2box API. Same-origin (Vite proxies /api in dev,
// the API serves the built SPA in prod). Auth: the paas2box token in localStorage —
// minted by the SSO login (BFF exchange) or a static API key the user pasted in.
import { getToken } from '../auth/oidc.js';

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
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...authHeader(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, data);
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
  list: <T = Obj>(endpoint: string, params?: Record<string, string | number | undefined>) =>
    request<Page<T>>('GET', endpoint + qs(params)),
  retrieve: <T = Obj>(endpoint: string, id: number) => request<T>('GET', `${endpoint}${id}/`),
  create: <T = Obj>(endpoint: string, data: Obj) => request<T>('POST', endpoint, data),
  update: <T = Obj>(endpoint: string, id: number, data: Obj) =>
    request<T>('PATCH', `${endpoint}${id}/`, data),
  remove: (endpoint: string, id: number) => request<void>('DELETE', `${endpoint}${id}/`),
  schema: () => request<OpenApiDoc>('GET', '/api/schema/'),
};

export interface OpenApiDoc {
  paths: Record<string, Record<string, { operationId?: string }>>;
  components: { schemas: Record<string, unknown> };
}
