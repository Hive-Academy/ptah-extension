/**
 * gateway-chat-bridge DI registration helper.
 *
 * Mirrors the contract of `registerMessagingGatewayServices`: callers must
 * already have `TOKENS.LOGGER`, `PLATFORM_TOKENS.WORKSPACE_PROVIDER`,
 * `TOKENS.AGENT_ADAPTER`, and the `GATEWAY_TOKENS` services registered.
 */
import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { GATEWAY_CHAT_BRIDGE_TOKENS } from './tokens';
import { GatewayChatBridge } from '../gateway-chat-bridge';

export function registerGatewayChatBridge(
  container: DependencyContainer,
  logger?: Logger,
): void {
  container.registerSingleton(
    GATEWAY_CHAT_BRIDGE_TOKENS.GATEWAY_CHAT_BRIDGE,
    GatewayChatBridge,
  );
  logger?.info('[gateway-chat-bridge] service registered');
}
