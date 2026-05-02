/**
 * Shared RPC Handler Classes (TASK_2025_203)
 *
 * Platform-agnostic RPC handler classes that can be used by both
 * VS Code and Electron applications. These handlers have NO vscode imports
 * and depend only on library-level services via DI tokens.
 *
 * Tier 1 handlers: Zero refactoring needed (no vscode imports)
 * Tier 2 handlers: Refactored to use platform abstractions (TASK_2025_203 Batch 3+4)
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

// Tier 2 handlers (Batch 4 - require additional platform abstractions)
export { AuthRpcHandlers } from './auth-rpc.handlers';
export { EnhancedPromptsRpcHandlers } from './enhanced-prompts-rpc.handlers';
export { QualityRpcHandlers } from './quality-rpc.handlers';
export { ProviderRpcHandlers } from './provider-rpc.handlers';

// Tier 2 handlers (TASK_2025_235 - web search settings)
export { WebSearchRpcHandlers } from './web-search-rpc.handlers';

// Harness Setup Builder handlers
export { HarnessRpcHandlers } from './harness-rpc.handlers';

// MCP Server Directory handlers (TASK_2026_104 Batch 6a — lifted from VS Code app)
export { McpDirectoryRpcHandlers } from './mcp-directory-rpc.handlers';

// Git handlers (TASK_2026_104 Sub-batch B5b — lifted from Electron app)
export { GitRpcHandlers } from './git-rpc.handlers';

// Workspace handlers (TASK_2026_104 Sub-batch B5a — lifted from Electron app)
export { WorkspaceRpcHandlers } from './workspace-rpc.handlers';

// Settings handlers (TASK_2026_107 Bug 6 — lifted from Electron app)
export { SettingsRpcHandlers } from './settings-rpc.handlers';

// === TRACK_1_MEMORY_CURATOR_BEGIN ===
// Memory curator handlers (TASK_2026_HERMES Track 1)
export { MemoryRpcHandlers } from './memory-rpc.handlers';
// === TRACK_1_MEMORY_CURATOR_END ===

// === TRACK_2_SKILL_SYNTHESIS_BEGIN ===
// Skill synthesis handlers (TASK_2026_HERMES Track 2)
export { SkillsSynthesisRpcHandlers } from './skills-synthesis-rpc.handlers';
// === TRACK_2_SKILL_SYNTHESIS_END ===

// === TRACK_4_MESSAGING_GATEWAY_BEGIN ===
// Messaging gateway handlers (TASK_2026_HERMES Track 4)
export { GatewayRpcHandlers } from './gateway-rpc.handlers';
// === TRACK_4_MESSAGING_GATEWAY_END ===
