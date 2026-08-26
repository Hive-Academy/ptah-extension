/**
 * Coalesces stream messages into `MESSAGE_TYPES.BATCH` envelopes (TASK_2026_323 B7).
 *
 * ## Why this exists
 *
 * `ChatStreamBroadcaster` used to `await broadcastMessage(CHAT_CHUNK, …)` once
 * per SDK stream event, fanned to every registered webview. Three streaming
 * sessions tripled it. Two costs, and the second is the one that hangs the app:
 *
 *  - N postMessage hops per turn instead of N/64.
 *  - Awaiting each hop inside the `for await` loop parks the drain of the SDK
 *    stream behind the renderer. In Electron the backend shares the main
 *    process event loop with `BrowserWindow`, so a slow renderer back-pressures
 *    the `claude.exe` stdout pipe and the whole app stops responding.
 *
 * ## Instance-per-stream, not a shared registry
 *
 * One buffer is constructed per `streamEventsToWebview` call, which is already
 * scoped to exactly one `(sessionId, tabId)` pair. Per-session ordering is then
 * a property of the object graph rather than a rule some future edit has to
 * remember: there is no shared queue for two sessions to interleave in, and no
 * key to get wrong. Three concurrent sessions run three 16 ms timers, which is
 * three flushes per frame against the hundreds of hops this replaces.
 *
 * ## Ordering
 *
 * {@link flush} drains the buffer and calls the sink SYNCHRONOUSLY, so delivery
 * order follows CALL order and never promise-resolution order. This matters
 * because a size-triggered flush is deliberately not awaited: were ordering to
 * depend on when those promises settled, a large batch could land after a
 * smaller one that was queued later. Every transport underneath invokes its
 * real send synchronously (`webview.postMessage(…)` as an argument expression,
 * `EventEmitter.emit`), so a synchronous call is a delivered-in-order call.
 *
 * ## Failure posture
 *
 * A flush NEVER rejects. Losing a chunk must not tear down the stream loop, and
 * an un-awaited rejection would otherwise surface as an unhandled rejection
 * with no owner. Errors go to `onError` and the loop continues.
 */

import type { BatchedMessage } from '@ptah-extension/shared';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

/** Coalescing window. Matches `IpcBridge.STREAM_FLUSH_INTERVAL_MS` — one frame. */
export const STREAM_BATCH_INTERVAL_MS = 16;

/**
 * Flush early once this many messages are buffered.
 *
 * The timer alone is not enough: a burst that arrives faster than the event
 * loop turns would grow the buffer without bound and land as one giant
 * postMessage. The cap converts that into a steady drip.
 */
export const STREAM_BATCH_MAX_EVENTS = 64;

/** Sends one already-built message. Resolves when the transport has taken it. */
export type BatchSink = (type: string, payload: unknown) => Promise<void>;

export interface StreamBatchBufferOptions {
  readonly sink: BatchSink;
  readonly onError: (error: unknown) => void;
  readonly maxEvents?: number;
  readonly intervalMs?: number;
}

export class StreamBatchBuffer {
  private readonly sink: BatchSink;
  private readonly onError: (error: unknown) => void;
  private readonly maxEvents: number;
  private readonly intervalMs: number;

  private readonly pending: BatchedMessage[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(options: StreamBatchBufferOptions) {
    this.sink = options.sink;
    this.onError = options.onError;
    this.maxEvents = options.maxEvents ?? STREAM_BATCH_MAX_EVENTS;
    this.intervalMs = options.intervalMs ?? STREAM_BATCH_INTERVAL_MS;
  }

  /**
   * Buffer a message for the next flush.
   *
   * Never awaited by design — this is called from inside the `for await` loop
   * over the SDK stream, and awaiting here is the defect being fixed.
   */
  push(message: BatchedMessage): void {
    this.pending.push(message);
    if (this.pending.length >= this.maxEvents) {
      this.flush();
      return;
    }
    this.arm();
  }

  /**
   * Drain the buffer now and hand it to the transport.
   *
   * The returned promise settles when the transport has accepted the batch;
   * callers at a turn boundary await it so a `chat:complete` can never overtake
   * the chunks it completes. It resolves rather than rejects on failure.
   */
  flush(): Promise<void> {
    this.disarm();
    if (this.pending.length === 0) return Promise.resolve();
    const events = this.pending.splice(0, this.pending.length);
    return this.send(events);
  }

  /**
   * Await every flush already handed to the transport, including un-awaited
   * size-triggered ones. Used on stream exit so teardown cannot race delivery.
   */
  settle(): Promise<void> {
    return Promise.all([...this.inFlight]).then(() => undefined);
  }

  /**
   * Drop the pending timer. Idempotent, and safe to call with a full buffer —
   * it releases the timer, not the messages.
   */
  dispose(): void {
    this.disarm();
  }

  /** Buffered-but-unsent count. Test seam; not part of the streaming contract. */
  get pendingCount(): number {
    return this.pending.length;
  }

  private send(events: BatchedMessage[]): Promise<void> {
    // A batch of one is sent bare, exactly as `IpcBridge` does. It keeps the
    // common low-traffic case byte-identical to the pre-batching wire format,
    // so a transport that somehow missed the unwrapping still works for
    // everything except bursts.
    const promise = (
      events.length === 1
        ? this.sink(events[0].type, events[0].payload)
        : this.sink(MESSAGE_TYPES.BATCH, { events })
    )
      .catch((error: unknown) => {
        this.onError(error);
      })
      .finally(() => {
        this.inFlight.delete(promise);
      });
    this.inFlight.add(promise);
    return promise;
  }

  private arm(): void {
    if (this.timer !== null) return;
    const timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.intervalMs);
    // Same defect class as commit 5dc525f02: a ref'd timer keeps the Node event
    // loop — and therefore `ptah-cli` — alive after the work is done.
    timer.unref?.();
    this.timer = timer;
  }

  private disarm(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
