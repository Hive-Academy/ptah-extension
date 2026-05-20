/**
 * Electron-specific DI tokens for services that are only used in the Electron app.
 * Centralized to avoid duplicate Symbol.for() definitions across consumer files.
 *
 * GIT_INFO_SERVICE lives in `@ptah-extension/vscode-core` TOKENS so all three
 * apps (VS Code, Electron, CLI) share the same Symbol.for('GitInfoService')
 * registration.
 */
export const ELECTRON_TOKENS = {
  GIT_WATCHER_SERVICE: Symbol.for('GitWatcherService'),
  PTY_MANAGER_SERVICE: Symbol.for('PtyManagerService'),
} as const;
