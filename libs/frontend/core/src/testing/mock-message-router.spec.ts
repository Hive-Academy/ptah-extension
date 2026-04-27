/**
 * Smoke tests for `createMockMessageRouter` — verifies the factory builds a
 * router mock whose `dispatch()` helper walks registered handlers and calls
 * only those whose `handledMessageTypes` match the incoming message type.
 */

import type { MessageHandler } from '../lib/services/message-router.types';
import { createMockMessageRouter } from './mock-message-router';

function makeHandler(types: readonly string[]): jest.Mocked<MessageHandler> {
  return {
    handledMessageTypes: types,
    handleMessage: jest.fn(),
  };
}

describe('createMockMessageRouter', () => {
  it('dispatches messages only to handlers whose type matches', () => {
    const foo = makeHandler(['foo']);
    const bar = makeHandler(['bar']);
    const router = createMockMessageRouter({ handlers: [foo, bar] });

    router.dispatch({ type: 'foo', payload: { id: 1 } });

    expect(foo.handleMessage).toHaveBeenCalledWith({
      type: 'foo',
      payload: { id: 1 },
    });
    expect(bar.handleMessage).not.toHaveBeenCalled();
  });

  it('ignores messages without a type and dispatches to multiple handlers for the same type', () => {
    const a = makeHandler(['shared']);
    const b = makeHandler(['shared']);
    const router = createMockMessageRouter({ handlers: [a, b] });

    // No-op dispatches
    router.dispatch({ type: '' });

    // Real dispatch reaches both handlers
    router.dispatch({ type: 'shared', payload: 42 });

    expect(a.handleMessage).toHaveBeenCalledTimes(1);
    expect(b.handleMessage).toHaveBeenCalledTimes(1);
  });

  it('supports late handler registration via __state.register', () => {
    const router = createMockMessageRouter();
    const handler = makeHandler(['late']);

    router.__state.register(handler);
    router.dispatch({ type: 'late' });

    expect(handler.handleMessage).toHaveBeenCalledTimes(1);
  });
});
