/** OpenCode subscription authentication; keys are never shared between products. */
export interface IOpenCodeAuthService {
  isAuthenticated(): Promise<boolean>;
  getApiKey(): Promise<string | null>;
  getHeaders(): Promise<Record<string, string>>;
}

/** SDK-to-local-proxy metadata, never an upstream credential. */
export const OPENCODE_PROXY_TOKEN_PLACEHOLDER = 'opencode-proxy-token';
