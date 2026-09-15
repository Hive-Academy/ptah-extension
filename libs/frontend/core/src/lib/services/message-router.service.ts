/**
 * Message Router Service - Centralized message dispatch for VS Code webview messages
 *
 * Replaces the fragile lazy-setter routing in VSCodeService with a clean
 * handler registration pattern using Angular's multi-provider InjectionToken.
 *
 * Architecture:
 * - Collects all MessageHandler instances via MESSAGE_HANDLERS token at bootstrap
 * - Builds a Map<string, MessageHandler[]> for O(1) dispatch
 * - Sets up window.addEventListener('message') listener
 * - Zero lazy setters, zero `any` types, zero circular deps
 *
 * Burst coalescing (TASK_2026_437 C18, INV-11):
 * - The `message` listener is attached outside Angular, so an inbound event
 *   does not enter the zone. It only appends to a FIFO queue.
 * - One macrotask (`scheduleMacrotask`, a `MessageChannel` message) drains the
 *   queue inside ONE `ngZone.run`, so a burst of N messages (typical after a
 *   main-process stall) costs one zone entry and one change-detection pass
 *   instead of N.
 * - `NgZone` is always injectable: the Zone-based webview shell gets the real
 *   zone, a zoneless host gets the no-op zone whose `run` /
 *   `runOutsideAngular` just call the function. Nothing here depends on
 *   Zone patching.
 * - Drain bound: a drain takes the queue as it stands when the drain starts.
 *   Messages enqueued while it runs (a handler dispatching a synchronous
 *   `message` event) land in a fresh queue and get their own drain task, so
 *   one drain never loops unboundedly and arrival order is kept.
 * - RPC ordering (R-P8): an `rpc:response` flushes the queue synchronously,
 *   in the task it arrived in. `rpc-call.util.ts` resolves the same response
 *   on its own window listener, so without the flush an awaiting caller would
 *   resume before earlier pushes were dispatched, and before later ones for
 *   `ClaudeRpcService`. The listener uses the capture phase so this flush
 *   runs before that bubble-phase listener no matter which registered first.
 *   A BATCH carrying an `rpc:response` member gets the same flush; no producer
 *   batches responses, so that case is also reported as a producer regression.
 * - Errors: each dispatched message (each BATCH member included) is isolated
 *   and reported to Angular's `ErrorHandler`; so is a malformed BATCH envelope
 *   and a drain wake-up that fails to post (the drain then runs synchronously
 *   rather than wedging the queue).
 */

import {
  APP_INITIALIZER,
  DestroyRef,
  ErrorHandler,
  Injectable,
  NgZone,
  inject,
} from '@angular/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { scheduleMacrotask, type MacrotaskHandle } from './macrotask-scheduler';
import { MESSAGE_HANDLERS, MessageHandler } from './message-router.types';

interface BatchedStreamEvent {
  readonly type: string;
  readonly payload?: unknown;
}

interface InboundMessage {
  readonly type: string;
  readonly payload?: unknown;
}

/**
 * Capture phase is load-bearing: it runs the R-P8 `rpc:response` flush before
 * `rpc-call.util.ts`'s bubble-phase listener, whichever registered first. See
 * "RPC ordering" in the file header.
 */
const LISTENER_OPTIONS: AddEventListenerOptions = { capture: true };

/** `payload.events` of a well-formed BATCH envelope, or `null`. */
function batchEvents(message: { payload?: unknown }): unknown[] | null {
  const payload = message.payload;
  if (!payload || typeof payload !== 'object') return null;
  const events = (payload as { events?: unknown }).events;
  return Array.isArray(events) ? events : null;
}

function isRpcResponseMember(event: unknown): boolean {
  return (
    !!event &&
    typeof event === 'object' &&
    (event as { type?: unknown }).type === MESSAGE_TYPES.RPC_RESPONSE
  );
}

@Injectable()
export class MessageRouterService {
  private readonly handlers = inject(MESSAGE_HANDLERS);
  private readonly ngZone = inject(NgZone);
  private readonly errorHandler = inject(ErrorHandler);
  private readonly handlerMap = new Map<string, MessageHandler[]>();

  private queue: InboundMessage[] = [];
  private draining = false;
  private drainScheduled = false;
  private drainHandle: MacrotaskHandle | null = null;
  private destroyed = false;
  private batchedResponseReported = false;

  private readonly onWindowMessage = (event: MessageEvent): void => {
    if (this.destroyed) return;
    const message = event.data;
    if (!message || !message.type) return;

    this.queue.push(message as InboundMessage);

    if (!this.draining && this.needsSynchronousFlush(message)) {
      this.drain();
      return;
    }
    this.scheduleDrain();
  };

  constructor() {
    this.buildHandlerMap();
    this.setupMessageListener();
    inject(DestroyRef).onDestroy(() => this.teardown());
  }

  /**
   * Build the dispatch map from all registered handlers.
   * Each message type maps to an array of handlers (usually 1, but supports multiple).
   */
  private buildHandlerMap(): void {
    for (const handler of this.handlers) {
      for (const messageType of handler.handledMessageTypes) {
        const existing = this.handlerMap.get(messageType);
        if (existing) {
          existing.push(handler);
        } else {
          this.handlerMap.set(messageType, [handler]);
        }
      }
    }
  }

