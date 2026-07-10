/**
 * IGatewaySessionLister — consumer-side port for listing resumable sessions
 * per workspace (drives `/sessions` and `/session use` re-validation).
 *
 * Implemented OUTSIDE messaging-gateway (Electron host:
 * `apps/ptah-electron/src/services/gateway/metadata-gateway-session-lister.ts`)
 * because session metadata lives behind agent-sdk's workspace-aware state
 * storage — same host-implemented pattern as `ITokenVault`. Registered under
 * `GATEWAY_TOKENS.GATEWAY_SESSION_LISTER` by the host before
 * `registerMessagingGatewayServices` runs.
 */
export interface GatewaySessionSummary {
  sessionId: string;
  name: string;
  lastActiveAt: number;
}

export interface IGatewaySessionLister {
  /**
   * Resumable sessions for `workspaceRoot`, most-recently-active first,
   * capped at 25 (Discord picklist limit). `truncated` is true when the cap
   * dropped entries.
   */
  listForWorkspace(workspaceRoot: string): Promise<{
    sessions: GatewaySessionSummary[];
    truncated: boolean;
  }>;
}
