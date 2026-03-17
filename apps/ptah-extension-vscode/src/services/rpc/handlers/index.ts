/**
 * RPC Handlers Index
 *
 * Exports all RPC handler classes for DI registration.
 *
 * TASK_2025_074: Modular RPC handler architecture
 * TASK_2025_203: Tier 1+2 handlers moved to @ptah-extension/rpc-handlers library
 */

// Shared handlers (TASK_2025_203: re-exported from @ptah-extension/rpc-handlers)
export {
  // Tier 1
  SessionRpcHandlers,
  ContextRpcHandlers,
  AutocompleteRpcHandlers,
  SubagentRpcHandlers,
  LlmRpcHandlers,
  PluginRpcHandlers,
  PtahCliRpcHandlers,
  // Tier 2 (Batch 3)
  ChatRpcHandlers,
  ConfigRpcHandlers,
  SetupRpcHandlers,
  LicenseRpcHandlers,
  WizardGenerationRpcHandlers,
  // Tier 2 (Batch 4)
  AuthRpcHandlers,
  EnhancedPromptsRpcHandlers,
  QualityRpcHandlers,
  ProviderRpcHandlers,
} from '@ptah-extension/rpc-handlers';

// Tier 3 handlers (VS Code-specific, stay local)
export { FileRpcHandlers } from './file-rpc.handlers';
export { CommandRpcHandlers } from './command-rpc.handlers';
export { AgentRpcHandlers } from './agent-rpc.handlers';
