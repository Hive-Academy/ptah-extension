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

import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { BatchMessagePayload } from '@ptah-extension/shared';

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
    this.dispatch(type, payload);
    return true;
  }

  /**
   * Broadcast a message to all views (same as sendMessage in CLI, single "view").
   * Matches the interface contract from webview-manager-adapter.ts:65-68.
   */
  async broadcastMessage(type: string, payload: unknown): Promise<void> {
    this.dispatch(type, payload);
  }

  /**
   * Emit one message, unwrapping a batch into its members first.
   *
   * This transport uses the message `type` as the EventEmitter event NAME, so
   * subscribers are bound to concrete names — `pushAdapter.on('chat:chunk', …)`
   * in `chat-bridge`, `session-submit.service`, `anthropic-proxy.service` and
   * the TUI's `use-chat`. A `MESSAGE_TYPES.BATCH` message therefore reaches
   * NOBODY unless it is expanded here: there is no wildcard listener and no
   * fallback, so the failure mode is silence, not an error.
   *
   * `ChatStreamBroadcaster` began coalescing chunks into batches in
   * TASK_2026_323 (B7), which is what made this necessary. It is the same
   * unwrapping `MessageRouterService` does for the two webview hosts, and it
   * is deliberately NOT gated behind a capability flag — a transport that
   * cannot de-batch is a broken transport, not a configuration.
   */
  private dispatch(type: string, payload: unknown): void {
    if (type !== MESSAGE_TYPES.BATCH) {
      this.emit(type, payload);
      return;
    }
    const events = (payload as BatchMessagePayload | undefined)?.events;
    if (!Array.isArray(events)) return;
    for (const event of events) {
      if (!event || typeof event.type !== 'string') continue;
      this.emit(event.type, event.payload);
    }
  }

  /**
   * Always visible in CLI (single view).
   * Matches webview-manager-adapter.ts:78-82.
   */
  isVisible(_viewType?: string): boolean {
    return true;
  }
}
