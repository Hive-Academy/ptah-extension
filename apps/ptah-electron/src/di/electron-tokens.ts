/**
 * Electron-specific DI tokens for services that are only used in the Electron app.
 * Centralized to avoid duplicate Symbol.for() definitions across consumer files.
 *
 * TASK_2025_228: Centralize DI tokens (Fix #6 from TASK_2025_227 QA review)
 */
export const ELECTRON_TOKENS = {
  GIT_INFO_SERVICE: Symbol.for('GitInfoService'),
  GIT_WATCHER_SERVICE: Symbol.for('GitWatcherService'),
  PTY_MANAGER_SERVICE: Symbol.for('PtyManagerService'),
} as const;
