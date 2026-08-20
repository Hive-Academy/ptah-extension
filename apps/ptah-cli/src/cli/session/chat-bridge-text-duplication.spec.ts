/**
 * `ChatBridge` — duplicate `text_delta` regression specs.
 *
 * The backend emits every assistant text block TWICE:
 *   - incrementally from `stream-event.transformer.ts` (`source: 'stream'`,
 *     `delta` = the next slice), and
 *   - once more in full from `assistant-message.transformer.ts`
 *     (`source: 'complete'`, `delta` = the entire block).
 *
 * The Angular accumulator has always discriminated on `source` (replace for
 * `complete`/`history`, append for `stream`). This bridge did not, so it
 * appended both — doubling the reply in `task.complete.summary.text` and
 * re-notifying the whole thing as an extra `agent.message`.
 */

import { EventEmitter } from 'node:events';

import { ChatBridge } from './chat-bridge.js';

interface NotifyCall {
  method: string;
  params?: Record<string, unknown>;
}

function makeBridge(): {
  bridge: ChatBridge;
  adapter: EventEmitter;
  calls: NotifyCall[];
} {
  const calls: NotifyCall[] = [];
  const notify = jest.fn(async (method: string, params?: unknown) => {
    calls.push({ method, params: params as Record<string, unknown> });
  });
  const adapter = new EventEmitter();
  const bridge = new ChatBridge(adapter, { notify });
  return { bridge, adapter, calls };
}

function expectNoListenerLeaks(adapter: EventEmitter): void {
  expect(adapter.listenerCount('chat:chunk')).toBe(0);
  expect(adapter.listenerCount('chat:complete')).toBe(0);
  expect(adapter.listenerCount('chat:error')).toBe(0);
}

interface DeltaSpec {
  readonly delta: string;
  readonly source?: 'stream' | 'complete' | 'history';
  readonly blockIndex?: number;
}

function emitTurn(
  adapter: EventEmitter,
  tabId: string,
  deltas: readonly DeltaSpec[],
): void {
  for (const spec of deltas) {
    adapter.emit('chat:chunk', {
      tabId,
      sessionId: tabId,
      event: {
        eventType: 'text_delta',
        messageId: 'm-1',
        ...(spec.source ? { source: spec.source } : {}),
        ...(spec.blockIndex === undefined
          ? {}
          : { blockIndex: spec.blockIndex }),
        delta: spec.delta,
      },
    });
  }
  adapter.emit('chat:complete', { tabId, sessionId: tabId });
}

function summaryText(calls: readonly NotifyCall[]): unknown {
  const terminal = calls.filter((c) => c.method === 'task.complete');
  const summary = terminal[0]?.params?.['summary'] as Record<string, unknown>;
  return summary['text'];
}

describe('ChatBridge — duplicate text_delta emission', () => {
  it('does not double the aggregated text when source:complete repeats the block', async () => {
    const { bridge, adapter, calls } = makeBridge();

    const result = await bridge.runTurn({
      tabId: 'tab-dup',
      rpcCall: async () => {
        queueMicrotask(() =>
          emitTurn(adapter, 'tab-dup', [
            { delta: 'Hey! ', source: 'stream', blockIndex: 0 },
            {
              delta: 'What are you working on?',
              source: 'stream',
              blockIndex: 0,
            },
            {
              delta: 'Hey! What are you working on?',
              source: 'complete',
              blockIndex: 0,
            },
          ]),
        );
        return { success: true };
      },
    });

    expect(result.success).toBe(true);
    expect(summaryText(calls)).toBe('Hey! What are you working on?');
    expectNoListenerLeaks(adapter);
  });

  it('does not re-notify the client with the definitive re-emission', async () => {
    const { bridge, adapter, calls } = makeBridge();

    await bridge.runTurn({
      tabId: 'tab-dup2',
      rpcCall: async () => {
        queueMicrotask(() =>
          emitTurn(adapter, 'tab-dup2', [
            { delta: 'only once', source: 'stream' },
            { delta: 'only once', source: 'complete' },
          ]),
        );
        return { success: true };
      },
    });

    const messages = calls.filter((c) => c.method === 'agent.message');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.params?.['text']).toBe('only once');
    expectNoListenerLeaks(adapter);
  });

  it('keeps separate blocks distinct across the definitive re-emission', async () => {
    const { bridge, adapter, calls } = makeBridge();

    await bridge.runTurn({
      tabId: 'tab-blocks',
      rpcCall: async () => {
        queueMicrotask(() =>
          emitTurn(adapter, 'tab-blocks', [
            { delta: 'alpha', source: 'stream', blockIndex: 0 },
            { delta: 'beta', source: 'stream', blockIndex: 1 },
            { delta: 'alpha', source: 'complete', blockIndex: 0 },
            { delta: 'beta', source: 'complete', blockIndex: 1 },
          ]),
        );
        return { success: true };
      },
    });

    expect(summaryText(calls)).toBe('alphabeta');
    expectNoListenerLeaks(adapter);
  });

  it('treats source:history as definitive too', async () => {
    const { bridge, adapter, calls } = makeBridge();

    await bridge.runTurn({
      tabId: 'tab-history',
      rpcCall: async () => {
        queueMicrotask(() =>
          emitTurn(adapter, 'tab-history', [
            { delta: 'part', source: 'stream' },
            { delta: 'the whole thing', source: 'history' },
          ]),
        );
        return { success: true };
      },
    });

    expect(summaryText(calls)).toBe('the whole thing');
    expectNoListenerLeaks(adapter);
  });

  it('still appends when no source field is present (legacy contract)', async () => {
    const { bridge, adapter, calls } = makeBridge();

    await bridge.runTurn({
      tabId: 'tab-legacy',
      rpcCall: async () => {
        queueMicrotask(() =>
          emitTurn(adapter, 'tab-legacy', [
            { delta: 'Hello ' },
            { delta: 'world' },
          ]),
        );
        return { success: true };
      },
    });

    expect(summaryText(calls)).toBe('Hello world');
    const messages = calls.filter((c) => c.method === 'agent.message');
    expect(messages).toHaveLength(2);
    expectNoListenerLeaks(adapter);
  });
});
