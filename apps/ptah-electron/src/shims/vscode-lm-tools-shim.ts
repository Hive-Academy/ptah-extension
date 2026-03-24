/**
 * Shim for @ptah-extension/vscode-lm-tools
 *
 * The vscode-lm-tools library depends on vscode APIs and is not available in Electron.
 * agent-sdk imports PTAH_SYSTEM_PROMPT from it. This shim provides the constant
 * so the bundle resolves without pulling in the full VS Code-dependent library.
 */

export const PTAH_SYSTEM_PROMPT = '';
