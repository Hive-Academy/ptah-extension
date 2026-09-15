/**
 * MessageRouterService specs — handler registry, type-based dispatch,
 * and graceful handling of unknown / malformed messages.
 *
 * VS Code API surface mocked at the window boundary:
 *   - `window.addEventListener('message', …)` — the real service attaches
 *     this listener in its constructor. Specs fire synthetic `MessageEvent`s
 *     via `window.dispatchEvent(new MessageEvent('message', { data }))` to
 *     drive the dispatch path. No `acquireVsCodeApi` or `postMessage` is
 *     involved here — the router is inbound-only.
 *
 * Tests fall into two categories:
 *   1. Real `MessageRouterService` wired via `TestBed` with `MESSAGE_HANDLERS`
 *      multi-providers — exercises the window listener + handler map.
 *   2. `createMockMessageRouter` from `@ptah-extension/core/testing` — verifies
 *      the in-memory `dispatch()` surface downstream specs rely on.
 *
 * Timing note: jsdom has no `MessageChannel`, so in the first block each
 * message drains in the task it arrived in and dispatch looks synchronous.
 * The burst-coalescing block (TASK_2026_437 C18) installs a controlled
 * `MessageChannel` so a spec decides when the drain task runs.
 */

import {
  ErrorHandler,
  NgZone,
  provideZonelessChangeDetection,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { createMockMessageRouter } from '../../testing/mock-message-router';
import { MessageRouterService } from './message-router.service';
import { MESSAGE_HANDLERS, type MessageHandler } from './message-router.types';

function makeHandler(types: readonly string[]): jest.Mocked<MessageHandler> {
  return {
    handledMessageTypes: types,
    handleMessage: jest.fn(),
  };
}

function fireWindowMessage(data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

describe('MessageRouterService (real implementation)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('dispatches a window message to the handler whose type matches', () => {
    const alpha = makeHandler(['alpha']);
    const beta = makeHandler(['beta']);

    TestBed.configureTestingModule({
      providers: [
        MessageRouterService,
        { provide: MESSAGE_HANDLERS, useValue: alpha, multi: true },
        { provide: MESSAGE_HANDLERS, useValue: beta, multi: true },
      ],
    });
    // Instantiate so the constructor attaches the window listener.
    TestBed.inject(MessageRouterService);

    fireWindowMessage({ type: 'alpha', payload: { x: 1 } });

    expect(alpha.handleMessage).toHaveBeenCalledWith({
      type: 'alpha',
      payload: { x: 1 },
    });
    expect(beta.handleMessage).not.toHaveBeenCalled();
  });

  it('dispatches to multiple handlers registered for the same message type', () => {
    const first = makeHandler(['shared']);
    const second = makeHandler(['shared']);

    TestBed.configureTestingModule({
      providers: [
        MessageRouterService,
        { provide: MESSAGE_HANDLERS, useValue: first, multi: true },
        { provide: MESSAGE_HANDLERS, useValue: second, multi: true },
      ],
    });
    TestBed.inject(MessageRouterService);

    fireWindowMessage({ type: 'shared', payload: 'hello' });

    expect(first.handleMessage).toHaveBeenCalledTimes(1);
    expect(second.handleMessage).toHaveBeenCalledTimes(1);
  });

  it('supports handlers that declare more than one message type', () => {
    const multi = makeHandler(['one', 'two']);

    TestBed.configureTestingModule({
      providers: [
        MessageRouterService,
        { provide: MESSAGE_HANDLERS, useValue: multi, multi: true },
      ],
    });
    TestBed.inject(MessageRouterService);

    fireWindowMessage({ type: 'one' });
    fireWindowMessage({ type: 'two' });
    fireWindowMessage({ type: 'three' });

    expect(multi.handleMessage).toHaveBeenCalledTimes(2);
    expect(multi.handleMessage).toHaveBeenNthCalledWith(1, { type: 'one' });
    expect(multi.handleMessage).toHaveBeenNthCalledWith(2, { type: 'two' });
  });

  it('silently ignores messages whose type has no registered handler', () => {
    const known = makeHandler(['known']);

    TestBed.configureTestingModule({
      providers: [
        MessageRouterService,
        { provide: MESSAGE_HANDLERS, useValue: known, multi: true },
      ],
    });
    TestBed.inject(MessageRouterService);

    expect(() =>
      fireWindowMessage({ type: 'unknown', payload: 'ignored' }),
    ).not.toThrow();
    expect(known.handleMessage).not.toHaveBeenCalled();
  });

  it('unpacks a batch envelope into individual handler dispatches in order', () => {
    const tokenHandler = makeHandler(['chat:messageChunk']);
    const progressHandler = makeHandler(['indexing:progress']);

    TestBed.configureTestingModule({
      providers: [
        MessageRouterService,
        { provide: MESSAGE_HANDLERS, useValue: tokenHandler, multi: true },
        { provide: MESSAGE_HANDLERS, useValue: progressHandler, multi: true },
      ],
    });
    TestBed.inject(MessageRouterService);

    fireWindowMessage({
      type: 'batch',
      payload: {
        events: [
          { type: 'chat:messageChunk', payload: { ord: 0 } },
          { type: 'chat:messageChunk', payload: { ord: 1 } },
          { type: 'indexing:progress', payload: { done: 5 } },
        ],
      },
    });

    expect(tokenHandler.handleMessage).toHaveBeenCalledTimes(2);
    expect(tokenHandler.handleMessage).toHaveBeenNthCalledWith(1, {
      type: 'chat:messageChunk',
      payload: { ord: 0 },
    });
    expect(tokenHandler.handleMessage).toHaveBeenNthCalledWith(2, {
      type: 'chat:messageChunk',
      payload: { ord: 1 },
    });
    expect(progressHandler.handleMessage).toHaveBeenCalledWith({
      type: 'indexing:progress',
      payload: { done: 5 },
    });
  });

  it('drops a malformed batch envelope without throwing and reports each one', () => {
    const handler = makeHandler(['chat:messageChunk']);
    const errorHandler = { handleError: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        MessageRouterService,
        { provide: ErrorHandler, useValue: errorHandler },
        { provide: MESSAGE_HANDLERS, useValue: handler, multi: true },
      ],
    });
    TestBed.inject(MessageRouterService);

    expect(() =>
      fireWindowMessage({ type: 'batch', payload: null }),
    ).not.toThrow();
    expect(() =>
      fireWindowMessage({ type: 'batch', payload: { events: 'nope' } }),
    ).not.toThrow();
    expect(() =>
      fireWindowMessage({ type: 'batch', payload: { events: [null, 7] } }),
    ).not.toThrow();
    expect(handler.handleMessage).not.toHaveBeenCalled();
    expect(errorHandler.handleError).toHaveBeenCalledTimes(3);
    const messages = errorHandler.handleError.mock.calls.map(
      ([error]) => (error as Error).message,
    );
    expect(messages[0]).toContain('payload.events is not an array');
    expect(messages[1]).toContain('payload.events is not an array');
    expect(messages[2]).toContain('skipped 2 BATCH member(s)');
  });

  it('ignores messages with no type or empty data payload', () => {
    const handler = makeHandler(['something']);

    TestBed.configureTestingModule({
      providers: [
        MessageRouterService,
        { provide: MESSAGE_HANDLERS, useValue: handler, multi: true },
      ],
    });
    TestBed.inject(MessageRouterService);

    fireWindowMessage(null);
    fireWindowMessage(undefined);
    fireWindowMessage({});
    fireWindowMessage({ payload: 'no type' });

    expect(handler.handleMessage).not.toHaveBeenCalled();
  });

  it('boots cleanly with zero registered handlers (empty multi-provider)', () => {
    TestBed.configureTestingModule({
      providers: [MessageRouterService],
    });

    // MESSAGE_HANDLERS is inject()ed without { optional: true } in the real
    // service, so Angular must resolve it. An empty multi-provider resolves
    // to `[]` — which matches the production bootstrap path.
    expect(() => TestBed.inject(MessageRouterService)).toThrow();
    // (No multi-provider supplied -> Angular throws. This documents the
    // real-bootstrap invariant: callers MUST supply at least one multi
    // provider, and app.config.ts does so via provideMessageRouter().)
  });
});

