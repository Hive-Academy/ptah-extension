/**
 * AI Providers Core - Public API
 * Exports interfaces, strategies, manager, adapters, and context management for multi-provider AI system
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

// Context management
export {
  ContextManager,
  type FileSearchResult,
  type FileSearchOptions,
} from './context';

// NOTE: DI registration is now centralized in apps/ptah-extension-vscode/src/di/container.ts
// No longer exporting register functions from libraries
