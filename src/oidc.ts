// Multi-provider OIDC support. paashup can sign users in via several OIDC providers
// at once (e.g. Keycloak + Google). Because providers differ in ways the OIDC spec
// leaves open — access tokens may be JWTs (Keycloak) or opaque (Google), browser
// clients may be public+PKCE (Keycloak) or confidential (Google), and authorization is
// provider-specific (Keycloak roles vs Google email/domain) — the *code→token exchange*
// is done server-side (a Backend-for-Frontend). The backend verifies the **id_token**
// (always a JWT, the one portable token), normalizes authorization, and the caller mints
// a paashup token. The SPA never holds a client secret or a provider token.
//
// Config (per provider id listed in PB_OIDC_PROVIDERS, e.g. "keycloak,google"):
//   PB_OIDC_<ID>_ISSUER          discovery base (required)
//   PB_OIDC_<ID>_CLIENT_ID       (required)
//   PB_OIDC_<ID>_CLIENT_SECRET   for confidential providers (Google)
//   PB_OIDC_<ID>_KIND            "oidc" | "google" (inferred from the issuer if omitted)
//   PB_OIDC_<ID>_LABEL           button label
//   PB_OIDC_<ID>_AUDIENCE        id_token aud to require (defaults to CLIENT_ID)
//   PB_OIDC_<ID>_USERNAME_CLAIM  (oidc) default preferred_username
//   PB_OIDC_<ID>_WRITE_ROLE      (oidc) realm/client role granting write
//   PB_OIDC_<ID>_ALLOWED_DOMAINS (google) comma list; who may sign in at all
//   PB_OIDC_<ID>_WRITE_EMAILS    (google) comma list; who gets write
// A legacy single provider (PB_OIDC_ISSUER/CLIENT_ID/…) is still honored as one provider.
import crypto from 'node:crypto';

const LEEWAY_S = 60; // clock-skew tolerance
const JWKS_TTL_MS = 5 * 60 * 1000;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

export type OidcClaims = Record<string, unknown>;

export interface OidcProvider {
  id: string;
  label: string;
  kind: 'oidc' | 'google';
  issuer: string;
  clientId: string;
  clientSecret?: string;
  audience?: string; // id_token aud to require (defaults to clientId)
  scopes: string;
  usernameClaim: string;
  writeRole?: string; // oidc authz
  allowedDomains?: string[]; // google: login gate
  writeEmails?: string[]; // google: write gate
}

interface Jwk {
  kty?: string;
  kid?: string;
  [k: string]: unknown;
}
interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const csv = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

// ---- provider registry (parsed from env on demand; cheap, reflects live config) -----
function envProvider(id: string): OidcProvider | null {
  const P = `PB_OIDC_${id.toUpperCase()}_`;
  const issuer = process.env[`${P}ISSUER`]?.replace(/\/+$/, '');
  const clientId = process.env[`${P}CLIENT_ID`];
  if (!issuer || !clientId) return null;
  const kind =
    (process.env[`${P}KIND`] as 'oidc' | 'google') ||
    (/accounts\.google\.com/.test(issuer) ? 'google' : 'oidc');
  return {
    id,
    kind,
    label:
      process.env[`${P}LABEL`] ||
      (kind === 'google' ? 'Google' : id.charAt(0).toUpperCase() + id.slice(1)),
    issuer,
    clientId,
    clientSecret: process.env[`${P}CLIENT_SECRET`] || undefined,
    audience: process.env[`${P}AUDIENCE`] || undefined,
    scopes: process.env[`${P}SCOPES`] || 'openid profile email',
    usernameClaim:
      process.env[`${P}USERNAME_CLAIM`] || (kind === 'google' ? 'email' : 'preferred_username'),
    writeRole: process.env[`${P}WRITE_ROLE`] || undefined,
    allowedDomains: csv(process.env[`${P}ALLOWED_DOMAINS`]),
    writeEmails: csv(process.env[`${P}WRITE_EMAILS`]),
  };
}

function legacyProvider(): OidcProvider | null {
  const issuer = process.env.PB_OIDC_ISSUER?.replace(/\/+$/, '');
  if (!issuer) return null;
  const kind = /accounts\.google\.com/.test(issuer) ? 'google' : 'oidc';
  return {
    id: 'oidc',
    label: kind === 'google' ? 'Google' : 'SSO',
    kind,
    issuer,
    clientId: process.env.PB_OIDC_CLIENT_ID || '',
    clientSecret: process.env.PB_OIDC_CLIENT_SECRET || undefined,
    audience: process.env.PB_OIDC_AUDIENCE || undefined,
    scopes: 'openid profile email',
    usernameClaim: process.env.PB_OIDC_USERNAME_CLAIM || 'preferred_username',
    writeRole: process.env.PB_OIDC_WRITE_ROLE || undefined,
    allowedDomains: csv(process.env.PB_OIDC_ALLOWED_DOMAINS),
    writeEmails: csv(process.env.PB_OIDC_WRITE_EMAILS),
  };
}