  /**
   * Attach the window listener outside Angular so an inbound event does not
   * enter the zone by itself.
   */
  private setupMessageListener(): void {
    this.ngZone.runOutsideAngular(() => {
      window.addEventListener(
        'message',
        this.onWindowMessage,
        LISTENER_OPTIONS,
      );
    });
  }

  /** R-P8: a response, or a BATCH carrying one, is delivered in its own task. */
  private needsSynchronousFlush(message: {
    type: string;
    payload?: unknown;
  }): boolean {
    if (message.type === MESSAGE_TYPES.RPC_RESPONSE) return true;
    if (message.type !== MESSAGE_TYPES.BATCH) return false;
    const events = batchEvents(message);
    if (!events || !events.some(isRpcResponseMember)) return false;
    if (!this.batchedResponseReported) {
      this.batchedResponseReported = true;
      this.errorHandler.handleError(
        new Error(
          'MessageRouterService: a BATCH envelope carried an rpc:response. ' +
            'Responses must be sent unbatched; flushing synchronously to keep ' +
            'response ordering (R-P8).',
        ),
      );
    }
    return true;
  }

  private scheduleDrain(): void {
    if (this.drainScheduled) return;
    this.drainScheduled = true;
    let handle: MacrotaskHandle | null = null;
    try {
      // Outside Angular so the wake-up task itself is not a zone entry.
      handle = this.ngZone.runOutsideAngular(() =>
        scheduleMacrotask(() => {
          this.drainScheduled = false;
          this.drainHandle = null;
          this.drain();
        }),
      );
    } catch (error: unknown) {
      // The wake-up can never arrive: un-wedge and deliver now.
      this.drainScheduled = false;
      this.errorHandler.handleError(error);
      this.drain();
    }
    // `null` after a failed post; without MessageChannel the callback already
    // ran and cleared the flag.
    if (handle && this.drainScheduled) this.drainHandle = handle;
  }

  /**
   * Dispatch every message queued before this call, in arrival order, inside
   * one zone entry. Anything enqueued during the drain gets its own drain.
   */
  private drain(): void {
    if (this.destroyed || this.draining || this.queue.length === 0) return;
    const pending = this.queue;
    this.queue = [];
    this.draining = true;
    try {
      this.ngZone.run(() => {
        for (const message of pending) {
          if (message.type === MESSAGE_TYPES.BATCH) {
            this.dispatchBatch(message);
          } else {
            this.dispatchGuarded(message);
          }
        }
      });
    } finally {
      this.draining = false;
    }
    if (this.queue.length > 0) {
      this.scheduleDrain();
    }
  }

  /**
   * One throwing handler must not drop the rest of the drain. The error goes
   * to Angular's `ErrorHandler`, where the shell's uncaught handler errors
   * already land.
   */
  private dispatchGuarded(message: { type: string }): void {
    try {
      this.dispatch(message);
    } catch (error: unknown) {
      this.errorHandler.handleError(error);
    }
  }

  private dispatch(message: { type: string }): void {
    const handlers = this.handlerMap.get(message.type);
    if (!handlers) return;
    for (const handler of handlers) {
      handler.handleMessage(message);
    }
  }

  private dispatchBatch(message: { payload?: unknown }): void {
    const events = batchEvents(message);
    if (!events) {
      this.errorHandler.handleError(
        new Error(
          'MessageRouterService: dropped a BATCH envelope whose payload.events is not an array.',
        ),
      );
      return;
    }
    let skipped = 0;
    for (const event of events) {
      if (
        !event ||
        typeof event !== 'object' ||
        typeof (event as { type?: unknown }).type !== 'string'
      ) {
        skipped++;
        continue;
      }
      this.dispatchGuarded(event as BatchedStreamEvent);
    }
    if (skipped > 0) {
      this.errorHandler.handleError(
        new Error(
          `MessageRouterService: skipped ${skipped} BATCH member(s) without a string type.`,
        ),
      );
    }
  }

  private teardown(): void {
    this.destroyed = true;
    window.removeEventListener(
      'message',
      this.onWindowMessage,
      LISTENER_OPTIONS,
    );
    this.drainHandle?.cancel();
    this.drainHandle = null;
    this.drainScheduled = false;
    this.queue = [];
  }
}

/**
 * Factory function for APP_INITIALIZER.
 * Ensures MessageRouterService is eagerly instantiated at bootstrap
 * so the message listener is active before any components render.
 */
export function initializeMessageRouter(
  _router: MessageRouterService,
): () => void {
  return () => {};
}

/**
 * Provider function for MessageRouterService with APP_INITIALIZER.
 * Add this to app.config.ts providers to enable message routing.
 */
export function provideMessageRouter() {
  return [
    MessageRouterService,
    {
      provide: APP_INITIALIZER,
      useFactory: initializeMessageRouter,
      deps: [MessageRouterService],
      multi: true,
    },
  ];
}
