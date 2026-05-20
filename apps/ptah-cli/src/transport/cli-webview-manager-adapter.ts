/**
 * CLI WebviewManager adapter -- emits push events on an EventEmitter.
 *
 * Backend services call sendMessage(viewType, type, payload) to push events.
 * The TUI subscribes to this EventEmitter for real-time updates.
 *
 * Event name: the message `type` (e.g., 'chat:chunk', 'session:stats')
 * Event data: the `payload` object
 *
 * Replaces:
 * - ElectronWebviewManagerAdapter -> IpcBridge.sendToRenderer() -> webContents.send()
 * - VS Code WebviewManager -> webview.postMessage()
 */

import { EventEmitter } from 'events';

export class CliWebviewManagerAdapter extends EventEmitter {
  /**
   * Send a typed message (backend -> TUI).
   * Matches the interface contract from webview-manager-adapter.ts:46-53.
   */
  async sendMessage(
    _viewType: string,
    type: string,
    payload: unknown,
  ): Promise<boolean> {
    this.emit(type, payload);
    return true;
  }

  /**
   * Broadcast a message to all views (same as sendMessage in CLI, single "view").
   * Matches the interface contract from webview-manager-adapter.ts:65-68.
   */
  async broadcastMessage(type: string, payload: unknown): Promise<void> {
    this.emit(type, payload);
  }

  /**
   * Always visible in CLI (single view).
   * Matches webview-manager-adapter.ts:78-82.
   */
  isVisible(_viewType?: string): boolean {
    return true;
  }
}
