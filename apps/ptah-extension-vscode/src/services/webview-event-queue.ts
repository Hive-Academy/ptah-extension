/**
 * Webview Event Queue Service
 *
 * Single Responsibility: Manage event queueing before webview initialization
 *
 * SOLID Compliance:
 * - S: Only manages event queue (not webview lifecycle or message routing)
 * - O: Can extend with different queue strategies
 * - L: Substitutable (could implement IEventQueue interface)
 * - I: Focused interface (ready, enqueue, flush, clear)
 * - D: Depends on Logger abstraction
 *
 * Extracted from AngularWebviewProvider to reduce class size from 600+ to <200 lines
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type { WebviewMessage } from '@ptah-extension/shared';

/**
 * Queued event with metadata for debugging
 */
export interface QueuedEvent {
  readonly type: string;
  readonly payload: unknown;
  readonly timestamp: number;
}

/**
 * Maximum queue size to prevent memory leaks
 * If webview never becomes ready, we don't want unbounded memory growth
 */
const MAX_EVENT_QUEUE_SIZE = 100;

/**
 * Webview Event Queue Service
 *
 * Manages event queueing before webview initialization to prevent dropped events
 *
 * Usage:
 * ```typescript
 * // Before sending events
 * if (!queue.isReady()) {
 *   queue.enqueue(message);
 *   return;
 * }
 *
 * // On webview ready
 * queue.markReady();
 * queue.flush((event) => webview.postMessage(event));
 * ```
 */
@injectable()
export class WebviewEventQueue {
  private _isReady = false;
  private _queue: QueuedEvent[] = [];

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    this.logger.info('WebviewEventQueue initialized');
  }

  /**
   * Check if webview is ready to receive events
   */
  isReady(): boolean {
    return this._isReady;
  }

  /**
   * Get current queue size
   */
  getQueueSize(): number {
    return this._queue.length;
  }

  /**
   * Mark webview as ready
   * Should be called when webview sends 'webview-ready' message
   */
  markReady(): void {
    if (this._isReady) {
      this.logger.debug('WebviewEventQueue: Already marked as ready');
      return;
    }

    this._isReady = true;
    this.logger.info(
      `WebviewEventQueue: Marked as ready (${this._queue.length} events queued)`
    );
  }

  /**
   * Reset ready state
   * Should be called when webview reloads or is disposed
   */
  reset(): void {
    this._isReady = false;
    this.logger.info('WebviewEventQueue: Reset to not ready');
  }

  /**
   * Enqueue event for later delivery
   * Enforces maximum queue size to prevent memory leaks
   *
   * @param message - WebviewMessage to queue
   * @returns true if queued successfully, false if ready (caller should send directly)
   */
  enqueue(message: WebviewMessage): boolean {
    // If already ready, don't queue
    if (this._isReady) {
      return false;
    }

    // Check queue size limit
    if (this._queue.length >= MAX_EVENT_QUEUE_SIZE) {
      this.logger.warn(
        `WebviewEventQueue: Queue full (${MAX_EVENT_QUEUE_SIZE}), dropping oldest event to queue: ${message.type}`
      );
      // Remove oldest event (FIFO)
      this._queue.shift();
    }

    // Queue event
    this._queue.push({
      type: message.type,
      payload: message.payload,
      timestamp: Date.now(),
    });

    this.logger.debug(
      `WebviewEventQueue: Queued ${message.type} (size: ${this._queue.length}/${MAX_EVENT_QUEUE_SIZE})`
    );

    return true;
  }

  /**
   * Flush all queued events
   * Events are delivered in FIFO order (preserves temporal ordering)
   *
   * @param deliveryFn - Function to deliver each event (e.g., webview.postMessage)
   */
  flush(deliveryFn: (event: WebviewMessage) => void): void {
    if (this._queue.length === 0) {
      this.logger.debug('WebviewEventQueue: Nothing to flush');
      return;
    }

    const queuedCount = this._queue.length;
    this.logger.info(`WebviewEventQueue: Flushing ${queuedCount} events`);

    // Deliver all queued events in order
    const events = [...this._queue]; // Copy to avoid modification during iteration
    this._queue = []; // Clear queue before delivery

    let successCount = 0;
    let errorCount = 0;

    for (const event of events) {
      try {
        const ageMs = Date.now() - event.timestamp;
        this.logger.debug(
          `WebviewEventQueue: Delivering ${event.type} (queued ${ageMs}ms ago)`
        );

        // Deliver event
        deliveryFn({
          type: event.type,
          payload: event.payload,
        } as WebviewMessage);

        successCount++;
      } catch (error) {
        errorCount++;
        this.logger.error(
          `WebviewEventQueue: Failed to deliver ${event.type}`,
          {
            error,
            event,
          }
        );
      }
    }

    this.logger.info(
      `WebviewEventQueue: Flush complete (${successCount} delivered, ${errorCount} failed)`
    );
  }

  /**
   * Clear all queued events without delivering
   * Should be called on dispose or when events are no longer relevant
   */
  clear(): void {
    if (this._queue.length > 0) {
      this.logger.warn(
        `WebviewEventQueue: Clearing ${this._queue.length} undelivered events`
      );
      this._queue = [];
    }
  }

  /**
   * Get queue metrics for monitoring
   */
  getMetrics() {
    return {
      isReady: this._isReady,
      queueSize: this._queue.length,
      maxQueueSize: MAX_EVENT_QUEUE_SIZE,
      queueUtilization: (this._queue.length / MAX_EVENT_QUEUE_SIZE) * 100,
      oldestEventAge:
        this._queue.length > 0 ? Date.now() - this._queue[0].timestamp : 0,
    };
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.clear();
    this._isReady = false;
    this.logger.info('WebviewEventQueue disposed');
  }
}
