/**
 * Encrypted token store for OAuth-connected MCP servers.
 *
 * Mirrors `createSmitheryConfigSecretStore`: wraps `IAuthSecretsService`
 * provider-key slots (each an isolated, encrypted entry) into a narrow port so
 * callers store the full token record — access/refresh tokens and client
 * credentials — under a per-server slot. Nothing here is ever written to a
 * plaintext config file.
 */

/** Prefix for the per-server encrypted OAuth-token slot id. */
export const MCP_OAUTH_TOKEN_SECRET_PREFIX = 'mcp.oauth.';

/**
 * The full secret-bearing OAuth record for one connected server. Persisted only
 * in the encrypted secret store — never in the plaintext manifest.
 */
export interface McpOAuthTokenRecord {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when the access token expires; undefined = no known expiry. */
  expiresAt?: number;
  /** Token endpoint, retained so the resolver can refresh without re-discovery. */
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  scope?: string;
}

export interface McpOAuthTokenStore {
  setToken(serverKey: string, token: McpOAuthTokenRecord): Promise<void>;
  getToken(serverKey: string): Promise<McpOAuthTokenRecord | null>;
  deleteToken(serverKey: string): Promise<void>;
}

/** Default token store backed by `IAuthSecretsService`-style provider-key slots. */
export function createMcpOAuthTokenStore(secrets: {
  getProviderKey(id: string): Promise<string | undefined>;
  setProviderKey(id: string, value: string): Promise<void>;
  deleteProviderKey(id: string): Promise<void>;
}): McpOAuthTokenStore {
  const slot = (serverKey: string) =>
    `${MCP_OAUTH_TOKEN_SECRET_PREFIX}${serverKey}`;
  return {
    async setToken(serverKey, token) {
      await secrets.setProviderKey(slot(serverKey), JSON.stringify(token));
    },
    async getToken(serverKey) {
      const raw = await secrets.getProviderKey(slot(serverKey));
      if (!raw) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          typeof (parsed as McpOAuthTokenRecord).accessToken === 'string'
        ) {
          return parsed as McpOAuthTokenRecord;
        }
        return null;
      } catch {
        return null;
      }
    },
    async deleteToken(serverKey) {
      await secrets.deleteProviderKey(slot(serverKey));
    },
  };
}
