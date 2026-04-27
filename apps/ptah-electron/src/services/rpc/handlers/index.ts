/**
 * Electron RPC Handlers Index
 *
 * Exports all Electron-specific RPC handler classes.
 * Shared handlers are imported directly from @ptah-extension/rpc-handlers
 * by the orchestrator and DI container.
 *
 * TASK_2025_203 Batch 5: Electron RPC handler extraction.
 * TASK_2025_209: Removed the Electron-prefixed LlmRpcHandlers and
 *   ChatExtendedRpcHandlers (both unified into the shared versions in
 *   libs/backend/rpc-handlers). Re-added electron-specific AgentRpcHandlers,
 *   SkillsShRpcHandlers, and LayoutRpcHandlers.
 * TASK_2025_291 Wave C6: dropped the redundant `Electron` prefix from file
 *   and class names; folder location already disambiguates from the vscode
 *   app's handlers and from the shared library.
 */

// TASK_2026_104 Sub-batch B5a: WorkspaceRpcHandlers lifted to
// `@ptah-extension/rpc-handlers` SHARED_HANDLERS. No longer Electron-local.
export { EditorRpcHandlers } from './editor-rpc.handlers';
export { FileRpcHandlers } from './file-rpc.handlers';
export { ConfigExtendedRpcHandlers } from './config-extended-rpc.handlers';
export { CommandRpcHandlers } from './command-rpc.handlers';
export { SettingsRpcHandlers } from './settings-rpc.handlers';
export { AgentRpcHandlers } from './agent-rpc.handlers';
export { SkillsShRpcHandlers } from './skills-sh-rpc.handlers';
export { LayoutRpcHandlers } from './layout-rpc.handlers';
// TASK_2026_104 Sub-batch B5b: GitRpcHandlers lifted to
// `@ptah-extension/rpc-handlers` SHARED_HANDLERS. No longer Electron-local.
export { TerminalRpcHandlers } from './terminal-rpc.handlers';
