/**
 * RPC Handlers Index
 *
 * Exports all RPC handler classes for DI registration.
 *
 * TASK_2025_074: Modular RPC handler architecture
 * TASK_2025_079: Added LicenseRpcHandlers for premium feature gating
 * TASK_2025_091: Added OpenRouterRpcHandlers for model selection
 * TASK_2025_103: Added SubagentRpcHandlers for subagent resumption
 * TASK_2025_126: Added CommandRpcHandlers for webview command execution
 * TASK_2025_132: Renamed OpenRouterRpcHandlers -> ProviderRpcHandlers
 * TASK_2025_137: Removed PromptHarnessRpcHandlers, added EnhancedPromptsRpcHandlers
 */

export { ChatRpcHandlers } from './chat-rpc.handlers';
export { SessionRpcHandlers } from './session-rpc.handlers';
export { ContextRpcHandlers } from './context-rpc.handlers';
export { AutocompleteRpcHandlers } from './autocomplete-rpc.handlers';
export { FileRpcHandlers } from './file-rpc.handlers';
export { ConfigRpcHandlers } from './config-rpc.handlers';
export { AuthRpcHandlers } from './auth-rpc.handlers';
export { SetupRpcHandlers } from './setup-rpc.handlers';
export { LicenseRpcHandlers } from './license-rpc.handlers';
export { LlmRpcHandlers } from './llm-rpc.handlers';
export { ProviderRpcHandlers } from './provider-rpc.handlers';
export { SubagentRpcHandlers } from './subagent-rpc.handlers';
export { CommandRpcHandlers } from './command-rpc.handlers';
export { EnhancedPromptsRpcHandlers } from './enhanced-prompts-rpc.handlers';
export { QualityRpcHandlers } from './quality-rpc.handlers';
