/**
 * Deep Agent SDK — DI registration.
 *
 * Call AFTER registerSdkServices() so the selector can resolve
 * SDK_TOKENS.SDK_AGENT_ADAPTER as one of its two inner adapters.
 */

import { DependencyContainer, Lifecycle, type FactoryProvider } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { ConfigManager, TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS, InternalQueryService } from '@ptah-extension/agent-sdk';
import { DEEP_AGENT_TOKENS } from './tokens';
import { ModelFactoryService } from '../model-factory/model-factory.service';
import { SessionRegistry } from '../session-registry/session-registry.service';
import { DeepAgentAdapter } from '../deep-agent-adapter/deep-agent-adapter';
import { AgentRuntimeSelector } from '../runtime-selector/agent-runtime-selector';
import { StreamAdapterService } from '../stream-adapter/stream-adapter.service';
import { ToolBridgeService } from '../tool-bridge/tool-bridge.service';
import { DeepAgentInternalQueryAdapter } from '../internal-query/deep-agent-internal-query.adapter';

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

  container.register(
    DEEP_AGENT_TOKENS.DEEP_AGENT_INTERNAL_QUERY,
    { useClass: DeepAgentInternalQueryAdapter },
    { lifecycle: Lifecycle.Singleton },
  );

  // Override SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE with a runtime-aware factory.
  // Must come AFTER registerSdkServices() so InternalQueryService is already registered.
  // The factory resolves by class (not token) to avoid circular resolution.
  const internalQueryFactory: FactoryProvider<unknown> = {
    useFactory: (c: DependencyContainer) => {
      const cfg = c.resolve<ConfigManager>(TOKENS.CONFIG_MANAGER);
      const rawRuntime = cfg.get<string>('runtime') ?? 'auto';
      const authMethod = cfg.get<string>('authMethod') ?? 'apiKey';
      let useDeep = rawRuntime === 'deep-agent';
      if (!useDeep && rawRuntime === 'auto') {
        const isClaudeNative =
          authMethod === 'apiKey' ||
          authMethod === 'claudeCli' ||
          authMethod === 'oauth' ||
          authMethod === 'auto';
        useDeep = !isClaudeNative;
      }
      return useDeep
        ? c.resolve(DEEP_AGENT_TOKENS.DEEP_AGENT_INTERNAL_QUERY)
        : c.resolve(InternalQueryService);
    },
  };
  container.register(
    SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE,
    internalQueryFactory,
  );

  logger.info('[DeepAgentSDK] Services registered', {
    tokens: Object.keys(DEEP_AGENT_TOKENS),
  });
}
