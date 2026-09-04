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

/**
 * Maximum batches handed to the transport concurrently.
 *
 * Four allows a few frame-length sends to overlap without letting a stalled
 * view retain an unbounded tail of 64-event payloads.
 */
export const STREAM_BATCH_MAX_IN_FLIGHT = 4;

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
  private blockedFlush: Promise<void> | null = null;

  constructor(options: StreamBatchBufferOptions) {
    this.sink = options.sink;
    this.onError = options.onError;
    this.maxEvents = options.maxEvents ?? STREAM_BATCH_MAX_EVENTS;
    this.intervalMs = options.intervalMs ?? STREAM_BATCH_INTERVAL_MS;
  }

  /**
   * Buffer a message for the next flush.
   *
   * The normal path returns `undefined`: coalescing must not allocate a promise
   * or wait on the transport for every SDK event. Only a full transport window
   * returns a promise, giving the producer one bounded back-pressure point.
   */
  push(message: BatchedMessage): void | Promise<void> {
    this.pending.push(message);
    if (this.pending.length >= this.maxEvents) {
      void this.flush();
    } else {
      this.arm();
    }

    if (this.inFlight.size < STREAM_BATCH_MAX_IN_FLIGHT) return;
    return Promise.race(this.inFlight);
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
    if (this.inFlight.size >= STREAM_BATCH_MAX_IN_FLIGHT) {
      return this.deferFlushUntilCapacity();
    }
    const events = this.pending.splice(0, this.pending.length);
    return this.send(events);
  }

  /**
   * Await every flush already handed to the transport, including un-awaited
   * size-triggered ones. Used on stream exit so teardown cannot race delivery.
   *
   * A flush DEFERRED at the in-flight cap is awaited too, and it has to be. Its
   * events are still in `pending`, so they are in no promise this set holds —
   * settling on `inFlight` alone would return while a whole batch was still
   * waiting for capacity, and the caller tears the session down immediately
   * afterwards. That batch is deferred precisely when the transport is slow,
   * which is the case this cap exists to handle.
   *
   * `blockedFlush` resolves to the flush it eventually performs, so awaiting it
   * awaits the real send. It cannot stall: it waits on `Promise.race(inFlight)`
   * and is only ever created while that set is non-empty.
   */
  settle(): Promise<void> {
    const landed: Promise<void>[] = [...this.inFlight];
    if (this.blockedFlush !== null) landed.push(this.blockedFlush);
    return Promise.all(landed).then(() => undefined);
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

  /** Transport sends currently retaining their payload. Test seam only. */
  get inFlightCount(): number {
    return this.inFlight.size;
  }

  private deferFlushUntilCapacity(): Promise<void> {
    if (this.blockedFlush !== null) return this.blockedFlush;

    // Wait before splicing. Once capacity opens, `flush()` still removes the
    // events and invokes the sink in one synchronous step, preserving call
    // order even though earlier transport promises may settle later.
    const blockedFlush = Promise.race(this.inFlight).then(() => {
      if (this.blockedFlush === blockedFlush) {
        this.blockedFlush = null;
      }
      return this.flush();
    });
    this.blockedFlush = blockedFlush;
    return blockedFlush;
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
