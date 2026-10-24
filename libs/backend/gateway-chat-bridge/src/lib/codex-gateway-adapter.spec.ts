import 'reflect-metadata';
import {
  CodexParityGate,
  type CodexContext,
  type CodexRuntimeEvent,
} from '@ptah-extension/codex-runtime';
import type { FlatStreamEventUnion } from '@ptah-extension/shared';
import { CodexGatewayAdapter } from './codex-gateway-adapter';

jest.mock('@ptah-extension/codex-runtime', () => ({
  CodexParityGate: jest
    .fn()
    .mockImplementation(() => ({ isEnabled: () => true })),
}));

const identity = {
  contextId: 'context',
  processGeneration: 1,
  threadId: 'thread',
  normalizedHome: '/home',
  workspaceId: 'workspace',
  providerId: 'provider',
  profileFingerprint: 'fingerprint',
};
const base = {
  contextId: 'context',
  processGeneration: 1,
  threadId: 'thread',
  turnId: 'turn',
  sequence: 1,
};
const terminal: CodexRuntimeEvent = {
  ...base,
  type: 'terminal',
  status: 'completed',
};

function setup(events: CodexRuntimeEvent[] = [terminal]) {
  const context: jest.Mocked<CodexContext> = {
    identity,
    events: jest.fn().mockImplementation(() =>
      (async function* () {
        yield* events;
      })(),
    ),
    startTurn: jest
      .fn()
      .mockResolvedValue({ threadId: 'thread', turnId: 'turn', revision: 0 }),
    steer: jest
      .fn()
      .mockResolvedValue({ threadId: 'thread', turnId: 'turn', revision: 1 }),
    interrupt: jest.fn().mockResolvedValue(true),
    updateNextTurn: jest.fn(),
    compact: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const sink = { request: jest.fn().mockResolvedValue('decline') };
  const logger = { warn: jest.fn() };
  const platform = { platform: 'win32', arch: 'x64' };
  return {
    context,
    sink,
    logger,
    platform,
    adapter: new CodexGatewayAdapter(context, sink, logger, platform),
  };
}
async function collect(stream: AsyncIterable<FlatStreamEventUnion>) {
  const result: FlatStreamEventUnion[] = [];
  for await (const event of stream) result.push(event);
  return result;
}
function text(events: FlatStreamEventUnion[]) {
  return events
    .flatMap((event) => (event.eventType === 'text_delta' ? event.delta : []))
    .join('');
}

describe('CodexGatewayAdapter', () => {
  it('keeps the real production gate disabled before any turn or subscription', async () => {
    const actual = jest.requireActual<
      typeof import('@ptah-extension/codex-runtime')
    >('@ptah-extension/codex-runtime');
    jest
      .mocked(CodexParityGate)
      .mockImplementationOnce(() => new actual.CodexParityGate());
    const { adapter, context } = setup();
    await expect(collect(adapter.startTurn({ text: 'hi' }))).rejects.toThrow(
      'parity gate',
    );
    expect(() => adapter.steer({ text: 'edit' })).toThrow('parity gate');
    expect(context.startTurn).not.toHaveBeenCalled();
    expect(context.events).not.toHaveBeenCalled();
  });

  it('rejects a missing sink before starting', async () => {
    const { context, logger, platform } = setup();
    const adapter: CodexGatewayAdapter = Reflect.construct(
      CodexGatewayAdapter,
      [context, undefined, logger, platform],
    );
    await expect(collect(adapter.startTurn({ text: 'hi' }))).rejects.toThrow(
      'sink is required',
    );
    expect(context.startTurn).not.toHaveBeenCalled();
  });

  it('subscribes before starting, preserves deltas and final-only text, and stops on the first terminal', async () => {
    const { adapter, context } = setup([
      { ...base, type: 'textDelta', itemId: 'a', delta: 'hel' },
      { ...base, sequence: 2, type: 'textFinal', itemId: 'a', text: 'hello' },
      { ...base, sequence: 3, type: 'textFinal', itemId: 'b', text: ' world' },
      { ...terminal, sequence: 4 },
      { ...terminal, sequence: 5 },
    ]);
    const result = await collect(adapter.startTurn({ text: 'hi' }));
    expect(text(result)).toBe('hello world');
    expect(
      result.filter((e) => e.eventType === 'message_complete'),
    ).toHaveLength(1);
    expect(context.events.mock.invocationCallOrder[0]).toBeLessThan(
      context.startTurn.mock.invocationCallOrder[0],
    );
    expect(context.events.mock.calls[0][0].aborted).toBe(true);
    expect(context.close).not.toHaveBeenCalled();
    expect(result.every((e) => e.sessionId === 'thread')).toBe(true);
  });

  it('does not duplicate final text after deltas or another final', async () => {
    const { adapter } = setup([
      { ...base, type: 'textDelta', itemId: 'a', delta: 'hello' },
      { ...base, type: 'textFinal', itemId: 'a', text: 'hello' },
      { ...base, type: 'textFinal', itemId: 'a', text: 'hello' },
      terminal,
    ]);
    expect(text(await collect(adapter.startTurn({ text: 'hi' })))).toBe(
      'hello',
    );
  });

  it('projects tool lifecycle, reasoning and reported usage without exposing them as chat text', async () => {
    const { adapter } = setup([
      {
        ...base,
        type: 'toolStarted',
        toolId: 'tool',
        toolName: 'run',
        input: { command: 'echo' },
      },
      {
        ...base,
        type: 'toolCompleted',
        toolId: 'tool',
        output: 'done',
        status: 'failed',
      },
      {
        ...base,
        type: 'reasoning',
        itemId: 'r',
        text: 'think',
        phase: 'delta',
      },
      {
        ...base,
        type: 'reasoning',
        itemId: 'r',
        text: 'think',
        phase: 'final',
      },
      {
        ...base,
        type: 'usage',
        usage: { inputTokens: 3, outputTokens: 2, costUsd: 0.1 },
      },
      terminal,
    ]);
    const result = await collect(adapter.startTurn({ text: 'hi' }));
    expect(result.map((e) => e.eventType)).toEqual([
      'tool_start',
      'tool_result',
      'thinking_delta',
      'message_delta',
      'message_complete',
    ]);
    expect(result[1]).toMatchObject({ toolCallId: 'tool', isError: true });
    expect(result[4]).toMatchObject({
      tokenUsage: { input: 3, output: 2 },
      cost: 0.1,
    });
    expect(text(result)).toBe('');
  });

  it('never invents missing token counters', async () => {
    const { adapter } = setup([
      { ...base, type: 'usage', usage: { inputTokens: 3 } },
      terminal,
    ]);
    const result = await collect(adapter.startTurn({ text: 'hi' }));
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty('tokenUsage', expect.anything());
  });

  it('ignores stale context, generation, thread and turn events', async () => {
    const delta: CodexRuntimeEvent = {
      ...base,
      type: 'textDelta',
      itemId: 'a',
      delta: 'wrong',
    };
    const { adapter } = setup([
      { ...delta, contextId: 'other' },
      { ...delta, processGeneration: 0 },
      { ...delta, threadId: 'other' },
      { ...delta, turnId: 'other' },
      terminal,
    ]);
    expect(text(await collect(adapter.startTurn({ text: 'hi' })))).toBe('');
  });

  it('keeps files, images, compaction and approval events out of outbound text', async () => {
    const { adapter, sink } = setup([
      { ...base, type: 'file', itemId: 'f', path: '/file', operation: 'add' },
      {
        ...base,
        type: 'image',
        itemId: 'image',
        image: { type: 'image', data: 'encoded', mediaType: 'image/png' },
      },
      { ...base, type: 'compaction', phase: 'completed' },
      {
        ...base,
        type: 'approvalSettled',
        correlation: { ...base, requestId: 1 },
        decision: 'accept',
      },
      terminal,
    ]);
    expect(text(await collect(adapter.startTurn({ text: 'hi' })))).toBe('');
    expect(sink.request).not.toHaveBeenCalled();
  });

  it.each(['error', 'failed', 'empty'])(
    'fails visibly for %s without fallback',
    async (kind) => {
      const error = {
        code: 'failed',
        message: 'Sanitized failure',
        retryable: false,
      };
      const events: CodexRuntimeEvent[] =
        kind === 'error'
          ? [{ ...base, type: 'error', error }]
          : kind === 'failed'
            ? [{ ...terminal, status: 'failed', error }]
            : [];
      const { adapter, context } = setup(events);
      await expect(
        collect(adapter.startTurn({ text: 'hi' })),
      ).rejects.toThrow();
      expect(context.startTurn).toHaveBeenCalledTimes(1);
      expect(context.events.mock.calls[0][0].aborted).toBe(true);
    },
  );

  it('releases the subscription and closes abandoned work on consumer return', async () => {
    const { adapter, context } = setup([
      { ...base, type: 'textDelta', itemId: 'a', delta: 'hi' },
      terminal,
    ]);
    for await (const event of adapter.startTurn({ text: 'hi' })) {
      expect(event.eventType).toBe('text_delta');
      break;
    }
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(context.events.mock.calls[0][0].aborted).toBe(true);
  });

  it('releases a subscription when start fails', async () => {
    const { adapter, context } = setup();
    context.startTurn.mockRejectedValue(new Error('start failed'));
    await expect(collect(adapter.startTurn({ text: 'hi' }))).rejects.toThrow(
      'start failed',
    );
    expect(context.events.mock.calls[0][0].aborted).toBe(true);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('forwards steer, interrupt and close to the exact context', async () => {
    const { adapter, context } = setup();
    await adapter.steer({ text: 'follow-up' });
    await expect(adapter.interrupt('turn')).resolves.toBe(true);
    await adapter.close();
    expect(context.steer).toHaveBeenCalledWith({ text: 'follow-up' });
    expect(context.interrupt).toHaveBeenCalledWith('turn');
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('does not start an already cancelled turn', async () => {
    const { adapter, context } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      collect(adapter.startTurn({ text: 'hi', signal: controller.signal })),
    ).rejects.toThrow('cancelled');
    expect(context.startTurn).not.toHaveBeenCalled();
  });

  it('cancels a running subscription and closes the context on input abort', async () => {
    const { adapter, context } = setup();
    const controller = new AbortController();
    context.events.mockImplementation((signal) =>
      (async function* () {
        yield { ...base, type: 'textDelta' as const, itemId: 'a', delta: 'hi' };
        expect(signal.aborted).toBe(true);
      })(),
    );
    const stream = adapter.startTurn({ text: 'hi', signal: controller.signal });
    const iterator = stream[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ delta: 'hi' });
    controller.abort();
    await expect(iterator.next()).rejects.toThrow('cancelled');
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('settles interrupted turns once without waiting for context close', async () => {
    const { adapter, context } = setup([
      { ...terminal, status: 'interrupted' },
    ]);
    const result = await collect(adapter.startTurn({ text: 'hi' }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      eventType: 'message_complete',
      stopReason: 'interrupted',
    });
    expect(context.close).not.toHaveBeenCalled();
  });
});
