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
import type {
  IHostAttentionIngress,
  IHostAttentionObserverHost,
} from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';

/**
 * Synchronous observer of every emitted push event, called once per
 * de-batched event immediately BEFORE that event is emitted to listeners.
 *
 * Contract: observe synchronously and return. A tap never performs I/O, never
 * awaits, and never mutates `payload` — the remote worker's tap only enqueues
 * the event into its own capture queue, which owns ordering and persistence.
 * A tap that throws is isolated: the error is logged by name only and the
 * event (and every later one) is still emitted.
 */
export type CliPushTap = (type: string, payload: unknown) => void;

export interface CliWebviewManagerAdapterOptions {
  /** See {@link CliPushTap}. */
  readonly tap?: CliPushTap;
  /** Receives the tap-failure line (error name only — never message or payload). */
  readonly logger?: Pick<Logger, 'error'>;
}

export class CliWebviewManagerAdapter
  extends EventEmitter
  implements IHostAttentionObserverHost
{
  private readonly tap?: CliPushTap;
  private readonly tapLogger?: Pick<Logger, 'error'>;

  constructor(options: CliWebviewManagerAdapterOptions = {}) {
    super();
    this.tap = options.tap;
    this.tapLogger = options.logger;
  }

  private attentionRegistration?: {
    observer: IHostAttentionIngress;
    logger?: Pick<Logger, 'error'>;
  };

  setAttentionObserver(
    observer: IHostAttentionIngress,
    logger?: Pick<Logger, 'error'>,
  ): { dispose(): void } {
    const registration = { observer, logger };
    this.attentionRegistration = registration;
    return {
      dispose: () => {
        if (this.attentionRegistration === registration) {
          this.attentionRegistration = undefined;
        }
      },
    };
  }

  private observeAttention(type: string, payload: unknown): void {
    try {
      this.attentionRegistration?.observer.observe(type, payload);
    } catch (error: unknown) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      this.attentionRegistration?.logger?.error(
        `[CliWebviewManagerAdapter] Attention observer failed: ${name}`,
      );
    }
  }

  /**
   * Send a typed message (backend -> TUI).
   * Matches the interface contract from webview-manager-adapter.ts:46-53.
   */
  async sendMessage(
    _viewType: string,
    type: string,
    payload: unknown,
  ): Promise<boolean> {
    this.observeAttention(type, payload);
    this.dispatch(type, payload);
    return true;
  }

  /**
   * Broadcast a message to all views (same as sendMessage in CLI, single "view").
   * Matches the interface contract from webview-manager-adapter.ts:65-68.
   */
  async broadcastMessage(type: string, payload: unknown): Promise<void> {
    this.observeAttention(type, payload);
    this.dispatch(type, payload);
  }

  /**
   * List the surfaces push events can reach.
   *
   * The CLI and TUI render no surfaces — there is no dashboard page and no
   * webview; the tool result itself IS the whole answer there. An empty list
   * is therefore the honest, successful answer: `createDashboardBroadcast`
   * reads it as `no-surface`, a success rather than a failure. This method
   * never throws — there is no window lifecycle to race.
   */
  getActiveWebviews(): readonly string[] {
    return [];
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
      this.deliver(type, payload);
      return;
    }
    const events = (payload as BatchMessagePayload | undefined)?.events;
    if (!Array.isArray(events)) return;
    for (const event of events) {
      if (!event || typeof event.type !== 'string') continue;
      this.deliver(event.type, event.payload);
    }
  }

  /** Tap first, then emit — one concrete (already de-batched) event. */
  private deliver(type: string, payload: unknown): void {
    this.observeTap(type, payload);
    this.emit(type, payload);
  }

  private observeTap(type: string, payload: unknown): void {
    if (!this.tap) return;
    try {
      this.tap(type, payload);
    } catch (error: unknown) {
      // Isolated on purpose: a failing observer must not silence the local
      // listeners. Only the error name is logged, because a message could
      // carry payload text.
      const name = error instanceof Error ? error.name : 'UnknownError';
      this.tapLogger?.error(
        `[CliWebviewManagerAdapter] Push tap failed: ${name}`,
      );
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
