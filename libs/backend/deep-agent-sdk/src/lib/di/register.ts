/**
 * Deep Agent SDK — DI registration.
 *
 * Call AFTER registerSdkServices() so the selector can resolve
 * SDK_TOKENS.SDK_AGENT_ADAPTER as one of its two inner adapters.
 */

import { DependencyContainer, Lifecycle } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { DEEP_AGENT_TOKENS } from './tokens';
import { ModelFactoryService } from '../model-factory/model-factory.service';
import { SessionRegistry } from '../session-registry/session-registry.service';
import { DeepAgentAdapter } from '../deep-agent-adapter/deep-agent-adapter';
import { AgentRuntimeSelector } from '../runtime-selector/agent-runtime-selector';
import { StreamAdapterService } from '../stream-adapter/stream-adapter.service';
import { ToolBridgeService } from '../tool-bridge/tool-bridge.service';

export function registerDeepAgentServices(
  container: DependencyContainer,
  logger: Logger,
): void {
  logger.info('[DeepAgentSDK] Registering services...');

  container.register(
    DEEP_AGENT_TOKENS.MODEL_FACTORY,
    { useClass: ModelFactoryService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    DEEP_AGENT_TOKENS.STREAM_ADAPTER,
    { useClass: StreamAdapterService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    DEEP_AGENT_TOKENS.TOOL_BRIDGE,
    { useClass: ToolBridgeService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    DEEP_AGENT_TOKENS.SESSION_REGISTRY,
    { useClass: SessionRegistry },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    DEEP_AGENT_TOKENS.DEEP_AGENT_ADAPTER,
    { useClass: DeepAgentAdapter },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    DEEP_AGENT_TOKENS.AGENT_RUNTIME_SELECTOR,
    { useClass: AgentRuntimeSelector },
    { lifecycle: Lifecycle.Singleton },
  );

  logger.info('[DeepAgentSDK] Services registered', {
    tokens: Object.keys(DEEP_AGENT_TOKENS),
  });
}
