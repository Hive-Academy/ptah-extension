/**
 * @ptah-extension/gateway-chat-bridge — public API.
 *
 * Bridges inbound messaging-gateway events into Ptah agent sessions and
 * streams the assistant reply back to the originating chat platform.
 */
export { GatewayChatBridge } from './lib/gateway-chat-bridge';
export { ConversationQueue } from './lib/conversation-queue';
export { GATEWAY_CHAT_BRIDGE_TOKENS } from './lib/di/tokens';
export type { GatewayChatBridgeDIToken } from './lib/di/tokens';
export { registerGatewayChatBridge } from './lib/di/register';
