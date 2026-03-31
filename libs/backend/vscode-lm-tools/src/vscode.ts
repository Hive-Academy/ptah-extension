/**
 * VS Code-specific exports for vscode-lm-tools.
 *
 * This subpath entry (`@ptah-extension/vscode-lm-tools/vscode`) isolates
 * VscodeIDECapabilities — the only class in this library that imports the
 * `vscode` module directly. By exporting it from a separate subpath instead
 * of the main barrel, the Electron bundler never resolves `ide-capabilities.vscode.ts`
 * and avoids hitting the vscode-shim's missing constructors (Position, Range).
 *
 * Only import this from the VS Code DI container (`apps/ptah-extension-vscode`),
 * never from platform-agnostic code.
 */
export { VscodeIDECapabilities } from './lib/code-execution/namespace-builders/ide-capabilities.vscode';
