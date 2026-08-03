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
export { TerminalRpcHandlers } from './terminal-rpc.handlers';
export { UpdateRpcHandlers } from './update-rpc.handlers';
