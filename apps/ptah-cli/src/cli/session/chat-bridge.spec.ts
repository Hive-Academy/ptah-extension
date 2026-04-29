/**
 * Unit tests for `ChatBridge` — TASK_2026_104 Sub-batch B10b.
 *
 * Covers (per spec § B10b):
 *   1. happy path — text_delta x2 → message_complete (no text) → resolves
 *      success with two `agent.message` notifications emitted (is_partial:true)
 *   2. thought stream — thought_delta → complete → one `agent.thought`
 *   3. tool round-trip — tool_use → tool_result → complete
 *   4. error path — text_delta → error → success:false with payload.error
 *   5. message_start swap — chunk(message_start { sessionId: 'real-uuid' }) →
 *      subsequent agent.* carry session_id: 'real-uuid' (NOT the synthetic tabId)
 *   6. multi-tabId isolation — interleaved tabA/tabB events, each runTurn
 *      resolves independently with the correct events
 *   7. abort signal — signal.abort() during in-flight → cancelled:true
 *   8. listener-leak prevention — pushAdapter.listenerCount('chat:*') === 0
 *      after every settle (success, error, abort, timeout, rpc-throw)
 */

import { EventEmitter } from 'node:events';

import { ChatBridge } from './chat-bridge.js';

interface NotifyCall {
  method: string;
  params?: unknown;
}

function makeFakeJsonRpc(): {
  notify: jest.Mock;
  calls: NotifyCall[];
} {
  const calls: NotifyCall[] = [];
  const notify = jest.fn(async (method: string, params?: unknown) => {
    calls.push({ method, params });
  });
  return { notify, calls };
}

function makeBridge(): {
  bridge: ChatBridge;
  adapter: EventEmitter;
  notify: jest.Mock;
  calls: NotifyCall[];
} {
  const adapter = new EventEmitter();
  const { notify, calls } = makeFakeJsonRpc();
  const bridge = new ChatBridge(adapter, { notify });
  return { bridge, adapter, notify, calls };
}

function expectNoListenerLeaks(adapter: EventEmitter): void {
  expect(adapter.listenerCount('chat:chunk')).toBe(0);
  expect(adapter.listenerCount('chat:complete')).toBe(0);
  expect(adapter.listenerCount('chat:error')).toBe(0);
}

