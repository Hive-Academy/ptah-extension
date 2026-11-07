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
 *   queue. Signal-only stream messages stay outside Angular; a drain that
 *   contains any zone-required message uses at most one `ngZone.run`.
 *   Therefore a burst of streaming chunks does not schedule a Zone tick.
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
 * - Every drain, the response flush included, runs under one budget
 *   (`DRAIN_BUDGET_MS` / `DRAIN_MESSAGE_CAP` units, a BATCH member counting as
 *   one unit, so a large BATCH is split across tasks in order). When the
 *   backlog ahead of a response does not fit, the response is HELD: its
 *   event's propagation is stopped (the other window listeners, the RPC client
 *   among them, do not see it yet), the backlog continues in the next tasks,
 *   and when the drain reaches the response it is dispatched and then
 *   re-dispatched on `window` for those listeners -- the same stop-and-replay
 *   `apps/ptah-extension-webview/src/main.ts` uses at boot. That drain ends
 *   right after it, so the awaiting caller still resumes after every earlier
 *   push and before every later one (R-P8 unchanged).
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

/**
 * The only inbound message types proven safe to dispatch outside Angular.
 * `chat:chunk` flows through ChatMessageHandler into signal-backed stream
 * state; Angular 22 schedules views that consume those signals independently
 * of Zone stabilization. Keep this deliberately small: unknown/new types
 * default to the Zone until their handler contract has been audited.
 */
const SIGNAL_ONLY_STREAM_TYPES = new Set<string>([MESSAGE_TYPES.CHAT_CHUNK]);
const DRAIN_BUDGET_MS = 8;
const DRAIN_MESSAGE_CAP = 64;

/** The event that triggered a response flush, so it can be held. */
interface FlushTrigger {
  readonly message: InboundMessage;
  readonly event: MessageEvent;
}

/** Where a drain stopped: next message, and the undispatched BATCH tail. */
interface DrainCursor {
  index: number;
  tail: InboundMessage | null;
}

/** One drain's time and unit budget; never spent before the first unit. */
class DrainBudget {
  private units = 0;
  private readonly started = performance.now();

  count(): void {
    this.units++;
  }

