/**
 * Platform DI Tokens
 *
 * DI tokens for platform abstraction interfaces.
 * Follows the Symbol.for() convention from vscode-core/src/di/tokens.ts
 *
 * Convention: All tokens use Symbol.for('PlatformXxx') to ensure
 * global uniqueness and cross-module resolution.
 */

export const PLATFORM_TOKENS = {
  /** IFileSystemProvider — file read/write/watch/search */
  FILE_SYSTEM_PROVIDER: Symbol.for('PlatformFileSystemProvider'),

  /** IStateStorage — global state (replaces TOKENS.GLOBAL_STATE / vscode.Memento) */
  STATE_STORAGE: Symbol.for('PlatformStateStorage'),

  /** IStateStorage — workspace-scoped state (replaces context.workspaceState) */
  WORKSPACE_STATE_STORAGE: Symbol.for('PlatformWorkspaceStateStorage'),

  /** ISecretStorage — secure credential storage */
  SECRET_STORAGE: Symbol.for('PlatformSecretStorage'),

  /** IWorkspaceProvider — workspace folders and configuration */
  WORKSPACE_PROVIDER: Symbol.for('PlatformWorkspaceProvider'),

  /** IUserInteraction — error/warning/info messages, quick pick, input box */
  USER_INTERACTION: Symbol.for('PlatformUserInteraction'),

  /** IOutputChannel — logging output channel */
  OUTPUT_CHANNEL: Symbol.for('PlatformOutputChannel'),

  /** ICommandRegistry — command registration and execution */
  COMMAND_REGISTRY: Symbol.for('PlatformCommandRegistry'),

  /** IEditorProvider — active editor and document events */
  EDITOR_PROVIDER: Symbol.for('PlatformEditorProvider'),

  /** IPlatformInfo — platform type, extension path, storage paths */
  PLATFORM_INFO: Symbol.for('PlatformInfo'),

  /** ITokenCounter — platform-agnostic token counting */
  TOKEN_COUNTER: Symbol.for('PlatformTokenCounter'),

  /** IDiagnosticsProvider — workspace diagnostics (errors, warnings) */
  DIAGNOSTICS_PROVIDER: Symbol.for('PlatformDiagnosticsProvider'),
} as const;
