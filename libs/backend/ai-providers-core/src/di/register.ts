/**
 * AI Providers Core - DI Registration Bootstrap
 *
 * Provides bootstrap function for registering all ai-providers-core services
 * in the dependency injection container following the standard library pattern.
 *
 * Pattern source: libs/backend/workspace-intelligence/src/di/register.ts
 * Architecture: Per LIBRARY_INTEGRATION_ARCHITECTURE.md
 */

import { DependencyContainer } from 'tsyringe';
import { ProviderManager } from '../manager';
import { ClaudeCliAdapter, VsCodeLmAdapter } from '../adapters';
import { IntelligentProviderStrategy } from '../strategies';
import { ContextManager } from '../context';

/**
 * Token mapping interface for ai-providers-core services
 *
 * This allows the main app to specify which tokens (symbols) each service
 * should be registered under, maintaining proper library boundaries.
 */
export interface AIProviderTokens {
  /** Token for ProviderManager service */
  PROVIDER_MANAGER: symbol;

  /** Token for ContextManager service */
  CONTEXT_MANAGER: symbol;

  /** Token for EventBus service (needed by ProviderManager) */
  EVENT_BUS: symbol;

  /** Token for ClaudeCliAdapter service */
  CLAUDE_CLI_ADAPTER: symbol;

  /** Token for VsCodeLmAdapter service */
  VSCODE_LM_ADAPTER: symbol;

  /** Token for IntelligentProviderStrategy service */
  INTELLIGENT_PROVIDER_STRATEGY: symbol;
}

/**
 * Register all ai-providers-core services in the DI container
 *
 * This is the standard bootstrap function that allows the main application
 * to register all ai-providers-core services without manual registration.
 *
 * Architecture principle: ai-providers-core doesn't define its own tokens,
 * it registers services under tokens provided by the consuming application.
 * This maintains proper library boundaries and avoids token conflicts.
 *
 * @param container - The TSyringe DependencyContainer instance
 * @param tokens - Token mapping specifying which symbols to register services under
 *
 * Usage:
 * ```typescript
 * import { registerAIProviderServices } from '@ptah-extension/ai-providers-core';
 * import { PROVIDER_MANAGER } from '@ptah-extension/claude-domain';
 *
 * const tokens: AIProviderTokens = {
 *   PROVIDER_MANAGER: PROVIDER_MANAGER, // Use claude-domain token
 *   // ... other mappings
 * };
 *
 * registerAIProviderServices(container, tokens);
 * ```
 */
export function registerAIProviderServices(
  container: DependencyContainer,
  tokens: AIProviderTokens
): void {
  // Provider strategies (register first - needed by ProviderManager)
  container.registerSingleton(
    tokens.INTELLIGENT_PROVIDER_STRATEGY,
    IntelligentProviderStrategy
  );

  // Core provider management (depends on EventBus and IntelligentProviderStrategy)
  container.register(tokens.PROVIDER_MANAGER, {
    useFactory: (c) => {
      const eventBus = c.resolve(tokens.EVENT_BUS) as any; // EventBus from vscode-core
      const strategy = c.resolve(
        tokens.INTELLIGENT_PROVIDER_STRATEGY
      ) as IntelligentProviderStrategy;
      return new ProviderManager(eventBus, strategy);
    },
  });

  // Context management
  container.registerSingleton(tokens.CONTEXT_MANAGER, ContextManager);

  // Provider adapters
  container.registerSingleton(tokens.CLAUDE_CLI_ADAPTER, ClaudeCliAdapter);
  container.registerSingleton(tokens.VSCODE_LM_ADAPTER, VsCodeLmAdapter);
}
