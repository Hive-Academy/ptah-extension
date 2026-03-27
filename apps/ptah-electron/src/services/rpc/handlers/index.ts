/**
 * Electron RPC Handlers Index
 *
 * Exports all Electron-specific RPC handler classes.
 * Shared handlers are imported directly from @ptah-extension/rpc-handlers
 * by the orchestrator and DI container.
 *
 * TASK_2025_203 Batch 5: Electron RPC handler extraction
 * TASK_2025_209: Removed ElectronLlmRpcHandlers (unified into shared LlmRpcHandlers),
 *   ElectronChatExtendedRpcHandlers (unified into shared ChatRpcHandlers)
 * Re-added ElectronAgentRpcHandlers, ElectronSkillsShRpcHandlers, ElectronLayoutRpcHandlers
 * with proper Electron-specific implementations.
 */

export { ElectronWorkspaceRpcHandlers } from './electron-workspace-rpc.handlers';
export { ElectronEditorRpcHandlers } from './electron-editor-rpc.handlers';
export { ElectronFileRpcHandlers } from './electron-file-rpc.handlers';
export { ElectronConfigExtendedRpcHandlers } from './electron-config-extended-rpc.handlers';
export { ElectronCommandRpcHandlers } from './electron-command-rpc.handlers';
export { ElectronAuthExtendedRpcHandlers } from './electron-auth-extended-rpc.handlers';
export { ElectronSettingsRpcHandlers } from './electron-settings-rpc.handlers';
export { ElectronAgentRpcHandlers } from './electron-agent-rpc.handlers';
export { ElectronSkillsShRpcHandlers } from './electron-skills-sh-rpc.handlers';
export { ElectronLayoutRpcHandlers } from './electron-layout-rpc.handlers';
export { ElectronGitRpcHandlers } from './electron-git-rpc.handlers';
export { ElectronTerminalRpcHandlers } from './electron-terminal-rpc.handlers';
