/**
 * Electron WebviewManager Adapter
 *
 * Provides a WebviewManager-compatible interface for Electron that sends
 * messages to the renderer via the IpcBridge. This adapter is registered
 * as TOKENS.WEBVIEW_MANAGER in the DI container so that backend services
 * (RpcMethodRegistrationService, AgentSessionWatcherService, etc.) can
 * push events to the frontend without knowing about Electron IPC.
 *
 * In VS Code, WebviewManager wraps VS Code's webview panel postMessage API.
 * In Electron, we delegate to IpcBridge.sendToRenderer() which uses
 * webContents.send('to-renderer', message).
 *
 * The interface contract expected by consumers (from the VS Code app):
 *   sendMessage(viewType: string, type: string, payload: unknown): Promise<boolean>
 *   broadcastMessage(type: string, payload: unknown): Promise<boolean>
 */

import type { IpcBridge } from './ipc-bridge';

/**
 * Electron-compatible WebviewManager adapter.
 *
 * Satisfies the WebviewManager interface used by TOKENS.WEBVIEW_MANAGER consumers.
 * All messages are routed through the IpcBridge to the single renderer window.
 *
 * In Electron there is only one renderer (the BrowserWindow), so sendMessage
 * and broadcastMessage behave identically -- both send to the same window.
 */
export class ElectronWebviewManagerAdapter {
  constructor(private readonly ipcBridge: IpcBridge) {}

  /**
   * Send a typed message to a specific webview.
   *
   * In VS Code this targets a specific webview panel by viewType.
   * In Electron there is only one renderer, so viewType is ignored
   * and the message is sent to the BrowserWindow.
   *
   * @param _viewType - Ignored in Electron (single window)
   * @param type - Message type (e.g., MESSAGE_TYPES.CHAT_CHUNK)
   * @param payload - Message payload
   */
  async sendMessage(
    _viewType: string,
    type: string,
    payload: unknown,
  ): Promise<boolean> {
    this.ipcBridge.sendToRenderer({ type, payload });
    return true;
  }

  /**
   * Broadcast a message to all webviews.
   *
   * In VS Code this iterates over all registered webview panels.
   * In Electron there is only one renderer, so this sends to the
   * single BrowserWindow.
   *
   * @param type - Message type (e.g., MESSAGE_TYPES.SESSION_STATS)
   * @param payload - Message payload
   */
  async broadcastMessage(type: string, payload: unknown): Promise<void> {
    this.ipcBridge.sendToRenderer({ type, payload });
  }

  /**
   * Check if a webview of the given type is currently visible.
   *
   * In Electron the single renderer is always "visible" when the window exists.
   * Returns true when the IpcBridge has a window available.
   *
   * @param _viewType - Ignored in Electron
   * @returns true if the BrowserWindow is available
   */
  isVisible(_viewType?: string): boolean {
    // The bridge itself checks for window availability in sendToRenderer,
    // so we return true to indicate messages can be sent.
    return true;
  }
}