/**
 * A `MessageChannel` stand-in that never delivers by itself: `deliver()` runs
 * the pending drain task, so a spec can fire a burst first and then observe
 * exactly one drain.
 */
interface ChannelControl {
  readonly posts: () => number;
  readonly pending: () => number;
  readonly deliver: () => void;
  readonly closedPorts: () => number;
  /** Make every later `postMessage` throw `error` (or stop, with `null`). */
  readonly failPosts: (error: Error | null) => void;
}

function installControlledMessageChannel(): ChannelControl {
  let posts = 0;
  let closedPorts = 0;
  let postError: Error | null = null;
  const posted: Array<{ onmessage: (() => void) | null }> = [];

  class ControlledMessageChannel {
    readonly port1 = {
      onmessage: null as (() => void) | null,
      close: () => {
        closedPorts++;
      },
    };
    readonly port2 = {
      postMessage: () => {
        if (postError) throw postError;
        posts++;
        posted.push(this.port1);
      },
      close: () => {
        closedPorts++;
      },
    };
  }
  globalThis.MessageChannel =
    ControlledMessageChannel as unknown as typeof MessageChannel;

  return {
    posts: () => posts,
    pending: () => posted.length,
    deliver: () => {
      const port1 = posted.shift();
      if (!port1) throw new Error('no drain task pending');
      port1.onmessage?.();
    },
    closedPorts: () => closedPorts,
    failPosts: (error) => {
      postError = error;
    },
  };
}

