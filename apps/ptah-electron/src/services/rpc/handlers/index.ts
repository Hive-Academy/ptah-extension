/**
 * Electron RPC Handlers Index
 *
 * Exports all Electron-specific RPC handler classes.
 * Shared handlers are imported directly from @ptah-extension/rpc-handlers
 * by the orchestrator and DI container.
 *
 * WorkspaceRpcHandlers, SettingsRpcHandlers, and GitRpcHandlers live in
 * `@ptah-extension/rpc-handlers` SHARED_HANDLERS.
 */

export { EditorRpcHandlers } from './editor-rpc.handlers';
export { FileRpcHandlers } from './file-rpc.handlers';
export { ConfigExtendedRpcHandlers } from './config-extended-rpc.handlers';
export { CommandRpcHandlers } from './command-rpc.handlers';
export { AgentRpcHandlers } from './agent-rpc.handlers';
export { SkillsShRpcHandlers } from './skills-sh-rpc.handlers';
export { LayoutRpcHandlers } from './layout-rpc.handlers';
export { TerminalRpcHandlers } from './terminal-rpc.handlers';
// Electron-local auto-update RPC handlers.
export { UpdateRpcHandlers } from './update-rpc.handlers';
