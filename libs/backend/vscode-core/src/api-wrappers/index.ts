/**
 * API Wrappers Module Exports
 * Provides centralized access to all VS Code API wrapper components
 */

export { CommandManager } from './command-manager';
export type { 
  CommandDefinition,
  CommandExecutedPayload,
  CommandErrorPayload
} from './command-manager';

export { WebviewManager } from './webview-manager';
export type {
  WebviewPanelConfig,
  WebviewMessagePayload,
  WebviewCreatedPayload,
  WebviewDisposedPayload
} from './webview-manager';