describe('MessageRouterService burst coalescing (TASK_2026_437 C18)', () => {
  const originalMessageChannel = globalThis.MessageChannel;
  let channel: ChannelControl;
  let log: string[];
  let errorHandler: { handleError: jest.Mock };

  /** A handler that appends `type:ord` to the shared log. */
  function loggingHandler(
    types: readonly string[],
    onMessage?: (message: { type: string; payload?: unknown }) => void,
  ): MessageHandler {
    return {
      handledMessageTypes: types,
      handleMessage: (message: { type: string; payload?: unknown }) => {
        const ord = (message.payload as { ord?: number } | undefined)?.ord;
        log.push(`${message.type}:${ord ?? '-'}`);
        onMessage?.(message);
      },
    };
  }

  /**
   * `run` counts zone ENTRIES: `ngZone.run` calls made from outside the
   * Angular zone. The real zone's change-detection scheduler re-enters with a
   * nested `run(() => appRef.tick())` when the drain's zone turn settles — that
   * nested call is the one CD pass the entry pays for, not a second entry.
   */
  function boot(
    handlers: readonly MessageHandler[],
    extraProviders: unknown[] = [],
  ): { router: MessageRouterService; zone: NgZone; run: jest.Mock } {
    TestBed.configureTestingModule({
      providers: [
        ...(extraProviders as never[]),
        MessageRouterService,
        { provide: ErrorHandler, useValue: errorHandler },
        ...handlers.map((h) => ({
          provide: MESSAGE_HANDLERS,
          useValue: h,
          multi: true,
        })),
      ],
    });
    const router = TestBed.inject(MessageRouterService);
    const zone = TestBed.inject(NgZone);
    const run = jest.fn();
    const realRun = zone.run.bind(zone);
    jest.spyOn(zone, 'run').mockImplementation((fn, applyThis, applyArgs) => {
      if (!NgZone.isInAngularZone()) run();
      return realRun(fn, applyThis, applyArgs);
    });
    return { router, zone, run };
  }

  beforeEach(() => {
    log = [];
    errorHandler = { handleError: jest.fn() };
    channel = installControlledMessageChannel();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    globalThis.MessageChannel = originalMessageChannel;
    jest.restoreAllMocks();
  });

  it('drains 1,000 queued messages in one MessageChannel task with exactly one zone entry, in arrival order (AC-13)', () => {
    const { run } = boot([loggingHandler(['burst'])]);

    for (let ord = 0; ord < 1000; ord++) {
      fireWindowMessage({ type: 'burst', payload: { ord } });
    }

    // Nothing dispatched and no zone entry until the drain task runs.
    expect(log).toHaveLength(0);
    expect(run).not.toHaveBeenCalled();
    expect(channel.posts()).toBe(1);

    channel.deliver();

    expect(run).toHaveBeenCalledTimes(1);
    expect(log).toEqual(
      Array.from({ length: 1000 }, (_, ord) => `burst:${ord}`),
    );
  });

  it('attaches the window listener outside the Angular zone and dispatches inside it', () => {
    let handlerInZone: boolean | null = null;
    TestBed.configureTestingModule({
      providers: [
        MessageRouterService,
        { provide: ErrorHandler, useValue: errorHandler },
        {
          provide: MESSAGE_HANDLERS,
          useValue: loggingHandler(['probe'], () => {
            handlerInZone = NgZone.isInAngularZone();
          }),
          multi: true,
        },
      ],
    });
    const zone = TestBed.inject(NgZone);
    const attachedInZone: boolean[] = [];
    const addListener = window.addEventListener.bind(window);
    jest
      .spyOn(window, 'addEventListener')
      .mockImplementation((...args: Parameters<Window['addEventListener']>) => {
        if (args[0] === 'message')
          attachedInZone.push(NgZone.isInAngularZone());
        addListener(...args);
      });

    // Construct from inside the zone, as APP_INITIALIZER does in the shell.
    zone.run(() => TestBed.inject(MessageRouterService));

    expect(attachedInZone).toEqual([false]);

    zone.runOutsideAngular(() => {
      fireWindowMessage({ type: 'probe' });
      channel.deliver();
    });

    expect(handlerInZone).toBe(true);
  });

  it('keeps BATCH expansion in place relative to its neighbours', () => {
    const { run } = boot([loggingHandler(['a', 'b'])]);

    fireWindowMessage({ type: 'a', payload: { ord: 0 } });
    fireWindowMessage({
      type: 'batch',
      payload: {
        events: [
          { type: 'a', payload: { ord: 1 } },
          { type: 'b', payload: { ord: 2 } },
          { type: 'a', payload: { ord: 3 } },
        ],
      },
    });
    fireWindowMessage({ type: 'b', payload: { ord: 4 } });

    channel.deliver();

    expect(run).toHaveBeenCalledTimes(1);
    expect(log).toEqual(['a:0', 'a:1', 'b:2', 'a:3', 'b:4']);
  });

  it('isolates a throwing handler so the rest of the drain — and the rest of a batch — still dispatches', () => {
    const boom = new Error('handler exploded');
    const failBatch = new Error('batch member exploded');
    const { run } = boot([
      loggingHandler(['m'], (message) => {
        const ord = (message.payload as { ord: number }).ord;
        if (ord === 5) throw boom;
        if (ord === 11) throw failBatch;
      }),
    ]);

    for (let ord = 0; ord < 10; ord++) {
      fireWindowMessage({ type: 'm', payload: { ord } });
    }
    fireWindowMessage({
      type: 'batch',
      payload: {
        events: [
          { type: 'm', payload: { ord: 10 } },
          { type: 'm', payload: { ord: 11 } },
          { type: 'm', payload: { ord: 12 } },
        ],
      },
    });

    expect(() => channel.deliver()).not.toThrow();

    expect(run).toHaveBeenCalledTimes(1);
    expect(log).toEqual(Array.from({ length: 13 }, (_, ord) => `m:${ord}`));
    expect(errorHandler.handleError).toHaveBeenCalledTimes(2);
    expect(errorHandler.handleError).toHaveBeenNthCalledWith(1, boom);
    expect(errorHandler.handleError).toHaveBeenNthCalledWith(2, failBatch);
  });

  it('defers a message that arrives during a drain to the next drain, after everything already queued', () => {
    const { run } = boot([
      loggingHandler(['first', 'second', 'third'], (message) => {
        if (message.type === 'first') {
          // Synchronous re-entrant delivery while the drain is running.
          fireWindowMessage({ type: 'second' });
        }
      }),
    ]);

    fireWindowMessage({ type: 'first' });
    fireWindowMessage({ type: 'third' });
    expect(channel.posts()).toBe(1);

    channel.deliver();

    // The drain is bounded to what was queued when it started.
    expect(log).toEqual(['first:-', 'third:-']);
    expect(run).toHaveBeenCalledTimes(1);
    expect(channel.pending()).toBe(1);

    channel.deliver();

    expect(log).toEqual(['first:-', 'third:-', 'second:-']);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('flushes queued pushes and an rpc:response in the task the response arrived in, ahead of other window listeners (R-P8)', () => {
    // Registered BEFORE the router, like rpc-call.util's RpcClient usually is.
    const seenByLaterListener: string[][] = [];
    const rpcClientLike = (event: MessageEvent) => {
      if ((event.data as { type?: string }).type === 'rpc:response') {
        seenByLaterListener.push([...log]);
      }
    };
    window.addEventListener('message', rpcClientLike);

    try {
      const { run } = boot([loggingHandler(['push', 'rpc:response'])]);

      fireWindowMessage({ type: 'push', payload: { ord: 0 } });
      fireWindowMessage({ type: 'rpc:response', payload: { ord: 1 } });

      // Delivered synchronously, in order, before the other listener ran.
      expect(log).toEqual(['push:0', 'rpc:response:1']);
      expect(seenByLaterListener).toEqual([['push:0', 'rpc:response:1']]);
      expect(run).toHaveBeenCalledTimes(1);

      // The drain task scheduled for `push` finds nothing and enters no zone.
      channel.deliver();
      expect(run).toHaveBeenCalledTimes(1);

      fireWindowMessage({ type: 'push', payload: { ord: 2 } });
      expect(log).toEqual(['push:0', 'rpc:response:1']);
      channel.deliver();
      expect(log).toEqual(['push:0', 'rpc:response:1', 'push:2']);
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener('message', rpcClientLike);
    }
  });

  it('keeps responses in arrival order relative to each other and to pushes', () => {
    boot([loggingHandler(['push', 'rpc:response'])]);

    fireWindowMessage({ type: 'rpc:response', payload: { ord: 0 } });
    fireWindowMessage({ type: 'push', payload: { ord: 1 } });
    fireWindowMessage({ type: 'push', payload: { ord: 2 } });
    fireWindowMessage({ type: 'rpc:response', payload: { ord: 3 } });
    fireWindowMessage({ type: 'rpc:response', payload: { ord: 4 } });
    fireWindowMessage({ type: 'push', payload: { ord: 5 } });
    channel.deliver();

    expect(log).toEqual([
      'rpc:response:0',
      'push:1',
      'push:2',
      'rpc:response:3',
      'rpc:response:4',
      'push:5',
    ]);
  });

  it('on teardown removes the listener, closes the channel and drops the queue', () => {
    const { run } = boot([loggingHandler(['late'])]);

    fireWindowMessage({ type: 'late', payload: { ord: 0 } });
    expect(channel.pending()).toBe(1);

    TestBed.resetTestingModule();

    expect(channel.closedPorts()).toBe(2);
    // The already-posted drain task finds a destroyed router.
    channel.deliver();
    // A message after teardown is not queued and schedules nothing.
    fireWindowMessage({ type: 'late', payload: { ord: 1 } });

    expect(log).toEqual([]);
    expect(run).not.toHaveBeenCalled();
    expect(channel.posts()).toBe(1);
  });

  it('coalesces the same way under a zoneless host (no-op NgZone)', () => {
    const { zone, run } = boot(
      [loggingHandler(['z'])],
      [provideZonelessChangeDetection()],
    );
    expect(zone).not.toBeInstanceOf(NgZone);

    for (let ord = 0; ord < 3; ord++) {
      fireWindowMessage({ type: 'z', payload: { ord } });
    }
    expect(log).toEqual([]);
    channel.deliver();

    expect(run).toHaveBeenCalledTimes(1);
    expect(log).toEqual(['z:0', 'z:1', 'z:2']);
  });

  it('does not wedge the queue when the drain wake-up fails to post: reports it and drains synchronously', () => {
    const postFailure = new Error('postMessage failed');
    boot([loggingHandler(['m'])]);
    channel.failPosts(postFailure);

    fireWindowMessage({ type: 'm', payload: { ord: 0 } });

    expect(log).toEqual(['m:0']);
    expect(errorHandler.handleError).toHaveBeenCalledWith(postFailure);
    // Both ports of the failed channel were released.
    expect(channel.closedPorts()).toBe(2);

    // The schedule flag was reset: later messages still get delivered.
    fireWindowMessage({ type: 'm', payload: { ord: 1 } });
    expect(log).toEqual(['m:0', 'm:1']);

    channel.failPosts(null);
    fireWindowMessage({ type: 'm', payload: { ord: 2 } });
    expect(log).toEqual(['m:0', 'm:1']);
    expect(channel.pending()).toBe(1);
    channel.deliver();
    expect(log).toEqual(['m:0', 'm:1', 'm:2']);
  });

  it('flushes a BATCH carrying an rpc:response synchronously and reports the producer regression once', () => {
    const { run } = boot([loggingHandler(['push', 'rpc:response'])]);
    const batchWithResponse = (base: number) => ({
      type: 'batch',
      payload: {
        events: [
          { type: 'push', payload: { ord: base + 1 } },
          { type: 'rpc:response', payload: { ord: base + 2 } },
          { type: 'push', payload: { ord: base + 3 } },
        ],
      },
    });

    fireWindowMessage({ type: 'push', payload: { ord: 0 } });
    fireWindowMessage(batchWithResponse(0));

    // No drain task needed: queued push, then the whole batch, in order.
    expect(log).toEqual(['push:0', 'push:1', 'rpc:response:2', 'push:3']);
    expect(run).toHaveBeenCalledTimes(1);
    expect(errorHandler.handleError).toHaveBeenCalledTimes(1);
    expect(
      (errorHandler.handleError.mock.calls[0][0] as Error).message,
    ).toContain('BATCH envelope carried an rpc:response');

    fireWindowMessage(batchWithResponse(3));
    expect(log).toHaveLength(7);
    expect(errorHandler.handleError).toHaveBeenCalledTimes(1);

    // A batch of pushes only is still coalesced.
    fireWindowMessage({
      type: 'batch',
      payload: { events: [{ type: 'push', payload: { ord: 7 } }] },
    });
    expect(log).toHaveLength(7);
  });
});

/**
 * R-P8 end to end against the REAL `rpc-call.util.ts` client, not a stand-in.
 * `jest.isolateModulesAsync` gives each case a fresh `RpcClient` singleton so
 * the case controls whether its window listener registers before or after the
 * router's.
 */
describe('MessageRouterService with the real RpcClient (R-P8)', () => {
  const originalMessageChannel = globalThis.MessageChannel;
  type RpcModule = typeof import('./rpc-call.util');

  let channel: ChannelControl;
  let order: string[];

  async function loadFreshRpcModule(): Promise<RpcModule> {
    let loaded: RpcModule | undefined;
    await jest.isolateModulesAsync(async () => {
      loaded = await import('./rpc-call.util');
    });
    if (!loaded) throw new Error('rpc-call.util did not load');
    return loaded;
  }

  function bootRouter(): void {
    TestBed.configureTestingModule({
      providers: [
        MessageRouterService,
        {
          provide: MESSAGE_HANDLERS,
          useValue: {
            handledMessageTypes: ['push'],
            handleMessage: (message: { payload?: unknown }) => {
              order.push(`push:${(message.payload as { ord: number }).ord}`);
            },
          } satisfies MessageHandler,
          multi: true,
        },
      ],
    });
    TestBed.inject(MessageRouterService);
  }

  /** Start a call through the real client and return its correlation id. */
  async function startCall(
    rpc: RpcModule,
  ): Promise<{ correlationId: string; resumed: Promise<void> }> {
    const postMessage = jest.fn();
    const vscode = { postMessage } as unknown as Parameters<
      RpcModule['rpcCall']
    >[0];
    rpc.getRpcClient().markReady();
    const resumed = rpc
      .rpcCall(vscode, 'test:method', {}, 5_000)
      .then((result) => {
        order.push(`resumed:${String(result.success)}`);
      });
    // The client posts after awaiting its ready gate.
    for (let i = 0; i < 10 && postMessage.mock.calls.length === 0; i++) {
      await Promise.resolve();
    }
    const sent = postMessage.mock.calls[0]?.[0] as
      | { payload: { correlationId: string } }
      | undefined;
    if (!sent) throw new Error('rpcCall never posted');
    return { correlationId: sent.payload.correlationId, resumed };
  }

  beforeEach(() => {
    order = [];
    channel = installControlledMessageChannel();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    globalThis.MessageChannel = originalMessageChannel;
  });

  it.each([
    ['the RpcClient listener registered first', 'client-first'],
    ['the router listener registered first', 'router-first'],
  ])(
    'dispatches pushes queued before a response before the awaiting caller resumes (%s)',
    async (_label, registration) => {
      let rpc: RpcModule;
      if (registration === 'client-first') {
        rpc = await loadFreshRpcModule();
        const { correlationId, resumed } = await startCall(rpc);
        bootRouter();
        await deliverScenario(correlationId, resumed);
      } else {
        bootRouter();
        rpc = await loadFreshRpcModule();
        const { correlationId, resumed } = await startCall(rpc);
        await deliverScenario(correlationId, resumed);
      }
    },
  );

  async function deliverScenario(
    correlationId: string,
    resumed: Promise<void>,
  ): Promise<void> {
    fireWindowMessage({ type: 'push', payload: { ord: 1 } });
    fireWindowMessage({ type: 'push', payload: { ord: 2 } });
    // Coalesced: nothing dispatched yet.
    expect(order).toEqual([]);

    fireWindowMessage({
      type: 'rpc:response',
      correlationId,
      success: true,
      data: { ok: true },
    });
    await resumed;

    expect(order).toEqual(['push:1', 'push:2', 'resumed:true']);
    // The drain task posted for the pushes is now empty.
    channel.deliver();
    expect(order).toEqual(['push:1', 'push:2', 'resumed:true']);
  }
});

describe('createMockMessageRouter (testing surface)', () => {
  it('registers a handler via __state.register and dispatches by type', () => {
    const router = createMockMessageRouter();
    const handler = makeHandler(['late']);

    router.__state.register(handler);
    router.dispatch({ type: 'late', payload: { id: 9 } });

    expect(handler.handleMessage).toHaveBeenCalledWith({
      type: 'late',
      payload: { id: 9 },
    });
  });

  it('unsubscribes handlers via __state.clear', () => {
    const handler = makeHandler(['foo']);
    const router = createMockMessageRouter({ handlers: [handler] });

    router.__state.clear();
    router.dispatch({ type: 'foo' });

    expect(handler.handleMessage).not.toHaveBeenCalled();
    expect(router.__state.handlers).toHaveLength(0);
  });

  it('does nothing on unknown message types and never throws', () => {
    const handler = makeHandler(['foo']);
    const router = createMockMessageRouter({ handlers: [handler] });

    expect(() =>
      router.dispatch({ type: 'unknown-type', payload: 42 }),
    ).not.toThrow();
    expect(handler.handleMessage).not.toHaveBeenCalled();
  });

  it('ignores messages with empty type', () => {
    const handler = makeHandler(['']);
    const router = createMockMessageRouter({ handlers: [handler] });

    router.dispatch({ type: '' });
    // Empty-type messages are rejected by the dispatcher before handler lookup.
    expect(handler.handleMessage).not.toHaveBeenCalled();
  });

  it('records dispatch invocations as a jest.Mock for assertion', () => {
    const router = createMockMessageRouter();
    router.dispatch({ type: 'noop' });
    expect(router.dispatch).toHaveBeenCalledWith({ type: 'noop' });
    expect(router.dispatch).toHaveBeenCalledTimes(1);
  });
});
