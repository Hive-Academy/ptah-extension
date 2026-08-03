import { EventEmitter } from 'node:events';
import { ChatStreamController, type ChatTransport } from './use-chat.js';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RpcCall {
  method: string;
  params: Record<string, unknown>;
}

interface MockResponse {
  success: boolean;
  data?: { sessionId?: string };
  error?: string;
}

function makeTransport(
  responder: (call: RpcCall) => MockResponse = () => ({ success: true }),
): { transport: ChatTransport; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  const transport: ChatTransport = {
    call: async <TParams, TResult>(method: string, params: TParams) => {
      const call = { method, params: params as Record<string, unknown> };
      calls.push(call);
      const result = responder(call);
      return result as {
        success: boolean;
        data?: TResult;
        error?: string;
        errorCode?: string;
      };
    },
  };
  return { transport, calls };
}

function textDelta(
  tabId: string,
  sessionId: string,
  delta: string,
  source?: 'stream' | 'complete' | 'history',
  blockIndex = 0,
  messageId = 'm',
) {
  return {
    tabId,
    sessionId,
    event: {
      id: 'e',
      eventType: 'text_delta',
      timestamp: Date.now(),
      sessionId,
      ...(source ? { source } : {}),
      messageId,
      blockIndex,
      delta,
    },
  };
}

