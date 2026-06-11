// Native OIDC (Keycloak) support: validate `Authorization: Bearer <JWT>` access
// tokens against the issuer's JWKS, with no external dependency (Node verifies
// RS256 from a JWK directly). Enabled when PB_OIDC_ISSUER is set:
//   PB_OIDC_ISSUER       e.g. https://kc.example.com/realms/paasbox  (required)
//   PB_OIDC_AUDIENCE     if set, the token's aud (or azp) must include it
//   PB_OIDC_WRITE_ROLE   realm/client role granting write access (else read-only)
//   PB_OIDC_USERNAME_CLAIM   claim used as the paas2box username (default preferred_username)
//   PB_OIDC_CLIENT_ID    advertised to the SPA via /api/auth/oidc-config/ (login flow)
import crypto from 'node:crypto';

const LEEWAY_S = 60; // clock-skew tolerance
const JWKS_TTL_MS = 5 * 60 * 1000;

export function oidcEnabled(): boolean {
  return !!process.env.PB_OIDC_ISSUER;
}
function issuerUrl(): string | undefined {
  return process.env.PB_OIDC_ISSUER?.replace(/\/+$/, '');
}

export type OidcClaims = Record<string, unknown>;
interface Jwk {
  kty?: string;
  kid?: string;
  [k: string]: unknown;
}

let cache: {
  issuer: string;
  jwksUri: string;
  keys: Map<string, crypto.KeyObject>;
  at: number;
} | null = null;

function b64urlJson(seg: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8')) as Record<string, unknown>;
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Fetch (and cache) the issuer's signing keys, keyed by `kid`. */
async function loadKeys(issuer: string, force: boolean): Promise<Map<string, crypto.KeyObject>> {
  const now = Date.now();
  if (!force && cache && cache.issuer === issuer && now - cache.at < JWKS_TTL_MS) return cache.keys;
  const jwksUri =
    cache && cache.issuer === issuer
      ? cache.jwksUri
      : String((await fetchJson(`${issuer}/.well-known/openid-configuration`)).jwks_uri ?? '');
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
  cache = { issuer, jwksUri, keys, at: now };
  return keys;
}

/** Verify a Keycloak/OIDC RS256 JWT. Returns its claims, or null if invalid. */
export async function verifyOidcToken(token: string): Promise<OidcClaims | null> {
  const issuer = issuerUrl();
  if (!issuer) return null;
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

  let keys = await loadKeys(issuer, false).catch(() => null);
  let key = keys?.get(header.kid);
  if (!key) {
    keys = await loadKeys(issuer, true).catch(() => null); // key rotation: refetch once
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
  if (claims.iss !== issuer) return null;
  if (typeof claims.exp === 'number' && now > claims.exp + LEEWAY_S) return null;
  if (typeof claims.nbf === 'number' && now + LEEWAY_S < claims.nbf) return null;
  const audience = process.env.PB_OIDC_AUDIENCE;
  if (audience) {
    const aud = Array.isArray(claims.aud)
      ? (claims.aud as unknown[]).map(String)
      : claims.aud
        ? [String(claims.aud)]
        : [];
    if (!aud.includes(audience) && claims.azp !== audience) return null;
  }
  return claims;
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

/** Test helper: drop the cached JWKS. */
export function _resetOidcCache(): void {
  cache = null;
}
