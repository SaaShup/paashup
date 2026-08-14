/**
 * Type definitions for the Keycloak plugin.
 * Explicit, named types for better IDE autocompletion and readability.
 */

// ============================================================================
// Database row types
// ============================================================================

export interface KeycloakServerRow {
  id: number;
  name: string;
  url: string;
  admin_username: string;
  admin_password: string;
  created_at: string;
  updated_at: string;
}

export interface KeycloakRealmRow {
  id: number;
  server_id: number;
  realm_name: string; // the actual realm name in Keycloak
}

export interface KeycloakClientRow {
  id: number;
  realm_id: number;
  client_id: string; // the Keycloak clientId (human identifier)
  kc_uuid: string | null; // Keycloak's internal client id
  secret: string | null; // confidential client secret, when known
}

/** 'callback' mirrors the client's redirectUris; 'post_logout' its post-logout URIs. */
export type RedirectUrlKind = 'callback' | 'post_logout';

export interface KeycloakRedirectUrlRow {
  id: number;
  client_id: number; // FK to plugin_keycloak_client.id
  url: string;
  kind: RedirectUrlKind;
  created_at: string;
}

// ============================================================================
// Keycloak Admin API types
// ============================================================================

export interface KeycloakRealmInfo {
  realm: string;
  enabled: boolean;
  displayName?: string;
}

export interface KeycloakTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface KeycloakClientRepresentation {
  id: string;
  clientId: string;
  name?: string;
  redirectUris?: string[];
  webOrigins?: string[];
  publicClient?: boolean;
  /** Free-form client attributes — post-logout URIs live in `post.logout.redirect.uris`. */
  attributes?: Record<string, string>;
}

// ============================================================================
// Service response types
// ============================================================================

export interface FetchRealmsResult {
  realms: string[];
  error?: string;
}

export interface AddRedirectUrlResult {
  success: boolean;
  message: string;
}

export interface RemoveRedirectUrlResult {
  success: boolean;
  message: string;
}

/**
 * What the orchestrator (e.g. nbdiu) sends to register/unregister an
 * instance's URLs. Unregister must receive the same values as register —
 * the URLs are recomputed deterministically from them.
 */
export interface SyncUrlsInput {
  /** Public base URL of the instance (e.g. https://foo.example.com). */
  url: string;
  /** Target realm (matches realm_name). */
  realm: string;
  /** Target client in that realm (matches its Keycloak clientId). */
  client_id: string;
  /** OAuth callback path, appended to `url` (e.g. /api/auth/callback). */
  callback_path: string;
  /** Optional post-logout path; without it the bare `url` is used. */
  postlogout_path?: string;
}

/** One URL touched by a register/unregister operation. */
export interface UrlChange {
  url: string;
  kind: RedirectUrlKind;
  realm: string;
  client_id: string;
}

/** Outcome of syncing an instance's URLs to Keycloak. */
export interface SyncUrlsResult {
  /** URLs successfully written to (or removed from) Keycloak. */
  urls: UrlChange[];
  /** Why nothing was attempted (no matching realm/client, …). */
  skipped?: string;
  /** Per-URL failures (Keycloak unreachable, …). */
  errors: string[];
}
