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
} from './lib/handlers';

// Platform abstraction interfaces (TASK_2025_203 Batch 2)
export type {
  IPlatformCommands,
  IPlatformAuthProvider,
  ISaveDialogProvider,
  IModelDiscovery,
} from './lib/platform-abstractions';
