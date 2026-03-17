/**
 * Electron RPC Handlers Index
 *
 * Exports all Electron-specific RPC handler classes.
 * Shared handlers are imported directly from @ptah-extension/rpc-handlers
 * by the orchestrator and DI container.
 *
 * TASK_2025_203 Batch 5: Electron RPC handler extraction
 */

export { ElectronWorkspaceRpcHandlers } from './electron-workspace-rpc.handlers';
export { ElectronEditorRpcHandlers } from './electron-editor-rpc.handlers';
export { ElectronFileRpcHandlers } from './electron-file-rpc.handlers';
export { ElectronLlmRpcHandlers } from './electron-llm-rpc.handlers';
export { ElectronChatExtendedRpcHandlers } from './electron-chat-extended-rpc.handlers';
export { ElectronConfigExtendedRpcHandlers } from './electron-config-extended-rpc.handlers';
export { ElectronSessionExtendedRpcHandlers } from './electron-session-extended-rpc.handlers';
export { ElectronCommandRpcHandlers } from './electron-command-rpc.handlers';
export { ElectronAgentRpcHandlers } from './electron-agent-rpc.handlers';
export { ElectronLayoutRpcHandlers } from './electron-layout-rpc.handlers';
export { ElectronAuthExtendedRpcHandlers } from './electron-auth-extended-rpc.handlers';
