/**
 * ISessionActivityProbe — consumer-side port answering "is this session
 * currently running in the agent adapter?" (AC-3.5: `/session use` must
 * refuse a session the webview is mid-turn on).
 *
 * Implemented OUTSIDE messaging-gateway (Electron host registers a factory
 * over `TOKENS.AGENT_ADAPTER.isSessionActive`) so this lib never grows an
 * agent-sdk dependency. Registered under
 * `GATEWAY_TOKENS.GATEWAY_SESSION_ACTIVITY_PROBE` by the host before
 * `registerMessagingGatewayServices` runs.
 */
export interface ISessionActivityProbe {
  isActive(sessionUuid: string): boolean;
}
