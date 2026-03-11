/**
 * DI Exports for VS Code Core
 *
 * TASK_2025_071 Batch 6: Fixed export pattern
 * - TOKENS is exported from main index.ts (@ptah-extension/vscode-core), not here
 * - This file only exports the registration function (consistent with other libraries)
 */
export { registerVsCodeCoreServices } from './register';