/** All configured providers (PB_OIDC_PROVIDERS list, or the legacy single provider). */
export function listProviders(): OidcProvider[] {
  const ids = (process.env.PB_OIDC_PROVIDERS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length) return ids.map(envProvider).filter((p): p is OidcProvider => p !== null);
  const legacy = legacyProvider();
  return legacy ? [legacy] : [];
}
export function getProvider(id: string): OidcProvider | undefined {
  return listProviders().find((p) => p.id === id);
}
export function oidcEnabled(): boolean {
  return listProviders().length > 0;
}

// ---- discovery + JWKS (cached per issuer) -------------------------------------------
const discoveryCache = new Map<string, { doc: Discovery; at: number }>();
const jwksCache = new Map<string, { keys: Map<string, crypto.KeyObject>; at: number }>();

function b64urlJson(seg: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8')) as Record<string, unknown>;
}
async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function discover(issuer: string): Promise<Discovery> {
  const key = issuer.replace(/\/+$/, '');
  const now = Date.now();
  const c = discoveryCache.get(key);
  if (c && now - c.at < DISCOVERY_TTL_MS) return c.doc;
  const d = await fetchJson(`${key}/.well-known/openid-configuration`);
  const doc: Discovery = {
    authorization_endpoint: str(d.authorization_endpoint),
    token_endpoint: str(d.token_endpoint),
    jwks_uri: str(d.jwks_uri),
    end_session_endpoint:
      typeof d.end_session_endpoint === 'string' ? d.end_session_endpoint : undefined,
  };
  discoveryCache.set(key, { doc, at: now });
  return doc;
}

async function loadKeys(issuer: string, force: boolean): Promise<Map<string, crypto.KeyObject>> {
  const key = issuer.replace(/\/+$/, '');
  const now = Date.now();
  const c = jwksCache.get(key);
  if (!force && c && now - c.at < JWKS_TTL_MS) return c.keys;
  const jwksUri = (await discover(key)).jwks_uri;
  if (!jwksUri) throw new Error('OIDC discovery: missing jwks_uri');
  const doc = await fetchJson(jwksUri);
  const keys = new Map<string, crypto.KeyObject>();
  for (const jwk of (doc.keys as Jwk[] | undefined) ?? []) {
    if (jwk.kty !== 'RSA' || typeof jwk.kid !== 'string') continue; // RS256 only
    try {
      keys.set(jwk.kid, crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: 'jwk' }));
    } catch {
      /* skip unusable key */
    }
  }
  jwksCache.set(key, { keys, at: now });
  return keys;
}

/** Verify an RS256 JWT against an issuer's JWKS. `requireAud` enforces aud/azp if given. */
async function verifyJwt(
  issuer: string,
  token: string,
  requireAud?: string,
): Promise<OidcClaims | null> {
  const iss = issuer.replace(/\/+$/, '');
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = b64urlJson(parts[0]!);
    claims = b64urlJson(parts[1]!);
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;

  let keys = await loadKeys(iss, false).catch(() => null);
  let key = keys?.get(header.kid);
  if (!key) {
    keys = await loadKeys(iss, true).catch(() => null); // key rotation: refetch once
    key = keys?.get(header.kid);
  }
  if (!key) return null;

  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  const sig = Buffer.from(parts[2]!, 'base64url');
  try {
    if (!crypto.verify('RSA-SHA256', signed, key, sig)) return null;
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (str(claims.iss).replace(/\/+$/, '') !== iss) return null;
  if (typeof claims.exp === 'number' && now > claims.exp + LEEWAY_S) return null;
  if (typeof claims.nbf === 'number' && now + LEEWAY_S < claims.nbf) return null;
  if (requireAud) {
    const aud = Array.isArray(claims.aud)
      ? (claims.aud as unknown[]).map(String)
      : claims.aud
        ? [String(claims.aud)]
        : [];
    if (!aud.includes(requireAud) && claims.azp !== requireAud) return null;
  }
  return claims;
}

/**
 * Verify a Bearer JWT (machine-to-machine: e.g. a Keycloak service-account access
 * token). The provider is selected by the token's `iss`. Returns the claims + provider.
 */
export async function verifyBearer(
  token: string,
): Promise<{ claims: OidcClaims; provider: OidcProvider } | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null; // opaque tokens (e.g. Google access tokens) aren't JWTs
  let payload: Record<string, unknown>;
  try {
    payload = b64urlJson(parts[1]!);
  } catch {
    return null;
  }
  const iss = str(payload.iss).replace(/\/+$/, '');
  if (!iss) return null;
  const provider = listProviders().find((p) => p.issuer === iss);
  if (!provider) return null;
  const claims = await verifyJwt(provider.issuer, token, provider.audience);
  return claims ? { claims, provider } : null;
}

