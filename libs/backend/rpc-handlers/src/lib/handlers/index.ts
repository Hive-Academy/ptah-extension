/**
 * Shared RPC Handler Classes.
 *
 * Platform-agnostic RPC handler classes that can be used by both
 * VS Code and Electron applications. These handlers have NO vscode imports
 * and depend only on library-level services via DI tokens.
 *
 * Tier 1 handlers: Zero refactoring needed (no vscode imports).
 * Tier 2 handlers: Refactored to use platform abstractions.
 */
export { SessionRpcHandlers } from './session-rpc.handlers';
export { ContextRpcHandlers } from './context-rpc.handlers';
export { AutocompleteRpcHandlers } from './autocomplete-rpc.handlers';
export { SubagentRpcHandlers } from './subagent-rpc.handlers';
export { LlmRpcHandlers } from './llm-rpc-app.handlers';
export { PluginRpcHandlers } from './plugin-rpc.handlers';
export { PtahCliRpcHandlers } from './ptah-cli-rpc.handlers';
export { SetupRpcHandlers } from './setup-rpc.handlers';
export { WizardGenerationRpcHandlers } from './wizard-generation-rpc.handlers';
export { ConfigRpcHandlers } from './config-rpc.handlers';
export { LicenseRpcHandlers } from './license-rpc.handlers';
export { ChatRpcHandlers } from './chat-rpc.handlers';
export { AuthRpcHandlers } from './auth-rpc.handlers';
export { EnhancedPromptsRpcHandlers } from './enhanced-prompts-rpc.handlers';
export { QualityRpcHandlers } from './quality-rpc.handlers';
export { ProviderRpcHandlers } from './provider-rpc.handlers';
export { WebSearchRpcHandlers } from './web-search-rpc.handlers';
export { HarnessRpcHandlers } from './harness-rpc.handlers';
export { McpDirectoryRpcHandlers } from './mcp-directory-rpc.handlers';
export { SkillsShRpcHandlers } from './skills-sh-rpc.handlers';
export { GitRpcHandlers } from './git-rpc.handlers';
export { WorkspaceRpcHandlers } from './workspace-rpc.handlers';
export { SettingsRpcHandlers } from './settings-rpc.handlers';
export { MemoryRpcHandlers } from './memory-rpc.handlers';
export { IndexingRpcHandlers } from './indexing-rpc.handlers';
export { SkillsSynthesisRpcHandlers } from './skills-synthesis-rpc.handlers';
export { CronRpcHandlers } from './cron-rpc.handlers';
export { GatewayRpcHandlers } from './gateway-rpc.handlers';
export {
  PersistenceRpcHandlers,
  mintResetChallengeToken,
} from './persistence-rpc.handlers';
export type {
  DbHealthResult,
  DbHealthParams,
  DbResetParams,
  DbResetResult,
} from './persistence-rpc.handlers';
