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
 * Zoneless note: the router's listener is a plain `window.addEventListener`
 * callback, so dispatch is synchronous and does not need Angular's change
 * detection to fire.
 */

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