/** Collect realm + client roles from a Keycloak token's claims. */
export function rolesFromClaims(claims: OidcClaims): string[] {
  const out: string[] = [];
  const realm = claims.realm_access as { roles?: unknown } | undefined;
  if (realm && Array.isArray(realm.roles)) out.push(...realm.roles.map(String));
  const res = claims.resource_access as Record<string, { roles?: unknown }> | undefined;
  if (res && typeof res === 'object') {
    for (const v of Object.values(res)) {
      if (v && Array.isArray(v.roles)) out.push(...v.roles.map(String));
    }
  }
  return out;
}

export interface SsoIdentity {
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  writeEnabled: boolean;
}

/**
 * Map verified token claims to a local identity + write permission, per provider kind.
 * Returns `{ error }` when the identity isn't permitted to sign in at all.
 *   - google: must have a verified email in an allowed domain; write via the email list.
 *   - oidc:   any realm user; write via the configured role (or all, if no role set).
 */
export function authorizeIdentity(
  p: OidcProvider,
  idClaims: OidcClaims,
  accessClaims?: OidcClaims,
): SsoIdentity | { error: string } {
  if (p.kind === 'google') {
    const email = str(idClaims.email).toLowerCase();
    if (!email || idClaims.email_verified !== true) {
      return { error: 'Google account has no verified email' };
    }
    const domain = email.split('@')[1] ?? '';
    if (!p.allowedDomains?.length) {
      return { error: 'No allowed domains configured for this provider' };
    }
    if (!p.allowedDomains.includes(domain)) {
      return { error: `Domain "${domain}" is not allowed to sign in` };
    }
    return {
      username: email,
      email,
      firstName: str(idClaims.given_name),
      lastName: str(idClaims.family_name),
      writeEnabled: (p.writeEmails ?? []).includes(email),
    };
  }
  // oidc (Keycloak-style): roles live in the access token when present.
  const roleClaims = accessClaims ?? idClaims;
  const username =
    str(idClaims[p.usernameClaim]) ||
    str(idClaims.preferred_username) ||
    str(idClaims.email) ||
    str(idClaims.sub);
  if (!username) return { error: 'No username claim in token' };
  const writeEnabled = !p.writeRole || rolesFromClaims(roleClaims).includes(p.writeRole);
  return {
    username,
    email: str(idClaims.email),
    firstName: str(idClaims.given_name),
    lastName: str(idClaims.family_name),
    writeEnabled,
  };
}

/**
 * Backend-for-Frontend: exchange an authorization code for tokens (sending the client
 * secret server-side if the provider is confidential), verify the id_token, and resolve
 * an authorized identity. The browser never sees the secret or the provider tokens.
 */
export async function exchangeCode(
  p: OidcProvider,
  args: { code: string; codeVerifier?: string; redirectUri: string },
): Promise<{ identity: SsoIdentity } | { error: string; status: number }> {
  let d: Discovery;
  try {
    d = await discover(p.issuer);
  } catch (e) {
    return { error: `OIDC discovery failed: ${(e as Error).message}`, status: 502 };
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: p.clientId,
  });
  if (args.codeVerifier) body.set('code_verifier', args.codeVerifier);
  if (p.clientSecret) body.set('client_secret', p.clientSecret);

  let res: Response;
  try {
    res = await fetch(d.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    return { error: `token endpoint unreachable: ${(e as Error).message}`, status: 502 };
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return {
      error: `token exchange rejected (${res.status})${t ? `: ${t.slice(0, 200)}` : ''}`,
      status: 401,
    };
  }
  const tok = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const idToken = str(tok.id_token);
  if (!idToken) return { error: 'provider returned no id_token', status: 502 };
  const idClaims = await verifyJwt(p.issuer, idToken, p.audience ?? p.clientId);
  if (!idClaims) return { error: 'id_token verification failed', status: 401 };

  // Keycloak puts roles in the (JWT) access token; Google's access token is opaque → skip.
  let accessClaims: OidcClaims | undefined;
  const at = str(tok.access_token);
  if (at && at.split('.').length === 3) {
    accessClaims = (await verifyJwt(p.issuer, at).catch(() => null)) ?? undefined;
  }
  const identity = authorizeIdentity(p, idClaims, accessClaims);
  if ('error' in identity) return { error: identity.error, status: 403 };
  return { identity };
}

/** Test helper: drop the cached discovery + JWKS. */
export function _resetOidcCache(): void {
  discoveryCache.clear();
  jwksCache.clear();
}
