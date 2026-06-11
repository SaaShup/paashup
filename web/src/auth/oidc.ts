// Browser-side OIDC (Keycloak) login: Authorization Code + PKCE against a public
// client. Config is discovered at runtime from the backend (`/api/auth/oidc-config/`),
// so no rebuild is needed to point at a different realm. The resulting access token is
// sent as `Authorization: Bearer …` by the API client; static `pb_token` still works.

interface OidcConfig {
  enabled: boolean;
  issuer: string | null;
  client_id: string | null;
  audience: string | null;
}
interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint?: string;
}

const LS = {
  access: 'pb_oidc_access',
  refresh: 'pb_oidc_refresh',
  expires: 'pb_oidc_expires', // epoch ms
  id: 'pb_oidc_id_token',
};
const SS = { verifier: 'pb_oidc_verifier', state: 'pb_oidc_state' };

let configCache: OidcConfig | null = null;
let discoveryCache: Discovery | null = null;

export async function loadOidcConfig(): Promise<OidcConfig> {
  if (configCache) return configCache;
  try {
    const res = await fetch('/api/auth/oidc-config/');
    configCache = (await res.json()) as OidcConfig;
  } catch {
    configCache = { enabled: false, issuer: null, client_id: null, audience: null };
  }
  return configCache;
}

async function discover(issuer: string): Promise<Discovery> {
  if (discoveryCache) return discoveryCache;
  const res = await fetch(`${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`);
  discoveryCache = (await res.json()) as Discovery;
  return discoveryCache;
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
const redirectUri = (): string => `${location.origin}/`;

// ---- token store --------------------------------------------------------------
function store(tok: {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}): void {
  localStorage.setItem(LS.access, tok.access_token);
  if (tok.refresh_token) localStorage.setItem(LS.refresh, tok.refresh_token);
  if (tok.id_token) localStorage.setItem(LS.id, tok.id_token);
  const ttl = (tok.expires_in ?? 300) * 1000;
  localStorage.setItem(LS.expires, String(Date.now() + ttl));
}
function clearTokens(): void {
  for (const k of Object.values(LS)) localStorage.removeItem(k);
}

/** The current access token (sent as Bearer), or null. */
export function getAccessToken(): string | null {
  return localStorage.getItem(LS.access);
}
export function isAuthenticated(): boolean {
  return !!getAccessToken();
}

function decodeJwt(token: string): Record<string, unknown> {
  try {
    const p = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(p)))) as Record<string, unknown>;
  } catch {
    return {};
  }
}
/** Display name for the signed-in user, or null. */
export function currentUsername(): string | null {
  const t = getAccessToken();
  if (!t) return null;
  const c = decodeJwt(t);
  return (c.preferred_username as string) ?? (c.email as string) ?? (c.sub as string) ?? 'user';
}

// ---- flow ---------------------------------------------------------------------
/** Start the login: redirect to Keycloak's authorization endpoint with PKCE. */
export async function login(): Promise<void> {
  const cfg = await loadOidcConfig();
  if (!cfg.enabled || !cfg.issuer || !cfg.client_id) return;
  const d = await discover(cfg.issuer);
  const verifier = randomString();
  const state = randomString(16);
  sessionStorage.setItem(SS.verifier, verifier);
  sessionStorage.setItem(SS.state, state);
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.client_id,
    redirect_uri: redirectUri(),
    scope: 'openid profile email',
    state,
    code_challenge: await challenge(verifier),
    code_challenge_method: 'S256',
  });
  location.assign(`${d.authorization_endpoint}?${q.toString()}`);
}

/**
 * If the URL carries an auth code (post-redirect), exchange it for tokens and clean
 * the URL. Returns true if a sign-in completed. Safe to call on every load.
 */
export async function handleRedirectCallback(): Promise<boolean> {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const state = params.get('state');
  if (!code) return false;
  const cfg = await loadOidcConfig();
  if (!cfg.enabled || !cfg.issuer || !cfg.client_id) return false;
  const verifier = sessionStorage.getItem(SS.verifier);
  const expectedState = sessionStorage.getItem(SS.state);
  // always strip code/state from the URL, even on mismatch
  history.replaceState({}, '', location.pathname);
  if (!verifier || !state || state !== expectedState) return false;
  sessionStorage.removeItem(SS.verifier);
  sessionStorage.removeItem(SS.state);

  const d = await discover(cfg.issuer);
  const res = await fetch(d.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: cfg.client_id,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) return false;
  store(await res.json());
  return true;
}

/** Refresh the access token if it is missing/near expiry. Returns false if signed out. */
export async function ensureValidToken(): Promise<boolean> {
  if (!getAccessToken()) return false;
  const exp = Number(localStorage.getItem(LS.expires) ?? 0);
  if (Date.now() < exp - 30_000) return true; // still valid (30s margin)
  const refresh = localStorage.getItem(LS.refresh);
  const cfg = await loadOidcConfig();
  if (!refresh || !cfg.enabled || !cfg.issuer || !cfg.client_id) {
    clearTokens();
    return false;
  }
  try {
    const d = await discover(cfg.issuer);
    const res = await fetch(d.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refresh,
        client_id: cfg.client_id,
      }),
    });
    if (!res.ok) throw new Error(`refresh ${res.status}`);
    store(await res.json());
    return true;
  } catch {
    clearTokens();
    return false;
  }
}

/** Sign out: clear local tokens and (if available) hit Keycloak's end-session endpoint. */
export async function logout(): Promise<void> {
  const idToken = localStorage.getItem(LS.id);
  clearTokens();
  const cfg = await loadOidcConfig();
  if (cfg.enabled && cfg.issuer) {
    const d = await discover(cfg.issuer).catch(() => null);
    if (d?.end_session_endpoint) {
      const q = new URLSearchParams({ post_logout_redirect_uri: location.origin });
      if (idToken) q.set('id_token_hint', idToken);
      if (cfg.client_id) q.set('client_id', cfg.client_id);
      location.assign(`${d.end_session_endpoint}?${q.toString()}`);
      return;
    }
  }
  location.assign('/');
}

/** Periodically refresh so the Bearer token stays valid while the app is open. */
export function startAutoRefresh(): void {
  setInterval(() => void ensureValidToken(), 60_000);
}
