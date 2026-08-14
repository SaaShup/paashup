/**
 * HTTP client for Keycloak Admin API.
 * Handles authentication, requests, and error details logging.
 */

import type {
  KeycloakTokenResponse,
  KeycloakRealmInfo,
  KeycloakClientRepresentation,
} from './keycloak-types.js';

// ============================================================================
// Keycloak API client
// ============================================================================

export class KeycloakApiError extends Error {
  constructor(
    public status: number,
    public path: string,
    public method: string,
    message: string,
  ) {
    super(`Keycloak ${method} ${path} -> ${status}: ${message}`);
    this.name = 'KeycloakApiError';
  }
}

export interface KeycloakServerConfig {
  url: string;
  adminUsername: string;
  adminPassword: string;
}

/**
 * Keycloak Admin API client.
 * Handles token management, requests, and error details.
 */
export class KeycloakAdminClient {
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(private config: KeycloakServerConfig) {
    this.validateUrl();
  }

  private validateUrl(): void {
    try {
      new URL(this.config.url);
    } catch {
      throw new Error(`Invalid Keycloak URL: ${this.config.url}`);
    }
  }

  /**
   * Get a valid access token, using cache if available.
   */
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.token;
    }

    // Fetch new token
    const tokenUrl = `${this.config.url.replace(/\/$/, '')}/realms/master/protocol/openid-connect/token`;

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: 'admin-cli',
        username: this.config.adminUsername,
        password: this.config.adminPassword,
        grant_type: 'password',
      }).toString(),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new KeycloakApiError(
        response.status,
        '/token',
        'POST',
        `Failed to get token: ${detail}`,
      );
    }

    const data = (await response.json()) as KeycloakTokenResponse;
    this.tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 30) * 1000, // refresh 30s before expiry
    };

    return data.access_token;
  }

  /**
   * Make an authenticated request to Keycloak Admin API.
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.getAccessToken();
    const url = `${this.config.url.replace(/\/$/, '')}/admin${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      let detail = '';
      try {
        const text = await response.text();
        detail = text.length > 500 ? text.slice(0, 500) : text;
      } catch {
        // ignore
      }
      throw new KeycloakApiError(response.status, path, method, detail || response.statusText);
    }

    // Some endpoints return no content
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  /**
   * Fetch list of realms.
   */
  async listRealms(): Promise<string[]> {
    const realms = await this.request<KeycloakRealmInfo[]>('GET', '/realms');
    return realms.map((r) => r.realm);
  }

  /**
   * Create a realm (enabled).
   */
  async createRealm(realmName: string): Promise<void> {
    await this.request('POST', '/realms', { realm: realmName, enabled: true });
  }

  /**
   * Rename a realm.
   */
  async renameRealm(realmName: string, newName: string): Promise<void> {
    await this.request('PUT', `/realms/${realmName}`, { realm: newName });
  }

  /**
   * Delete a realm. A 404 (already gone) is tolerated.
   */
  async deleteRealm(realmName: string): Promise<void> {
    try {
      await this.request('DELETE', `/realms/${realmName}`);
    } catch (err) {
      if (err instanceof KeycloakApiError && err.status === 404) return;
      throw err;
    }
  }

  /**
   * Create a confidential OIDC client (Authorization Code flow enabled).
   * Keycloak generates its secret; returns the created representation.
   */
  async createClient(realmName: string, clientId: string): Promise<KeycloakClientRepresentation> {
    await this.request('POST', `/realms/${realmName}/clients`, {
      clientId,
      protocol: 'openid-connect',
      publicClient: false, // confidential → Keycloak generates a secret
      standardFlowEnabled: true, // Authorization Code ("authentication") flow
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: false,
      redirectUris: [],
      enabled: true,
    });
    return this.getClient(realmName, clientId);
  }

  /**
   * Rename a client (its clientId).
   */
  async renameClient(realmName: string, uuid: string, newClientId: string): Promise<void> {
    const current = await this.request<KeycloakClientRepresentation>(
      'GET',
      `/realms/${realmName}/clients/${uuid}`,
    );
    await this.request('PUT', `/realms/${realmName}/clients/${uuid}`, {
      ...current,
      clientId: newClientId,
    });
  }

  /**
   * Delete a client. A 404 (already gone) is tolerated.
   */
  async deleteClient(realmName: string, uuid: string): Promise<void> {
    try {
      await this.request('DELETE', `/realms/${realmName}/clients/${uuid}`);
    } catch (err) {
      if (err instanceof KeycloakApiError && err.status === 404) return;
      throw err;
    }
  }

  /**
   * Read a client's secret (confidential clients only).
   */
  async getClientSecret(realmName: string, uuid: string): Promise<string | null> {
    const res = await this.request<{ value?: string }>(
      'GET',
      `/realms/${realmName}/clients/${uuid}/client-secret`,
    );
    return res.value ?? null;
  }

  /**
   * Generate a new secret for a client and return it.
   */
  async regenerateClientSecret(realmName: string, uuid: string): Promise<string | null> {
    const res = await this.request<{ value?: string }>(
      'POST',
      `/realms/${realmName}/clients/${uuid}/client-secret`,
    );
    return res.value ?? null;
  }

  /**
   * Get a specific client in a realm.
   */
  async getClient(realmName: string, clientId: string): Promise<KeycloakClientRepresentation> {
    const client = await this.request<KeycloakClientRepresentation>(
      'GET',
      `/realms/${realmName}/clients?clientId=${encodeURIComponent(clientId)}&first=1`,
    );
    // API returns array, we want single item
    if (Array.isArray(client) && client.length > 0) {
      return client[0];
    }
    throw new KeycloakApiError(404, `/realms/${realmName}/clients`, 'GET', 'Client not found');
  }

  /**
   * Update client redirect URIs.
   */
  async updateClientRedirectUris(
    realmName: string,
    clientId: string,
    redirectUris: string[],
  ): Promise<void> {
    // First get the full client representation
    const client = await this.getClient(realmName, clientId);

    // Update the redirect URIs
    await this.request('PUT', `/realms/${realmName}/clients/${client.id}`, {
      ...client,
      redirectUris,
    });
  }

  /**
   * Add a redirect URI to a client.
   */
  async addRedirectUri(realmName: string, clientId: string, redirectUri: string): Promise<void> {
    const client = await this.getClient(realmName, clientId);
    const currentUris = client.redirectUris ?? [];

    if (currentUris.includes(redirectUri)) {
      return; // Already exists
    }

    await this.updateClientRedirectUris(realmName, clientId, [...currentUris, redirectUri]);
  }

  /**
   * Remove a redirect URI from a client.
   */
  async removeRedirectUri(realmName: string, clientId: string, redirectUri: string): Promise<void> {
    const client = await this.getClient(realmName, clientId);
    const currentUris = client.redirectUris ?? [];

    const filtered = currentUris.filter((uri) => uri !== redirectUri);

    if (filtered.length === currentUris.length) {
      return; // Didn't exist
    }

    await this.updateClientRedirectUris(realmName, clientId, filtered);
  }

  /**
   * Get all redirect URIs for a client.
   */
  async getRedirectUris(realmName: string, clientId: string): Promise<string[]> {
    const client = await this.getClient(realmName, clientId);
    return client.redirectUris ?? [];
  }

  // Keycloak stores post-logout redirect URIs as a single '##'-separated string
  // in the client attribute `post.logout.redirect.uris`.
  private static readonly POST_LOGOUT_ATTR = 'post.logout.redirect.uris';

  private static parsePostLogoutUris(client: KeycloakClientRepresentation): string[] {
    const raw = client.attributes?.[KeycloakAdminClient.POST_LOGOUT_ATTR] ?? '';
    return raw.split('##').filter(Boolean);
  }

  /**
   * Get all post-logout redirect URIs for a client.
   */
  async getPostLogoutUris(realmName: string, clientId: string): Promise<string[]> {
    const client = await this.getClient(realmName, clientId);
    return KeycloakAdminClient.parsePostLogoutUris(client);
  }

  /**
   * Get both URI lists of a client in one request.
   */
  async getUris(
    realmName: string,
    clientId: string,
  ): Promise<{ callback: string[]; post_logout: string[] }> {
    const client = await this.getClient(realmName, clientId);
    return {
      callback: client.redirectUris ?? [],
      post_logout: KeycloakAdminClient.parsePostLogoutUris(client),
    };
  }

  /**
   * Replace a client's post-logout redirect URIs.
   */
  async updatePostLogoutUris(realmName: string, clientId: string, uris: string[]): Promise<void> {
    const client = await this.getClient(realmName, clientId);
    await this.request('PUT', `/realms/${realmName}/clients/${client.id}`, {
      ...client,
      attributes: {
        ...client.attributes,
        [KeycloakAdminClient.POST_LOGOUT_ATTR]: uris.join('##'),
      },
    });
  }

  /**
   * Add a post-logout redirect URI to a client.
   */
  async addPostLogoutUri(realmName: string, clientId: string, uri: string): Promise<void> {
    const client = await this.getClient(realmName, clientId);
    const current = KeycloakAdminClient.parsePostLogoutUris(client);
    if (current.includes(uri)) return; // already exists
    await this.updatePostLogoutUris(realmName, clientId, [...current, uri]);
  }

  /**
   * Remove a post-logout redirect URI from a client.
   */
  async removePostLogoutUri(realmName: string, clientId: string, uri: string): Promise<void> {
    const client = await this.getClient(realmName, clientId);
    const current = KeycloakAdminClient.parsePostLogoutUris(client);
    const filtered = current.filter((u) => u !== uri);
    if (filtered.length === current.length) return; // didn't exist
    await this.updatePostLogoutUris(realmName, clientId, filtered);
  }

  /**
   * List all clients in a realm.
   */
  async listClients(realmName: string): Promise<KeycloakClientRepresentation[]> {
    const clients = await this.request<KeycloakClientRepresentation[]>(
      'GET',
      `/realms/${realmName}/clients`,
    );
    return Array.isArray(clients) ? clients : [];
  }

  /**
   * Test connection to Keycloak by listing realms.
   */
  async testConnection(): Promise<void> {
    try {
      await this.listRealms();
    } catch (err) {
      if (err instanceof KeycloakApiError) {
        throw err;
      }
      throw new Error(`Connection failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
