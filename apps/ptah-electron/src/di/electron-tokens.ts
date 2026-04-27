/**
 * Electron-specific DI tokens for services that are only used in the Electron app.
 * Centralized to avoid duplicate Symbol.for() definitions across consumer files.
 *
 * TASK_2025_228: Centralize DI tokens (Fix #6 from TASK_2025_227 QA review)
 * TASK_2026_104 Sub-batch B5b: GIT_INFO_SERVICE lifted to
 * `@ptah-extension/vscode-core` TOKENS so all three apps (VS Code, Electron, CLI)
 * share the same Symbol.for('GitInfoService') registration.
 */
export const ELECTRON_TOKENS = {
  GIT_WATCHER_SERVICE: Symbol.for('GitWatcherService'),
  PTY_MANAGER_SERVICE: Symbol.for('PtyManagerService'),
} as const;
