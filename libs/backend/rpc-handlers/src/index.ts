/**
 * @ptah-extension/rpc-handlers
 *
 * Shared RPC handler classes for the Ptah Extension.
 * These handlers are platform-agnostic (no vscode imports) and can be
 * used by both VS Code and Electron applications.
 *
 * TASK_2025_203: Unify RPC Handler Architecture
 */

export {
  // Tier 1 handlers
  SessionRpcHandlers,
  ContextRpcHandlers,
  AutocompleteRpcHandlers,
  SubagentRpcHandlers,
  LlmRpcHandlers,
  PluginRpcHandlers,
  PtahCliRpcHandlers,
  // Tier 2 handlers (TASK_2025_203 Batch 3)
  SetupRpcHandlers,
  WizardGenerationRpcHandlers,
  ConfigRpcHandlers,
  LicenseRpcHandlers,
  ChatRpcHandlers,
  // Tier 2 handlers (TASK_2025_203 Batch 4)
  AuthRpcHandlers,
  EnhancedPromptsRpcHandlers,
  QualityRpcHandlers,
  ProviderRpcHandlers,
  // Tier 2 handlers (TASK_2025_235 - web search settings)
  WebSearchRpcHandlers,
  // Harness Setup Builder handlers
  HarnessRpcHandlers,
} from './lib/handlers';

// Platform abstraction interfaces (TASK_2025_203 Batch 2)
// Moved to @ptah-extension/platform-core in Wave C8 (TASK_2025_291).
// Re-exported here for backwards-compat; prefer importing from platform-core directly.
export type {
  IPlatformCommands,
  IPlatformAuthProvider,
  ISaveDialogProvider,
  IModelDiscovery,
} from '@ptah-extension/platform-core';

// Registration helpers (TASK_2025_291 Wave C4b)
export * from './lib/register-all';
export * from './lib/verify-and-report';

// Harness sub-service DI tokens + registration helper (TASK_2025_291 Wave C7d)
export { HARNESS_TOKENS, registerHarnessServices } from './lib/harness';

// Chat sub-service DI tokens + registration helper (TASK_2025_291 Wave C7e)
export { CHAT_TOKENS, registerChatServices } from './lib/chat';