describe('ChatStreamController', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('generates a UUID-v4 tabId per conversation', () => {
    const { transport } = makeTransport();
    const pushAdapter = new EventEmitter();
    const c = new ChatStreamController({
      transport,
      pushAdapter,
      onChange: () => undefined,
    });
    expect(c.getTabId()).toMatch(UUID_V4);
    c.dispose();
  });

  it('first turn issues chat:start with tabId + prompt (not message)', async () => {
    const { transport, calls } = makeTransport();
    const pushAdapter = new EventEmitter();
    const c = new ChatStreamController({
      transport,
      pushAdapter,
      onChange: () => undefined,
    });
    await c.send('hello');
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('chat:start');
    expect(calls[0].params).toMatchObject({
      tabId: c.getTabId(),
      prompt: 'hello',
    });
    expect(calls[0].params).not.toHaveProperty('message');
    c.dispose();
  });

  it('captures sessionId then second turn issues chat:continue', async () => {
    const { transport, calls } = makeTransport(() => ({
      success: true,
      data: { sessionId: 'sdk-session-1' },
    }));
    const pushAdapter = new EventEmitter();
    const c = new ChatStreamController({
      transport,
      pushAdapter,
      onChange: () => undefined,
    });
    await c.send('first');
    pushAdapter.emit('chat:complete', {
      tabId: c.getTabId(),
      sessionId: 'sdk-session-1',
    });
    await c.send('second');
    expect(calls[1].method).toBe('chat:continue');
    expect(calls[1].params).toMatchObject({
      tabId: c.getTabId(),
      sessionId: 'sdk-session-1',
      prompt: 'second',
    });
    c.dispose();
  });

  it('accumulates text_delta into the streaming assistant bubble after debounce', async () => {
    const { transport } = makeTransport();
    const pushAdapter = new EventEmitter();
    const c = new ChatStreamController({
      transport,
      pushAdapter,
      onChange: () => undefined,
      flushIntervalMs: 100,
    });
    await c.send('hi');
    const tabId = c.getTabId();
    pushAdapter.emit('chat:chunk', textDelta(tabId, 's1', 'Hel'));
    pushAdapter.emit('chat:chunk', textDelta(tabId, 's1', 'lo'));

    const assistantBefore = c.messages.find((m) => m.role === 'assistant');
    expect(assistantBefore?.content).toBe('');

    jest.advanceTimersByTime(100);
    const assistantAfter = c.messages.find((m) => m.role === 'assistant');
    expect(assistantAfter?.content).toBe('Hello');
    c.dispose();
  });

  it('ignores chunks for a different tabId (cross-session isolation)', async () => {
    const { transport } = makeTransport();
    const pushAdapter = new EventEmitter();
    const c = new ChatStreamController({
      transport,
      pushAdapter,
      onChange: () => undefined,
    });
    await c.send('hi');
    pushAdapter.emit('chat:chunk', textDelta('other-tab', 's9', 'leak'));
    jest.advanceTimersByTime(200);
    const assistant = c.messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toBe('');
    c.dispose();
  });

  it('collapses thinking_delta onto the message thinking field', async () => {
    const { transport } = makeTransport();
    const pushAdapter = new EventEmitter();
    const c = new ChatStreamController({
      transport,
      pushAdapter,
      onChange: () => undefined,
    });
    await c.send('hi');
    const tabId = c.getTabId();
    pushAdapter.emit('chat:chunk', {
      tabId,
      sessionId: 's1',
      event: {
        id: 'e',
        eventType: 'thinking_delta',
        timestamp: Date.now(),
        sessionId: 's1',
        messageId: 'm',
        blockIndex: 0,
        delta: 'pondering',
      },
    });
    const assistant = c.messages.find((m) => m.role === 'assistant');
    expect(assistant?.thinking).toBe('pondering');
    c.dispose();
  });

  it('renders tool_start then tool_result as a compact row', async () => {
    const { transport } = makeTransport();
    const pushAdapter = new EventEmitter();
    const c = new ChatStreamController({
      transport,
      pushAdapter,
      onChange: () => undefined,
    });
    await c.send('hi');
    const tabId = c.getTabId();
    pushAdapter.emit('chat:chunk', {
      tabId,
      sessionId: 's1',
      event: {
        id: 'e1',
        eventType: 'tool_start',
        timestamp: Date.now(),
        sessionId: 's1',
        messageId: 'm',
        toolCallId: 't1',
        toolName: 'Read',
        isTaskTool: false,
      },
    });
    let assistant = c.messages.find((m) => m.role === 'assistant');
    expect(assistant?.tools).toEqual([
      { id: 't1', toolName: 'Read', status: 'running' },
    ]);
    pushAdapter.emit('chat:chunk', {
      tabId,
      sessionId: 's1',
      event: {
        id: 'e2',
        eventType: 'tool_result',
        timestamp: Date.now(),
        sessionId: 's1',
        messageId: 'm',
        toolCallId: 't1',
        output: 'ok',
        isError: false,
      },
    });
    assistant = c.messages.find((m) => m.role === 'assistant');
    expect(assistant?.tools[0].status).toBe('ok');
    c.dispose();
  });

  it('finalizes streaming on chat:complete', async () => {
    const { transport } = makeTransport();
    const pushAdapter = new EventEmitter();
    const c = new ChatStreamController({
      transport,
      pushAdapter,
      onChange: () => undefined,
    });
    await c.send('hi');
    expect(c.isStreaming).toBe(true);
    pushAdapter.emit('chat:complete', { tabId: c.getTabId(), sessionId: 's1' });
    expect(c.isStreaming).toBe(false);
    const assistant = c.messages.find((m) => m.role === 'assistant');
    expect(assistant?.isStreaming).toBe(false);
    c.dispose();
  });

  it('chat:error appends a system message and stops streaming', async () => {
    const { transport } = makeTransport();
    const pushAdapter = new EventEmitter();
    const c = new ChatStreamController({
      transport,
      pushAdapter,
      onChange: () => undefined,
    });
    await c.send('hi');
    pushAdapter.emit('chat:error', {
      tabId: c.getTabId(),
      sessionId: 's1',
      error: 'boom',
    });
    expect(c.isStreaming).toBe(false);
    const system = c.messages.find((m) => m.role === 'system');
    expect(system?.content).toBe('boom');
    c.dispose();
  });

  it('compaction events set a status notice', async () => {
    const { transport } = makeTransport();
    const pushAdapter = new EventEmitter();
    const c = new ChatStreamController({
      transport,
      pushAdapter,
      onChange: () => undefined,
    });
    await c.send('hi');
    const tabId = c.getTabId();
    pushAdapter.emit('chat:chunk', {
      tabId,
      sessionId: 's1',
      event: {
        id: 'e',
        eventType: 'compaction_start',
        timestamp: Date.now(),
        sessionId: 's1',
        messageId: 'm',
        trigger: 'auto',
        preTokens: 1000,
      },
    });
    expect(c.status?.text).toContain('Compacting');
    c.dispose();
  });

  it('stop issues chat:abort with the resolved sessionId', async () => {
    const { transport, calls } = makeTransport(() => ({
      success: true,
      data: { sessionId: 'sdk-7' },
    }));
    const pushAdapter = new EventEmitter();
    const c = new ChatStreamController({
      transport,
      pushAdapter,
      onChange: () => undefined,
    });
    await c.send('hi');
    await c.stop();
    const abort = calls.find((call) => call.method === 'chat:abort');
    expect(abort?.params).toEqual({ sessionId: 'sdk-7' });
    c.dispose();
  });

  it('stop falls back to tabId when no sessionId resolved yet', async () => {
    const { transport, calls } = makeTransport();
    const pushAdapter = new EventEmitter();
    const c = new ChatStreamController({
      transport,
      pushAdapter,
      onChange: () => undefined,
    });
    await c.send('hi');
    await c.stop();
    const abort = calls.find((call) => call.method === 'chat:abort');
    expect(abort?.params).toEqual({ sessionId: c.getTabId() });
    c.dispose();
  });

  it('double-submit guard prevents a second concurrent turn', async () => {
    const { transport, calls } = makeTransport();
    const pushAdapter = new EventEmitter();
    const c = new ChatStreamController({
      transport,
      pushAdapter,
      onChange: () => undefined,
    });
    await c.send('one');
    await c.send('two');
    expect(calls).toHaveLength(1);
    c.dispose();
  });

  it('watchdog times out the turn after the configured window', async () => {
    const { transport } = makeTransport();
    const pushAdapter = new EventEmitter();
    const c = new ChatStreamController({
      transport,
      pushAdapter,
      onChange: () => undefined,
      watchdogMs: 60_000,
    });
    await c.send('hi');
    jest.advanceTimersByTime(60_000);
    expect(c.isStreaming).toBe(false);
    const system = c.messages.find((m) => m.role === 'system');
    expect(system?.content).toContain('timed out');
    c.dispose();
  });

  /**
   * The backend emits every assistant text block twice — incrementally from
   * `stream-event.transformer.ts` (`source: 'stream'`) and once more in full
   * from `assistant-message.transformer.ts` (`source: 'complete'`). Appending
   * both rendered "Hey! What are you working on?" twice in the live TUI.
   */
  describe('duplicate text_delta emission (source discrimination)', () => {
    it('does not double the reply when a source:complete delta repeats the block', async () => {
      const { transport } = makeTransport();
      const pushAdapter = new EventEmitter();
      const c = new ChatStreamController({
        transport,
        pushAdapter,
        onChange: () => undefined,
        flushIntervalMs: 100,
      });
      await c.send('hey');
      const tabId = c.getTabId();

      // Recorded sequence: incremental stream deltas...
      pushAdapter.emit('chat:chunk', textDelta(tabId, 's1', 'Hey! ', 'stream'));
      pushAdapter.emit(
        'chat:chunk',
        textDelta(tabId, 's1', 'What are you working on?', 'stream'),
      );
      // ...then the definitive re-emission of the SAME block, in full.
      pushAdapter.emit(
        'chat:chunk',
        textDelta(tabId, 's1', 'Hey! What are you working on?', 'complete'),
      );
      jest.advanceTimersByTime(100);

      const assistant = c.messages.find((m) => m.role === 'assistant');
      expect(assistant?.content).toBe('Hey! What are you working on?');
      c.dispose();
    });

    it('keeps separate text blocks distinct rather than collapsing them', async () => {
      const { transport } = makeTransport();
      const pushAdapter = new EventEmitter();
      const c = new ChatStreamController({
        transport,
        pushAdapter,
        onChange: () => undefined,
        flushIntervalMs: 100,
      });
      await c.send('hi');
      const tabId = c.getTabId();

      pushAdapter.emit(
        'chat:chunk',
        textDelta(tabId, 's1', 'one', 'stream', 0),
      );
      pushAdapter.emit(
        'chat:chunk',
        textDelta(tabId, 's1', 'two', 'stream', 1),
      );
      pushAdapter.emit(
        'chat:chunk',
        textDelta(tabId, 's1', 'one', 'complete', 0),
      );
      pushAdapter.emit(
        'chat:chunk',
        textDelta(tabId, 's1', 'two', 'complete', 1),
      );
      jest.advanceTimersByTime(100);

      const assistant = c.messages.find((m) => m.role === 'assistant');
      expect(assistant?.content).toBe('onetwo');
      c.dispose();
    });

    it('treats source:history the same as source:complete (replace)', async () => {
      const { transport } = makeTransport();
      const pushAdapter = new EventEmitter();
      const c = new ChatStreamController({
        transport,
        pushAdapter,
        onChange: () => undefined,
        flushIntervalMs: 100,
      });
      await c.send('hi');
      const tabId = c.getTabId();
      pushAdapter.emit('chat:chunk', textDelta(tabId, 's1', 'part', 'stream'));
      pushAdapter.emit(
        'chat:chunk',
        textDelta(tabId, 's1', 'the whole thing', 'history'),
      );
      jest.advanceTimersByTime(100);

      const assistant = c.messages.find((m) => m.role === 'assistant');
      expect(assistant?.content).toBe('the whole thing');
      c.dispose();
    });

    it('still appends when no source is present (legacy stream contract)', async () => {
      const { transport } = makeTransport();
      const pushAdapter = new EventEmitter();
      const c = new ChatStreamController({
        transport,
        pushAdapter,
        onChange: () => undefined,
        flushIntervalMs: 100,
      });
      await c.send('hi');
      const tabId = c.getTabId();
      pushAdapter.emit('chat:chunk', textDelta(tabId, 's1', 'Hel'));
      pushAdapter.emit('chat:chunk', textDelta(tabId, 's1', 'lo'));
      jest.advanceTimersByTime(100);

      const assistant = c.messages.find((m) => m.role === 'assistant');
      expect(assistant?.content).toBe('Hello');
      c.dispose();
    });
  });

  describe('hang recovery', () => {
    /**
     * The reported hang: the second turn's `chat:continue` promise never
     * settled, and because the watchdog used to be armed only *after* that
     * await, it was never created — the TUI sat on "Streaming" forever with
     * the composer disabled and no error.
     */
    it('times out a turn whose RPC promise never settles', async () => {
      const calls: string[] = [];
      const transport: ChatTransport = {
        call: (method: string) => {
          calls.push(method);
          return new Promise(() => undefined); // never settles
        },
      };
      const pushAdapter = new EventEmitter();
      const c = new ChatStreamController({
        transport,
        pushAdapter,
        onChange: () => undefined,
        watchdogMs: 60_000,
      });

      void c.send('hey');
      expect(calls).toEqual(['chat:start']);
      expect(c.isStreaming).toBe(true);

      jest.advanceTimersByTime(60_000);

      expect(c.isStreaming).toBe(false);
      const system = c.messages.find((m) => m.role === 'system');
      expect(system?.content).toContain('timed out');
      c.dispose();
    });

    it('re-enables sending after a watchdog timeout instead of staying wedged', async () => {
      let settle: (() => void) | null = null;
      const calls: string[] = [];
      const transport: ChatTransport = {
        call: (method: string) => {
          calls.push(method);
          return new Promise<never>(() => {
            settle = null;
          });
        },
      };
      const pushAdapter = new EventEmitter();
      const c = new ChatStreamController({
        transport,
        pushAdapter,
        onChange: () => undefined,
        watchdogMs: 1_000,
      });

      void c.send('first');
      jest.advanceTimersByTime(1_000);
      // The in-flight guard must be released, or the user can never retry.
      void c.send('second');

      expect(calls).toHaveLength(2);
      expect(settle).toBeNull();
      c.dispose();
    });

    it('marks the abandoned assistant bubble as no longer streaming', async () => {
      const transport: ChatTransport = {
        call: () => new Promise(() => undefined),
      };
      const pushAdapter = new EventEmitter();
      const c = new ChatStreamController({
        transport,
        pushAdapter,
        onChange: () => undefined,
        watchdogMs: 500,
      });
      void c.send('hey');
      jest.advanceTimersByTime(500);

      const assistant = c.messages.find((m) => m.role === 'assistant');
      expect(assistant?.isStreaming).toBe(false);
      c.dispose();
    });
  });

  describe('session id resolution', () => {
    it('adopts the real SDK id from session:id-resolved for the next turn', async () => {
      const { transport, calls } = makeTransport();
      const pushAdapter = new EventEmitter();
      const c = new ChatStreamController({
        transport,
        pushAdapter,
        onChange: () => undefined,
      });
      await c.send('first');

      // `chat:start` returns `{ success: true }` with no sessionId, so this
      // push event is the only carrier of the real id.
      pushAdapter.emit('session:id-resolved', {
        tabId: c.getTabId(),
        realSessionId: 'real-sdk-uuid',
      });
      pushAdapter.emit('chat:complete', { tabId: c.getTabId() });

      await c.send('second');
      expect(calls[1].method).toBe('chat:continue');
      expect(calls[1].params).toMatchObject({ sessionId: 'real-sdk-uuid' });
      c.dispose();
    });

    it('ignores session:id-resolved addressed to another tab', async () => {
      const { transport } = makeTransport();
      const pushAdapter = new EventEmitter();
      const c = new ChatStreamController({
        transport,
        pushAdapter,
        onChange: () => undefined,
      });
      await c.send('first');
      pushAdapter.emit('session:id-resolved', {
        tabId: 'someone-elses-tab',
        realSessionId: 'not-mine',
      });
      expect(c.getSessionId()).not.toBe('not-mine');
      c.dispose();
    });

    it('detaches the session:id-resolved listener on dispose', () => {
      const { transport } = makeTransport();
      const pushAdapter = new EventEmitter();
      const c = new ChatStreamController({
        transport,
        pushAdapter,
        onChange: () => undefined,
      });
      expect(pushAdapter.listenerCount('session:id-resolved')).toBe(1);
      c.dispose();
      expect(pushAdapter.listenerCount('session:id-resolved')).toBe(0);
    });
  });

  it('detaches all listeners on dispose', () => {
    const { transport } = makeTransport();
    const pushAdapter = new EventEmitter();
    const c = new ChatStreamController({
      transport,
      pushAdapter,
      onChange: () => undefined,
    });
    expect(pushAdapter.listenerCount('chat:chunk')).toBe(1);
    c.dispose();
    expect(pushAdapter.listenerCount('chat:chunk')).toBe(0);
    expect(pushAdapter.listenerCount('chat:complete')).toBe(0);
    expect(pushAdapter.listenerCount('chat:error')).toBe(0);
  });
});
