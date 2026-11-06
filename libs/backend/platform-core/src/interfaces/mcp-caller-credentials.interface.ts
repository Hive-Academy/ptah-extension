/**
 * IMcpCallerCredentials — issue and revoke MCP caller tokens.
 *
 * Declared here so agent-sdk and cli-agent-runtime can mint a lane token
 * without importing vscode-lm-tools. The registry that implements this port
 * lives in vscode-lm-tools and is bound from registerVsCodeLmToolsServices.
 *
 * `issue` returns the raw token once. Callers put it in a client config and
 * then drop it. The adapter stores only a sha256 digest. Lane and session
 * tokens stay in memory. Persistent slot hashes are a separate store owned
 * by the registry, not this port.
 */

/** What a caller is allowed to invoke. */
export type McpCallerCapability = 'read-only' | 'lane-report' | 'privileged';

/**
 * Who the token was minted for. `home` is a persistent slot with no
 * workspace. `internal-query` is a short-lived privileged workspace query.
 */
export type McpCallerBindingKind =
  'agent' | 'session' | 'workspace' | 'home' | 'internal-query';

/** Profile segment the URL carried when the token was minted. */
export type McpCallerToolProfile = 'coding' | 'apps';

/** Identity and capability bound to one token. No raw secret. */
export interface McpCallerBinding {
  readonly kind: McpCallerBindingKind;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly workspaceRoot?: string;
  readonly toolProfile?: McpCallerToolProfile;
  readonly capability: McpCallerCapability;
}

export interface IMcpCallerCredentials {
  /**
   * Mint an in-memory token. `ttlMs` is measured from now. The raw token is
   * the return value and is not stored.
   */
  issue(binding: McpCallerBinding, subject: string, ttlMs: number): string;

  /** Drop every in-memory token minted for `subject`. Persistent slot hashes stay. */
  revokeSubject(subject: string): void;
}
