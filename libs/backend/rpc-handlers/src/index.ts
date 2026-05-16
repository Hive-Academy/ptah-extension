/**
 * @ptah-extension/rpc-handlers
 *
 * Shared RPC handler classes for the Ptah Extension.
 * These handlers are platform-agnostic (no vscode imports) and can be
 * used by both VS Code and Electron applications.
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
  // Tier 2 handlers
  SetupRpcHandlers,
  WizardGenerationRpcHandlers,
  ConfigRpcHandlers,
  LicenseRpcHandlers,
  ChatRpcHandlers,
  // Tier 2 handlers
  AuthRpcHandlers,
  EnhancedPromptsRpcHandlers,
  QualityRpcHandlers,
  ProviderRpcHandlers,
  // Tier 2 handlers - web search settings
  WebSearchRpcHandlers,
  // Harness Setup Builder handlers
  HarnessRpcHandlers,
  // MCP Server Directory handlers
  McpDirectoryRpcHandlers,
  // Git handlers
  GitRpcHandlers,
  // Workspace handlers
  WorkspaceRpcHandlers,
  // Settings handlers
  SettingsRpcHandlers,
  MemoryRpcHandlers,
  SkillsSynthesisRpcHandlers,
  CronRpcHandlers,
  GatewayRpcHandlers,
  PersistenceRpcHandlers,
  mintResetChallengeToken,
  // Workspace indexing control handlers
  IndexingRpcHandlers,
} from './lib/handlers';
export type {
  DbHealthResult,
  DbHealthParams,
  DbResetParams,
  DbResetResult,
} from './lib/handlers';

// Platform abstraction interfaces.
// Canonical home is @ptah-extension/platform-core.
// Re-exported here for backwards-compat; prefer importing from platform-core directly.
export type {
  IPlatformCommands,
  IPlatformAuthProvider,
  ISaveDialogProvider,
  IModelDiscovery,
} from '@ptah-extension/platform-core';

// Registration helpers
export * from './lib/register-all';
export * from './lib/verify-and-report';
export { registerSharedRpcHandlers } from './lib/register-shared-rpc-handlers';

// Harness sub-service DI tokens + registration helper
export { HARNESS_TOKENS, registerHarnessServices } from './lib/harness';

// Chat sub-service DI tokens + registration helper
export { CHAT_TOKENS, registerChatServices } from './lib/chat';

// Shared workspace-authorization utility
export { isAuthorizedWorkspace } from './lib/utils/workspace-authorization';
