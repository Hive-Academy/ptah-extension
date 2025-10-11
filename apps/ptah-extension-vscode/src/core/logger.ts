/**
 * Logger Re-export Shim
 *
 * This file temporarily re-exports the Logger from vscode-core library
 * to maintain backward compatibility with existing imports.
 *
 * TODO (TASK_CORE_001): Update all imports to use @ptah-extension/vscode-core directly
 */

export { Logger } from '@ptah-extension/vscode-core';
