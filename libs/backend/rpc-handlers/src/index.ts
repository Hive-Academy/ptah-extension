/**
 * @ptah-extension/rpc-handlers
 *
 * Shared RPC handler classes for the Ptah Extension.
 * These handlers are platform-agnostic (no vscode imports) and can be
 * used by both VS Code and Electron applications.
 */

export {
  SessionRpcHandlers,
  ContextRpcHandlers,
  AutocompleteRpcHandlers,
  SubagentRpcHandlers,
  LlmRpcHandlers,
  PluginRpcHandlers,
  PtahCliRpcHandlers,
  SetupRpcHandlers,
  WizardGenerationRpcHandlers,
  ConfigRpcHandlers,
  LicenseRpcHandlers,
  ChatRpcHandlers,
  AuthRpcHandlers,
  EnhancedPromptsRpcHandlers,
  QualityRpcHandlers,
  ProviderRpcHandlers,
  WebSearchRpcHandlers,
  HarnessRpcHandlers,
  McpDirectoryRpcHandlers,
  SkillsShRpcHandlers,
  GitRpcHandlers,
  WorkspaceRpcHandlers,
  SettingsRpcHandlers,
  MemoryRpcHandlers,
  MemRpcHandlers,
  CorpusRpcHandlers,
  SkillsSynthesisRpcHandlers,
  CronRpcHandlers,
  EmbedderRpcHandlers,
  GatewayRpcHandlers,
  VoiceRpcHandlers,
  PersistenceRpcHandlers,
  mintResetChallengeToken,
  IndexingRpcHandlers,
  TasksRpcHandlers,
} from './lib/handlers';
export type {
  DbHealthResult,
  DbHealthParams,
  DbResetParams,
  DbResetResult,
} from './lib/handlers';
export type {
  IPlatformCommands,
  IPlatformAuthProvider,
  ISaveDialogProvider,
  IModelDiscovery,
} from '@ptah-extension/platform-core';
export * from './lib/register-all';
export * from './lib/verify-and-report';
export {
  registerSharedRpcHandlers,
  activateSessionLifecycleNotifier,
} from './lib/register-shared-rpc-handlers';
export { HARNESS_TOKENS, registerHarnessServices } from './lib/harness';
export { CHAT_TOKENS, registerChatServices } from './lib/chat';
export { isAuthorizedWorkspace } from './lib/utils/workspace-authorization';
