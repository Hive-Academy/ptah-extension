import 'reflect-metadata';
import {
  registerCodexRuntime,
  resolveGatedCodexRuntime,
  type CodexContext,
  type CodexRuntimeEvent,
} from '@ptah-extension/codex-runtime';
import { container } from 'tsyringe';
import type { FlatStreamEventUnion } from '@ptah-extension/shared';
import { CodexGatewayAdapter } from './codex-gateway-adapter';

jest.mock('@ptah-extension/codex-runtime', () => ({
  registerCodexRuntime: jest.fn(),
  resolveGatedCodexRuntime: jest.fn(),
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

async function setup(events: CodexRuntimeEvent[] = [terminal]) {
  const context: jest.Mocked<CodexContext> = {
    identity,
    events: jest.fn().mockImplementation(() =>
      (async function* () {
        yield* events.map((event, sequence) => ({ ...event, sequence }));
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
  const runtime = { open: jest.fn().mockResolvedValue(context) };
  jest
    .mocked(resolveGatedCodexRuntime)
    .mockReturnValue(
      runtime as unknown as ReturnType<typeof resolveGatedCodexRuntime>,
    );
  const scope = container.createChildContainer();
  const ports = {} as Parameters<typeof CodexGatewayAdapter.open>[1];
  const profile = {} as Parameters<typeof CodexGatewayAdapter.open>[5];
  const open = () =>
    CodexGatewayAdapter.open(
      scope,
      ports,
      sink,
      logger,
      platform,
      profile,
      identity,
    );
  return {
    runtime,
    scope,
    ports,
    profile,
    open,
    context,
    sink,
    logger,
    platform,
    adapter: await open(),
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
  it('opens through the gate using the registered sink and exact resume identity', async () => {
    const { runtime, scope, ports, profile, sink, platform } = await setup();
    expect(registerCodexRuntime).toHaveBeenLastCalledWith(scope, {
      ...ports,
      sink,
    });
    expect(resolveGatedCodexRuntime).toHaveBeenLastCalledWith(
      scope,
      'gateway',
      platform,
    );
    expect(runtime.open).toHaveBeenCalledWith(profile, identity);
  });

  it('keeps the real production gate disabled before opening a context', async () => {
    const { runtime, open } = await setup();
    runtime.open.mockClear();
    const actual = jest.requireActual<
      typeof import('@ptah-extension/codex-runtime')
    >('@ptah-extension/codex-runtime');
    jest
      .mocked(resolveGatedCodexRuntime)
      .mockImplementationOnce((scope, consumer, platform) => {
        scope.register(actual.CODEX_RUNTIME_TOKENS.ParityGate, {
          useValue: new actual.CodexParityGate(),
        });
        scope.register(actual.CODEX_RUNTIME_TOKENS.Runtime, {
          useValue: runtime,
        });
        return actual.resolveGatedCodexRuntime(scope, consumer, platform);
      });
    await expect(open()).rejects.toThrow('parity gate');
    expect(runtime.open).not.toHaveBeenCalled();
  });

  it('refuses a pre-registered runtime whose sink cannot be proven', async () => {
    const { scope, runtime, open } = await setup();
    const actual = jest.requireActual<
      typeof import('@ptah-extension/codex-runtime')
    >('@ptah-extension/codex-runtime');
    scope.register(actual.CODEX_RUNTIME_TOKENS.Runtime, { useValue: runtime });
    jest
      .mocked(registerCodexRuntime)
      .mockImplementationOnce(actual.registerCodexRuntime);
    runtime.open.mockClear();
    await expect(open()).rejects.toThrow('already registered');
    expect(runtime.open).not.toHaveBeenCalled();
  });

  it('refuses an arbitrary context that was not opened through the gate', async () => {
    const { context, sink, logger, platform } = await setup();
    expect(() =>
      Reflect.construct(CodexGatewayAdapter, [
        undefined,
        context,
        sink,
        logger,
        platform,
      ]),
    ).toThrow('opened through the gate');
    expect(context.startTurn).not.toHaveBeenCalled();
  });

  it('rejects a missing sink before registration or opening', async () => {
    const { scope, ports, logger, platform, profile } = await setup();
    jest.mocked(registerCodexRuntime).mockClear();
    await expect(
      CodexGatewayAdapter.open(
        scope,
        ports,
        undefined as unknown as Parameters<typeof CodexGatewayAdapter.open>[2],
        logger,
        platform,
        profile,
      ),
    ).rejects.toThrow('sink is required');
    expect(registerCodexRuntime).not.toHaveBeenCalled();
  });

  it('subscribes before starting, preserves deltas and final-only text, and stops on the first terminal', async () => {
    const { adapter, context } = await setup([
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
    const { adapter } = await setup([
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
    const { adapter } = await setup([
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
      'message_complete',
    ]);
    expect(result[1]).toMatchObject({ toolCallId: 'tool', isError: true });
    expect(result[3]).toMatchObject({
      tokenUsage: { input: 3, output: 2 },
      cost: 0.1,
    });
    expect(text(result)).toBe('');
  });

  it('never invents missing token counters', async () => {
    const { adapter } = await setup([
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
    const { adapter } = await setup([
      { ...delta, contextId: 'other' },
      { ...delta, processGeneration: 0 },
      { ...delta, threadId: 'other' },
      { ...delta, turnId: 'other' },
      terminal,
    ]);
    expect(text(await collect(adapter.startTurn({ text: 'hi' })))).toBe('');
  });

  it('keeps files, images, compaction and approval events out of outbound text', async () => {
    const { adapter, sink } = await setup([
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
      const { adapter, context } = await setup(events);
      await expect(
        collect(adapter.startTurn({ text: 'hi' })),
      ).rejects.toThrow();
      expect(context.startTurn).toHaveBeenCalledTimes(1);
      expect(context.events.mock.calls[0][0].aborted).toBe(true);
    },
  );

  it('releases the subscription and closes abandoned work on consumer return', async () => {
    const { adapter, context } = await setup([
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
    const { adapter, context } = await setup();
    context.startTurn.mockRejectedValue(new Error('start failed'));
    await expect(collect(adapter.startTurn({ text: 'hi' }))).rejects.toThrow(
      'start failed',
    );
    expect(context.events.mock.calls[0][0].aborted).toBe(true);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('forwards steer, interrupt and close to the exact context', async () => {
    const { adapter, context } = await setup();
    await adapter.steer({ text: 'follow-up' });
    await expect(adapter.interrupt('turn')).resolves.toBe(true);
    await adapter.close();
    expect(context.steer).toHaveBeenCalledWith({ text: 'follow-up' });
    expect(context.interrupt).toHaveBeenCalledWith('turn');
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('does not start an already cancelled turn', async () => {
    const { adapter, context } = await setup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      collect(adapter.startTurn({ text: 'hi', signal: controller.signal })),
    ).rejects.toThrow('cancelled');
    expect(context.startTurn).not.toHaveBeenCalled();
  });

  it('cancels a running subscription and closes the context on input abort', async () => {
    const { adapter, context } = await setup();
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
    const { adapter, context } = await setup([
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
  it('surfaces a non-terminal error and continues until terminal without closing', async () => {
    const { adapter, context } = await setup([
      {
        ...base,
        type: 'error',
        error: {
          code: 'retry',
          message: 'secret vendor error',
          retryable: true,
        },
      },
      { ...base, type: 'textFinal', itemId: 'a', text: 'recovered' },
      terminal,
    ]);
    const result = await collect(adapter.startTurn({ text: 'hi' }));
    expect(text(result)).toBe('Codex reported a runtime error.recovered');
    expect(result.at(-1)?.eventType).toBe('message_complete');
    expect(context.close).not.toHaveBeenCalled();
  });

  it('emits divergent final text and reasoning in full', async () => {
    const { adapter } = await setup([
      { ...base, type: 'textDelta', itemId: 'a', delta: 'draft' },
      { ...base, type: 'textFinal', itemId: 'a', text: 'final' },
      { ...base, type: 'reasoning', itemId: 'r', phase: 'delta', text: 'old' },
      { ...base, type: 'reasoning', itemId: 'r', phase: 'final', text: 'new' },
      terminal,
    ]);
    const result = await collect(adapter.startTurn({ text: 'hi' }));
    expect(text(result)).toBe('draftfinal');
    expect(
      result
        .filter((e) => e.eventType === 'thinking_delta')
        .map((e) => e.delta),
    ).toEqual(['old', 'new']);
  });

  it('emits usage once at terminal, preferring the terminal snapshot', async () => {
    const { adapter } = await setup([
      { ...base, type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } },
      { ...base, type: 'usage', usage: { inputTokens: 3, outputTokens: 4 } },
      { ...terminal, usage: { inputTokens: 5, outputTokens: 6 } },
    ]);
    const result = await collect(adapter.startTurn({ text: 'hi' }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      eventType: 'message_complete',
      tokenUsage: { input: 5, output: 6 },
    });
  });

  it('ignores repeated and older sequences without accepting a stale terminal', async () => {
    const { adapter, context } = await setup();
    context.events.mockImplementation(() =>
      (async function* () {
        yield {
          ...base,
          sequence: 2,
          type: 'textDelta' as const,
          itemId: 'a',
          delta: 'once',
        };
        yield {
          ...base,
          sequence: 2,
          type: 'textDelta' as const,
          itemId: 'a',
          delta: 'duplicate',
        };
        yield { ...terminal, sequence: 1 };
        yield {
          ...base,
          sequence: 3,
          type: 'textFinal' as const,
          itemId: 'b',
          text: 'after',
        };
        yield { ...terminal, sequence: 4 };
      })(),
    );
    const result = await collect(adapter.startTurn({ text: 'hi' }));
    expect(text(result)).toBe('onceafter');
    expect(
      result.filter((e) => e.eventType === 'message_complete'),
    ).toHaveLength(1);
  });
});