describe('ChatBridge — runTurn', () => {
  it('happy path — text_delta x2 → complete resolves success and emits two agent.message', async () => {
    const { bridge, adapter, calls } = makeBridge();

    const promise = bridge.runTurn({
      tabId: 'tab-1',
      rpcCall: async () => {
        // Emit two text_delta chunks then complete on the next microtask
        queueMicrotask(() => {
          adapter.emit('chat:chunk', {
            tabId: 'tab-1',
            sessionId: 'tab-1',
            event: {
              eventType: 'text_delta',
              messageId: 'm-1',
              delta: 'Hello ',
            },
          });
          adapter.emit('chat:chunk', {
            tabId: 'tab-1',
            sessionId: 'tab-1',
            event: {
              eventType: 'text_delta',
              messageId: 'm-1',
              delta: 'world',
            },
          });
          adapter.emit('chat:complete', {
            tabId: 'tab-1',
            sessionId: 'tab-1',
          });
        });
        return { success: true };
      },
    });

    const result = await promise;
    expect(result).toEqual({
      success: true,
      sessionId: 'tab-1',
      turnId: undefined,
    });

    const messages = calls.filter((c) => c.method === 'agent.message');
    expect(messages).toHaveLength(2);
    expect(messages[0]?.params).toEqual({
      session_id: 'tab-1',
      turn_id: 'tab-1:t1',
      message_id: 'm-1',
      text: 'Hello ',
      is_partial: true,
    });
    expect(messages[1]?.params).toEqual({
      session_id: 'tab-1',
      turn_id: 'tab-1:t1',
      message_id: 'm-1',
      text: 'world',
      is_partial: true,
    });

    expectNoListenerLeaks(adapter);
  });

  it('thought stream — thought_delta → complete emits one agent.thought', async () => {
    const { bridge, adapter, calls } = makeBridge();

    const result = await bridge.runTurn({
      tabId: 'tab-2',
      rpcCall: async () => {
        queueMicrotask(() => {
          adapter.emit('chat:chunk', {
            tabId: 'tab-2',
            sessionId: 'tab-2',
            event: {
              eventType: 'thought_delta',
              messageId: 'm-2',
              delta: 'thinking…',
            },
          });
          adapter.emit('chat:complete', { tabId: 'tab-2', sessionId: 'tab-2' });
        });
        return { success: true };
      },
    });

    expect(result.success).toBe(true);
    const thoughts = calls.filter((c) => c.method === 'agent.thought');
    expect(thoughts).toHaveLength(1);
    expect(thoughts[0]?.params).toEqual({
      session_id: 'tab-2',
      turn_id: 'tab-2:t1',
      message_id: 'm-2',
      text: 'thinking…',
    });
    expectNoListenerLeaks(adapter);
  });

  it('also accepts the backend-canonical thinking_delta event type', async () => {
    const { bridge, adapter, calls } = makeBridge();

    await bridge.runTurn({
      tabId: 'tab-2b',
      rpcCall: async () => {
        queueMicrotask(() => {
          adapter.emit('chat:chunk', {
            tabId: 'tab-2b',
            sessionId: 'tab-2b',
            event: {
              eventType: 'thinking_delta',
              messageId: 'm-2b',
              delta: 'pondering',
            },
          });
          adapter.emit('chat:complete', {
            tabId: 'tab-2b',
            sessionId: 'tab-2b',
          });
        });
        return { success: true };
      },
    });

    const thoughts = calls.filter((c) => c.method === 'agent.thought');
    expect(thoughts).toHaveLength(1);
    expect(thoughts[0]?.params).toMatchObject({ text: 'pondering' });
    expectNoListenerLeaks(adapter);
  });

  it('tool round-trip — tool_use → tool_result → complete', async () => {
    const { bridge, adapter, calls } = makeBridge();

    await bridge.runTurn({
      tabId: 'tab-3',
      rpcCall: async () => {
        queueMicrotask(() => {
          adapter.emit('chat:chunk', {
            tabId: 'tab-3',
            sessionId: 'tab-3',
            event: {
              eventType: 'tool_use',
              toolCallId: 'tu-1',
              toolName: 'Read',
              toolInput: { file_path: '/tmp/x' },
            },
          });
          adapter.emit('chat:chunk', {
            tabId: 'tab-3',
            sessionId: 'tab-3',
            event: {
              eventType: 'tool_result',
              toolCallId: 'tu-1',
              output: 'file contents',
              isError: false,
            },
          });
          adapter.emit('chat:complete', { tabId: 'tab-3', sessionId: 'tab-3' });
        });
        return { success: true };
      },
    });

    const toolUse = calls.filter((c) => c.method === 'agent.tool_use');
    const toolResult = calls.filter((c) => c.method === 'agent.tool_result');
    expect(toolUse).toHaveLength(1);
    expect(toolUse[0]?.params).toEqual({
      session_id: 'tab-3',
      turn_id: 'tab-3:t1',
      tool_use_id: 'tu-1',
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/x' },
    });
    expect(toolResult).toHaveLength(1);
    expect(toolResult[0]?.params).toEqual({
      session_id: 'tab-3',
      turn_id: 'tab-3:t1',
      tool_use_id: 'tu-1',
      result: 'file contents',
      is_error: false,
    });
    expectNoListenerLeaks(adapter);
  });

  it('also accepts backend-canonical tool_start event type', async () => {
    const { bridge, adapter, calls } = makeBridge();

    await bridge.runTurn({
      tabId: 'tab-3b',
      rpcCall: async () => {
        queueMicrotask(() => {
          adapter.emit('chat:chunk', {
            tabId: 'tab-3b',
            sessionId: 'tab-3b',
            event: {
              eventType: 'tool_start',
              toolCallId: 'tu-2',
              toolName: 'Bash',
              toolInput: { command: 'ls' },
            },
          });
          adapter.emit('chat:complete', {
            tabId: 'tab-3b',
            sessionId: 'tab-3b',
          });
        });
        return { success: true };
      },
    });

    const toolUse = calls.filter((c) => c.method === 'agent.tool_use');
    expect(toolUse).toHaveLength(1);
    expect(toolUse[0]?.params).toMatchObject({
      tool_use_id: 'tu-2',
      tool_name: 'Bash',
    });
    expectNoListenerLeaks(adapter);
  });

  it('error path — text_delta → chat:error resolves failure with payload.error preserved', async () => {
    const { bridge, adapter } = makeBridge();

    const result = await bridge.runTurn({
      tabId: 'tab-4',
      rpcCall: async () => {
        queueMicrotask(() => {
          adapter.emit('chat:chunk', {
            tabId: 'tab-4',
            sessionId: 'tab-4',
            event: {
              eventType: 'text_delta',
              messageId: 'm-4',
              delta: 'partial',
            },
          });
          adapter.emit('chat:error', {
            tabId: 'tab-4',
            sessionId: 'tab-4',
            error: 'rate limited',
          });
        });
        return { success: true };
      },
    });

    expect(result).toEqual({
      success: false,
      error: 'rate limited',
      sessionId: 'tab-4',
    });
    expectNoListenerLeaks(adapter);
  });

  it('message_start swap — chunk(message_start) flips synthetic tabId for real sessionId', async () => {
    const { bridge, adapter, calls } = makeBridge();

    const result = await bridge.runTurn({
      tabId: 'cli-synth-tab',
      rpcCall: async () => {
        queueMicrotask(() => {
          adapter.emit('chat:chunk', {
            tabId: 'cli-synth-tab',
            sessionId: 'real-uuid-abc',
            event: {
              eventType: 'message_start',
              sessionId: 'real-uuid-abc',
              messageId: 'm-5',
            },
          });
          adapter.emit('chat:chunk', {
            tabId: 'cli-synth-tab',
            sessionId: 'real-uuid-abc',
            event: {
              eventType: 'text_delta',
              messageId: 'm-5',
              delta: 'hi',
            },
          });
          adapter.emit('chat:complete', {
            tabId: 'cli-synth-tab',
            sessionId: 'real-uuid-abc',
          });
        });
        return { success: true };
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unreachable');
    expect(result.sessionId).toBe('real-uuid-abc');

    const messages = calls.filter((c) => c.method === 'agent.message');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.params).toMatchObject({
      session_id: 'real-uuid-abc',
      text: 'hi',
    });
    // Critically — NOT the synthetic tab id.
    expect(
      (messages[0]?.params as Record<string, unknown>)['session_id'],
    ).not.toBe('cli-synth-tab');
    expectNoListenerLeaks(adapter);
  });

  it('multi-tabId isolation — concurrent runTurn(tabA) + runTurn(tabB) resolve independently', async () => {
    const { bridge, adapter, calls } = makeBridge();

    const turnA = bridge.runTurn({
      tabId: 'tab-A',
      rpcCall: async () => ({ success: true }),
    });
    const turnB = bridge.runTurn({
      tabId: 'tab-B',
      rpcCall: async () => ({ success: true }),
    });

    // Interleave events — each turn must see only its own.
    await Promise.resolve();
    adapter.emit('chat:chunk', {
      tabId: 'tab-A',
      sessionId: 'tab-A',
      event: { eventType: 'text_delta', messageId: 'a1', delta: 'A1' },
    });
    adapter.emit('chat:chunk', {
      tabId: 'tab-B',
      sessionId: 'tab-B',
      event: { eventType: 'text_delta', messageId: 'b1', delta: 'B1' },
    });
    adapter.emit('chat:chunk', {
      tabId: 'tab-A',
      sessionId: 'tab-A',
      event: { eventType: 'text_delta', messageId: 'a1', delta: 'A2' },
    });
    adapter.emit('chat:complete', { tabId: 'tab-B', sessionId: 'tab-B' });
    adapter.emit('chat:complete', { tabId: 'tab-A', sessionId: 'tab-A' });

    const [resA, resB] = await Promise.all([turnA, turnB]);

    expect(resA.success).toBe(true);
    expect(resB.success).toBe(true);
    if (!resA.success || !resB.success) throw new Error('unreachable');
    expect(resA.sessionId).toBe('tab-A');
    expect(resB.sessionId).toBe('tab-B');

    const messages = calls.filter((c) => c.method === 'agent.message');
    // Two for tab-A, one for tab-B — each correctly tagged with its session_id.
    const tabAMessages = messages.filter(
      (m) => (m.params as Record<string, unknown>)['session_id'] === 'tab-A',
    );
    const tabBMessages = messages.filter(
      (m) => (m.params as Record<string, unknown>)['session_id'] === 'tab-B',
    );
    expect(tabAMessages).toHaveLength(2);
    expect(tabBMessages).toHaveLength(1);

    expectNoListenerLeaks(adapter);
  });

  it('abort signal — signal.abort() during in-flight resolves cancelled', async () => {
    const { bridge, adapter } = makeBridge();
    const ac = new AbortController();

    const promise = bridge.runTurn({
      tabId: 'tab-cancel',
      rpcCall: async () => ({ success: true }),
      abortSignal: ac.signal,
    });

    // Allow the rpcCall microtask to settle before aborting.
    await Promise.resolve();
    ac.abort();

    const result = await promise;
    expect(result).toEqual({
      success: false,
      error: 'aborted',
      cancelled: true,
    });
    expectNoListenerLeaks(adapter);
  });

  it('abort signal — already-aborted signal short-circuits before awaiting events', async () => {
    const { bridge, adapter } = makeBridge();
    const ac = new AbortController();
    ac.abort();

    const result = await bridge.runTurn({
      tabId: 'tab-pre-abort',
      rpcCall: async () => ({ success: true }),
      abortSignal: ac.signal,
    });

    expect(result).toMatchObject({ cancelled: true, success: false });
    expectNoListenerLeaks(adapter);
  });

  it('rpcCall rejection — bridge surfaces the error and detaches', async () => {
    const { bridge, adapter } = makeBridge();

    const result = await bridge.runTurn({
      tabId: 'tab-rpc-throw',
      rpcCall: async () => {
        throw new Error('rpc transport down');
      },
    });

    expect(result).toEqual({
      success: false,
      error: 'rpc transport down',
      sessionId: 'tab-rpc-throw',
    });
    expectNoListenerLeaks(adapter);
  });

  // P1 Fix 3 — defensive backstop on `{ success: false }` ack from rpcCall.
  // Without this, the bridge waits forever in `outerPromise` because the
  // backend never broadcasts a terminal `chat:complete | chat:error`.
  it('rpcCall ack { success: false } — bridge settles deterministically without hanging', async () => {
    const { bridge, adapter } = makeBridge();

    const result = await bridge.runTurn({
      tabId: 'tab-rpc-rejected',
      rpcCall: async () => ({ success: false }),
    });

    expect(result.success).toBe(false);
    if (result.success === true) throw new Error('unreachable');
    expect(result.error).toContain('rpc rejected');
    expect(result.sessionId).toBe('tab-rpc-rejected');
    expectNoListenerLeaks(adapter);
  });

  it('rpcCall ack { success: false, error: "..." } — bridge preserves ack error string', async () => {
    const { bridge, adapter } = makeBridge();

    const result = await bridge.runTurn({
      tabId: 'tab-rpc-rejected-msg',
      // The ack carries a descriptive error string — bridge must surface it.
      rpcCall: async () =>
        ({ success: false, error: 'auth required' }) as {
          success: boolean;
        },
    });

    expect(result.success).toBe(false);
    if (result.success === true) throw new Error('unreachable');
    expect(result.error).toBe('auth required');
    expectNoListenerLeaks(adapter);
  });

  // P1 Fix 3 — `{ success: false }` ack must clean up the timeout handle so
  // no dangling setTimeout keeps the test/process event loop alive after the
  // bridge settles. Use fake timers to assert no pending timers remain.
  it('rpcCall ack { success: false } with timeoutMs — clears timeout on settle (no dangling timers)', async () => {
    jest.useFakeTimers();
    try {
      const { bridge, adapter } = makeBridge();

      const result = await bridge.runTurn({
        tabId: 'tab-rpc-rejected-cleanup',
        rpcCall: async () => ({ success: false }),
        // Long timeout that, if not cleared, would keep a pending timer alive
        // after the bridge settles via the {success:false} backstop.
        timeoutMs: 60_000,
      });

      expect(result.success).toBe(false);
      if (result.success === true) throw new Error('unreachable');
      expect(result.error).toContain('rpc rejected');
      // Critical: the timeout handle MUST have been cleared by `finally`.
      // Jest's fake-timer queue is empty when no scheduled timers remain.
      expect(jest.getTimerCount()).toBe(0);
      expectNoListenerLeaks(adapter);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rpcCall throw with timeoutMs — clears timeout on settle (no dangling timers)', async () => {
    jest.useFakeTimers();
    try {
      const { bridge, adapter } = makeBridge();
      const result = await bridge.runTurn({
        tabId: 'tab-rpc-throw-cleanup',
        rpcCall: async () => {
          throw new Error('rpc transport down');
        },
        timeoutMs: 60_000,
      });
      expect(result.success).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
      expectNoListenerLeaks(adapter);
    } finally {
      jest.useRealTimers();
    }
  });

  it('timeout — elapsed timeoutMs with no terminal event resolves failure', async () => {
    jest.useFakeTimers();
    try {
      const { bridge, adapter } = makeBridge();

      const promise = bridge.runTurn({
        tabId: 'tab-timeout',
        rpcCall: async () => ({ success: true }),
        timeoutMs: 1000,
      });

      // Advance past the timeout — no chunks ever arrived.
      jest.advanceTimersByTime(1001);
      // Pump any pending microtasks queued by the rpcCall promise.
      await Promise.resolve();
      const result = await promise;

      expect(result.success).toBe(false);
      if (result.success === true) throw new Error('unreachable');
      expect(result.error).toContain('timed out');
      expectNoListenerLeaks(adapter);
    } finally {
      jest.useRealTimers();
    }
  });

  it('cross-tab events on the same adapter are ignored', async () => {
    const { bridge, adapter, calls } = makeBridge();

    const result = await bridge.runTurn({
      tabId: 'tab-target',
      rpcCall: async () => {
        queueMicrotask(() => {
          // Foreign tabId — must be ignored.
          adapter.emit('chat:chunk', {
            tabId: 'tab-other',
            sessionId: 'tab-other',
            event: {
              eventType: 'text_delta',
              messageId: 'foreign',
              delta: 'NOPE',
            },
          });
          adapter.emit('chat:chunk', {
            tabId: 'tab-target',
            sessionId: 'tab-target',
            event: {
              eventType: 'text_delta',
              messageId: 'mine',
              delta: 'YES',
            },
          });
          adapter.emit('chat:complete', {
            tabId: 'tab-target',
            sessionId: 'tab-target',
          });
        });
        return { success: true };
      },
    });

    expect(result.success).toBe(true);
    const messages = calls.filter((c) => c.method === 'agent.message');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.params).toMatchObject({ text: 'YES' });
    expectNoListenerLeaks(adapter);
  });

  it('non-target eventTypes (tool_delta, agent_start, ...) are silently dropped', async () => {
    const { bridge, adapter, calls } = makeBridge();

    await bridge.runTurn({
      tabId: 'tab-drop',
      rpcCall: async () => {
        queueMicrotask(() => {
          adapter.emit('chat:chunk', {
            tabId: 'tab-drop',
            sessionId: 'tab-drop',
            event: { eventType: 'tool_delta', toolCallId: 'x', delta: '{' },
          });
          adapter.emit('chat:chunk', {
            tabId: 'tab-drop',
            sessionId: 'tab-drop',
            event: { eventType: 'agent_start', toolCallId: 'y' },
          });
          adapter.emit('chat:complete', {
            tabId: 'tab-drop',
            sessionId: 'tab-drop',
          });
        });
        return { success: true };
      },
    });

    expect(calls).toHaveLength(0);
    expectNoListenerLeaks(adapter);
  });
});
