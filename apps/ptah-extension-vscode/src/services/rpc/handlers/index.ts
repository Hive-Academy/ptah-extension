/**
 * RPC Handlers Index
 *
 * Exports all RPC handler classes for DI registration.
 *
 * TASK_2025_074: Modular RPC handler architecture
 * TASK_2025_079: Added LicenseRpcHandlers for premium feature gating
 * TASK_2025_091: Added OpenRouterRpcHandlers for model selection
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
export { OpenRouterRpcHandlers } from './openrouter-rpc.handlers';
