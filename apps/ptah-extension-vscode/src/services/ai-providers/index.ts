/**
 * AI Providers Module
 * Exports all provider-related classes and interfaces
 */

// Base classes and interfaces
export { BaseAIProvider } from './base-ai-provider';
export type { ProviderEvents } from './base-ai-provider';

// Concrete provider implementations
export { ClaudeCliProviderAdapter } from './claude-cli-provider-adapter';
export { VSCodeLMProvider } from './vscode-lm-provider';
export type { VSCodeLMProviderConfig } from './vscode-lm-provider';

// Factory and manager
export { ProviderFactory } from './provider-factory';
export type { ProviderFactoryConfig } from './provider-factory';
export { ProviderManager } from './provider-manager';
export type { ProviderManagerConfig } from './provider-manager';

// Re-export types from ai-provider.types
export type {
  IAIProvider,
  IProviderFactory,
  IProviderManager,
  ProviderId,
  ProviderStatus,
  ProviderCapabilities,
  ProviderInfo,
  ProviderHealth,
  ProviderError,
  ProviderErrorType,
  AIMessageOptions,
  AISessionConfig,
  ProviderSwitchEvent,
  ProviderErrorEvent,
  ProviderHealthChangeEvent,
  DEFAULT_PROVIDER_CAPABILITIES,
  PROVIDER_IDS,
} from '@ptah-extension/shared';

// Re-export utility functions
export {
  isProviderError,
  isValidProviderId,
  DEFAULT_AI_MESSAGE_OPTIONS,
} from '@ptah-extension/shared';
