/**
 * DI Exports for VS Code Core
 *
 * Note on export pattern:
 * - TOKENS is exported from main index.ts (@ptah-extension/vscode-core), not here
 * - This file only exports the registration function (consistent with other libraries)
 */
export { registerVsCodeCoreServices } from './register';
