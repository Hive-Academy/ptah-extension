/**
 * DI Token Registry — Gateway Chat Bridge.
 *
 * Convention mirrors `libs/backend/messaging-gateway/src/lib/di/tokens.ts`:
 * always `Symbol.for(...)` with a globally-unique Ptah-prefixed description.
 */
export const GATEWAY_CHAT_BRIDGE_TOKENS = {
  /** GatewayChatBridge — wires inbound gateway events into agent sessions. */
  GATEWAY_CHAT_BRIDGE: Symbol.for('PtahGatewayChatBridge'),
} as const;

export type GatewayChatBridgeDIToken = keyof typeof GATEWAY_CHAT_BRIDGE_TOKENS;
