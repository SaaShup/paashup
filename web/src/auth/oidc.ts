// Browser-side OIDC login via a Backend-for-Frontend. The SPA only does the PKCE
// redirect and receives an authorization `code`; it posts that to the backend
// (`/api/auth/oidc/exchange/`), which holds any client secret, verifies the id_token,
// applies authorization, and returns a **paas2box token**. The SPA stores that token
// (as the existing `pb_token`) and uses it for every API/WS call — so it never touches
// provider secrets or provider tokens, and works for any provider (Keycloak, Google, …).
import { withBase } from '../base.js';

export interface Provider {
  id: string;
  label: string;
  kind: string;
  issuer: string;
  client_id: string;
  scopes: string;
  authorization_endpoint: string | null;
}
interface ProvidersResponse {
  login_required: boolean;
  providers: Provider[];
}

const LS = {
  token: 'pb_token', // paas2box token (also used by the REST client + WS)
  username: 'pb_username',
  tokenId: 'pb_token_id',
  expires: 'pb_token_expires', // ISO string
};
const SS = { verifier: 'pb_oidc_verifier', state: 'pb_oidc_state', provider: 'pb_oidc_provider' };

let cache: ProvidersResponse | null = null;

export async function loadProviders(): Promise<ProvidersResponse> {
  if (cache) return cache;
  try {
    cache = (await (await fetch(withBase('/api/auth/providers/'))).json()) as ProvidersResponse;
  } catch {
    cache = { login_required: false, providers: [] };
  }
  return cache;
}

/** Back-compat shape used by App.vue's gating. */
export async function loadOidcConfig(): Promise<{ enabled: boolean; login_required: boolean }> {
  const r = await loadProviders();
  return { enabled: r.providers.length > 0, login_required: r.login_required };
}

// ---- PKCE helpers -------------------------------------------------------------
function randomString(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return base64url(a);
}
function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}
const redirectUri = (): string => `${location.origin}${withBase('/')}`;

// ---- token store --------------------------------------------------------------
export function getToken(): string | null {
  return localStorage.getItem(LS.token);
}
function clearTokens(): void {
  for (const k of Object.values(LS)) localStorage.removeItem(k);
}
export function isAuthenticated(): boolean {
  const exp = localStorage.getItem(LS.expires);
  if (exp && Date.parse(exp) < Date.now()) {
    clearTokens();
    return false;
  }
  return !!getToken();
}
export function currentUsername(): string | null {
  return localStorage.getItem(LS.username) || null;
}

// ---- flow ---------------------------------------------------------------------
/** Start login: PKCE redirect to a provider's authorization endpoint. */
export async function login(providerId?: string): Promise<void> {
  const { providers } = await loadProviders();
  const p = (providerId && providers.find((x) => x.id === providerId)) || providers[0];
  if (!p || !p.authorization_endpoint) return;
  const verifier = randomString();
  const state = randomString(16);
  sessionStorage.setItem(SS.verifier, verifier);
  sessionStorage.setItem(SS.state, state);
  sessionStorage.setItem(SS.provider, p.id);
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: p.client_id,
    redirect_uri: redirectUri(),
    scope: p.scopes || 'openid profile email',
    state,
    code_challenge: await challenge(verifier),
    code_challenge_method: 'S256',
  });
  location.assign(`${p.authorization_endpoint}?${q.toString()}`);
}

/**
 * If the URL carries an auth code (post-redirect), hand it to the backend to exchange
 * for a paas2box token, store it, and clean the URL. Returns true if sign-in completed.
 */
export async function handleRedirectCallback(): Promise<boolean> {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const state = params.get('state');
  if (!code) return false;
  const verifier = sessionStorage.getItem(SS.verifier);
  const expectedState = sessionStorage.getItem(SS.state);
  const provider = sessionStorage.getItem(SS.provider);
  history.replaceState({}, '', location.pathname); // strip code/state regardless
  if (!verifier || !state || state !== expectedState || !provider) return false;
  sessionStorage.removeItem(SS.verifier);
  sessionStorage.removeItem(SS.state);
  sessionStorage.removeItem(SS.provider);

  const res = await fetch(withBase('/api/auth/oidc/exchange/'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, code, code_verifier: verifier, redirect_uri: redirectUri() }),
  });
  if (!res.ok) return false;
  const d = (await res.json()) as {
    token: string;
    token_id?: number;
    username?: string;
    expires?: string;
  };
  localStorage.setItem(LS.token, d.token);
  if (d.username) localStorage.setItem(LS.username, d.username);
  if (d.token_id != null) localStorage.setItem(LS.tokenId, String(d.token_id));
  if (d.expires) localStorage.setItem(LS.expires, d.expires);
  return true;
}

/** Validate the stored session locally; clears it (→ false) when expired. */
export async function ensureValidToken(): Promise<boolean> {
  return isAuthenticated();
}

/**
 * Establish the HttpOnly browser-session cookie from the stored token, so a logged-in
 * user can open API URLs directly in the browser (links/address bar) without a 403
 * (issue #36). SSO login already sets it server-side on exchange; this also covers
 * sessions that predate the cookie. Best-effort.
 */
export async function establishSession(): Promise<void> {
  const token = getToken();
  if (!token) return;
  try {
    await fetch(withBase('/api/auth/session/'), {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
    });
  } catch {
    /* best-effort */
  }
}

/** Sign out: revoke the paas2box token + clear the session cookie (best-effort), then local state. */
export async function logout(): Promise<void> {
  const id = localStorage.getItem(LS.tokenId);
  const token = getToken();
  if (id && token) {
    try {
      await fetch(withBase(`/api/users/tokens/${id}/`), {
        method: 'DELETE',
        headers: { Authorization: `Token ${token}` },
      });
    } catch {
      /* best-effort */
    }
  }
  try {
    await fetch(withBase('/api/auth/logout/'), { method: 'POST' }); // clear the browser-session cookie
  } catch {
    /* best-effort */
  }
  clearTokens();
  location.assign(withBase('/'));
}

/** Periodically drop the session once it expires, so the UI returns to the login gate. */
export function startAutoRefresh(): void {
  void establishSession(); // ensure the browser-session cookie exists for direct API URLs
  setInterval(() => void isAuthenticated(), 60_000);
}
