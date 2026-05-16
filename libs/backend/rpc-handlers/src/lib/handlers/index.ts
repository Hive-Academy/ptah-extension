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

// Tier 1 handlers (no refactoring needed)
export { SessionRpcHandlers } from './session-rpc.handlers';
export { ContextRpcHandlers } from './context-rpc.handlers';
export { AutocompleteRpcHandlers } from './autocomplete-rpc.handlers';
export { SubagentRpcHandlers } from './subagent-rpc.handlers';
export { LlmRpcHandlers } from './llm-rpc-app.handlers';
export { PluginRpcHandlers } from './plugin-rpc.handlers';
export { PtahCliRpcHandlers } from './ptah-cli-rpc.handlers';

// Tier 2 handlers (refactored to use platform abstractions)
export { SetupRpcHandlers } from './setup-rpc.handlers';
export { WizardGenerationRpcHandlers } from './wizard-generation-rpc.handlers';
export { ConfigRpcHandlers } from './config-rpc.handlers';
export { LicenseRpcHandlers } from './license-rpc.handlers';
export { ChatRpcHandlers } from './chat-rpc.handlers';

// Tier 2 handlers (require additional platform abstractions)
export { AuthRpcHandlers } from './auth-rpc.handlers';
export { EnhancedPromptsRpcHandlers } from './enhanced-prompts-rpc.handlers';
export { QualityRpcHandlers } from './quality-rpc.handlers';
export { ProviderRpcHandlers } from './provider-rpc.handlers';

// Tier 2 handlers - web search settings
export { WebSearchRpcHandlers } from './web-search-rpc.handlers';

// Harness Setup Builder handlers
export { HarnessRpcHandlers } from './harness-rpc.handlers';

// MCP Server Directory handlers - lifted from VS Code app
export { McpDirectoryRpcHandlers } from './mcp-directory-rpc.handlers';

// Git handlers - lifted from Electron app
export { GitRpcHandlers } from './git-rpc.handlers';

// Workspace handlers - lifted from Electron app
export { WorkspaceRpcHandlers } from './workspace-rpc.handlers';

// Settings handlers - lifted from Electron app
export { SettingsRpcHandlers } from './settings-rpc.handlers';

// Memory curator handlers
export { MemoryRpcHandlers } from './memory-rpc.handlers';

// Workspace indexing control handlers
export { IndexingRpcHandlers } from './indexing-rpc.handlers';

// Skill synthesis handlers
export { SkillsSynthesisRpcHandlers } from './skills-synthesis-rpc.handlers';

// Cron scheduler handlers
export { CronRpcHandlers } from './cron-rpc.handlers';

// Messaging gateway handlers
export { GatewayRpcHandlers } from './gateway-rpc.handlers';

// Persistence health + reset handlers
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