  spent(): boolean {
    return (
      this.units > 0 &&
      (this.units >= DRAIN_MESSAGE_CAP ||
        performance.now() - this.started >= DRAIN_BUDGET_MS)
    );
  }
}

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
  /** Responses whose window event was stopped; replayed once dispatched. */
  private readonly heldResponses = new Set<InboundMessage>();
  /** Replays in flight, which this router's own listener must not re-queue. */
  private readonly replaying = new WeakSet<object>();

  private readonly onWindowMessage = (event: MessageEvent): void => {
    if (this.destroyed) return;
    const message = event.data;
    if (!message || !message.type) return;
    if (this.replaying.has(message)) return;

    this.queue.push(message as InboundMessage);

    if (!this.draining && this.needsSynchronousFlush(message)) {
      this.drain({ message: message as InboundMessage, event });
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
   * Dispatch queued messages in arrival order under one `DrainBudget`; the
   * rest, and later arrivals, get a new drain. With a `trigger` (a response
   * flush) that the budget did not reach, the trigger is held.
   */
  private drain(trigger?: FlushTrigger): void {
    if (this.destroyed || this.draining || this.queue.length === 0) return;
    const pending = this.queue;
    this.queue = [];
    this.draining = true;
    const budget = new DrainBudget();
    // An object, not two `let`s: the loop below runs in a closure, and the
    // `finally` must read what it left behind.
    const cursor: DrainCursor = { index: 0, tail: null };
    try {
      const dispatch = () => {
        while (cursor.index < pending.length && !budget.spent()) {
          const message = pending[cursor.index];
          const tail = this.dispatchUnit(message, budget);
          if (tail !== null) {
            cursor.tail = tail;
            if (this.heldResponses.delete(message)) this.heldResponses.add(tail);
            break;
          }
          cursor.index++;
          if (this.heldResponses.delete(message)) {
            this.replay(message);
            // End here: the replay resolves the awaiting caller, which must
            // resume before anything that arrived after its response.
            break;
          }
        }
      };
      if (pending.some((message) => this.requiresZone(message))) {
        // One entry at most, even when zone-required and signal-only messages
        // are interleaved. Nested runOutsideAngular keeps the latter's handler
        // contract truthful without changing FIFO/BATCH expansion ordering.
        this.ngZone.run(dispatch);
      } else {
        this.ngZone.runOutsideAngular(dispatch);
      }
    } finally {
      this.draining = false;
      const rest = pending.slice(cursor.index);
      if (cursor.tail !== null) rest[0] = cursor.tail;
      if (rest.length > 0) this.queue = rest.concat(this.queue);
      if (trigger !== undefined && rest.length > 0) {
        this.hold(trigger, cursor.tail);
      }
      if (this.queue.length > 0) this.scheduleDrain();
    }
  }

  /**
   * The flush did not reach its trigger, which is always the last pending
   * message (it was queued just before this non-reentrant drain). Stop the
   * event so the other window listeners see it only when its turn comes.
   */
  private hold(trigger: FlushTrigger, tail: InboundMessage | null): void {
    trigger.event.stopImmediatePropagation();
    const queued = this.queue.includes(trigger.message)
      ? trigger.message
      : tail;
    if (queued !== null) this.heldResponses.add(queued);
  }

  /** Re-dispatch a held response for the window listeners it was kept from. */
  private replay(message: InboundMessage): void {
    this.replaying.add(message);
    try {
      this.ngZone.runOutsideAngular(() =>
        window.dispatchEvent(new MessageEvent('message', { data: message })),
      );
    } finally {
      this.replaying.delete(message);
    }
  }

  /**
   * Dispatch one queued message. A well-formed BATCH is dispatched member by
   * member, each member one budget unit; when the budget runs out mid-batch
   * the undispatched members come back as a new BATCH envelope (the tail),
   * which keeps its place at the head of the queue.
   */
  private dispatchUnit(
    message: InboundMessage,
    budget: DrainBudget,
  ): InboundMessage | null {
    const events =
      message.type === MESSAGE_TYPES.BATCH ? batchEvents(message) : null;
    if (events === null) {
      this.dispatchPending(message);
      budget.count();
      return null;
    }
    const next = this.dispatchBatchEvents(events, budget);
    return next < events.length
      ? { type: message.type, payload: { events: events.slice(next) } }
      : null;
  }

  /** Dispatch one message (a malformed BATCH is reported) in its own zone. */
  private dispatchPending(message: InboundMessage): void {
    const dispatch = () => {
      if (message.type === MESSAGE_TYPES.BATCH) {
        this.reportMalformedBatch();
      } else {
        this.dispatchGuarded(message);
      }
    };
    if (this.requiresZone(message)) {
      dispatch();
    } else {
      this.ngZone.runOutsideAngular(dispatch);
    }
  }

  /** Unknown, malformed, and non-stream messages are conservative by default. */
  private requiresZone(message: InboundMessage | BatchedStreamEvent): boolean {
    if (message.type !== MESSAGE_TYPES.BATCH) {
      return !SIGNAL_ONLY_STREAM_TYPES.has(message.type);
    }
    const events = batchEvents(message);
    if (!events) return true;
    return events.some(
      (event) =>
        !event ||
        typeof event !== 'object' ||
        typeof (event as { type?: unknown }).type !== 'string' ||
        this.requiresZone(event as BatchedStreamEvent),
    );
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

  private reportMalformedBatch(): void {
    this.errorHandler.handleError(
      new Error(
        'MessageRouterService: dropped a BATCH envelope whose payload.events is not an array.',
      ),
    );
  }

  /**
   * Dispatch `events` in order, each in its own required zone. Stops before a
   * member once `budget` is spent (never before the first member) and returns
   * the index of the first undispatched member.
   */
  private dispatchBatchEvents(
    events: readonly unknown[],
    budget: DrainBudget,
  ): number {
    let skipped = 0;
    let next = 0;
    while (next < events.length) {
      if (next > 0 && budget.spent()) break;
      const event = events[next++];
      budget.count();
      if (
        !event ||
        typeof event !== 'object' ||
        typeof (event as { type?: unknown }).type !== 'string'
      ) {
        skipped++;
        continue;
      }
      const dispatch = () => this.dispatchGuarded(event as BatchedStreamEvent);
      if (this.requiresZone(event as BatchedStreamEvent)) {
        dispatch();
      } else {
        this.ngZone.runOutsideAngular(dispatch);
      }
    }
    if (skipped > 0) {
      this.errorHandler.handleError(
        new Error(
          `MessageRouterService: skipped ${skipped} BATCH member(s) without a string type.`,
        ),
      );
    }
    return next;
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
    // A held response was kept from the RPC client; hand it over rather than
    // leave its caller waiting for its timeout.
    const held = [...this.heldResponses];
    this.heldResponses.clear();
    for (const message of held) this.replay(message);
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
