/**
 * AI Providers Core - Public API
 * Exports interfaces, strategies, manager, and adapters for multi-provider AI system
 */

// Core interfaces
export type {
  ProviderContext,
  EnhancedAIProvider,
  ProviderSelectionResult,
} from './interfaces';

// Provider selection strategy
export { IntelligentProviderStrategy } from './strategies';

// Provider manager and state
export type { ActiveProviderState } from './manager';
export { ProviderManager } from './manager';

// Provider adapters (concrete implementations)
export { ClaudeCliAdapter, VsCodeLmAdapter } from './adapters';
