import 'reflect-metadata';
import { Logger } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { container } from 'tsyringe';
import {
  CODEX_RUNTIME_TOKENS,
  CodexParityGate,
  type ApprovalSink,
  type CodexContext,
  type CodexDevRouteOverride,
  type CodexExecutionProfile,
  type CodexReportedUsage,
  type CodexRuntimeEvent,
} from '@ptah-extension/codex-runtime';
import { SessionId, type FlatStreamEventUnion } from '@ptah-extension/shared';
import {
  CodexChatAdapter,
  type CodexChatAdapterPorts,
} from './codex-chat-adapter';
import { CodexChatAdapterError } from './codex-chat-adapter-error';
import { SessionApprovalRouter } from './session-approval-router';
import { SessionTurnStateRegistry } from '../helpers/session-turn-state.registry';

const id = SessionId.from('11111111-1111-4111-8111-111111111111');
const tabId = SessionId.from('22222222-2222-4222-8222-222222222222');
const identity = {
  contextId: 'context',
  threadId: id,
  processGeneration: 1,
  normalizedHome: '/home',
  workspaceId: '/workspace',
  providerId: 'openai-codex',
  profileFingerprint: 'fp',
};
const profile: CodexExecutionProfile = {
  ...identity,
  consumer: 'chat',
  cwd: '/workspace',
  model: 'gpt',
  permissionLevel: 'ask',
  approvalPolicy: 'on-request',
  sandboxPolicy: { mode: 'read-only', networkAccess: false, writableRoots: [] },
  instructionSources: [],
  mcpServers: [],
  attachments: [],
};
const terminal: CodexRuntimeEvent = {
  ...identity,
  turnId: 'turn',
  sequence: 2,
  type: 'terminal',
  status: 'completed',
};

function mockLogger(): Logger {
  return Object.assign(Object.create(Logger.prototype), createMockLogger());
}

function setup(override = true) {
  const logger = mockLogger();
  const turnState = new SessionTurnStateRegistry();
  const context: jest.Mocked<CodexContext> = {
    listModels: jest.fn(async () => [
      { id: 'catalog-gpt', model: 'gpt', displayName: 'GPT', isDefault: true },
    ]),
    identity,
    turnPermissionLevel: profile.permissionLevel,
    events: jest.fn<
      ReturnType<CodexContext['events']>,
      Parameters<CodexContext['events']>
    >(() =>
      (async function* () {
        yield terminal;
        yield terminal;
      })(),
    ),
    startTurn: jest.fn<
      ReturnType<CodexContext['startTurn']>,
      Parameters<CodexContext['startTurn']>
    >(async () => ({
      threadId: id,
      turnId: 'turn',
      revision: 1,
    })),
    steer: jest.fn<
      ReturnType<CodexContext['steer']>,
      Parameters<CodexContext['steer']>
    >(async () => ({ threadId: id, turnId: 'turn', revision: 2 })),
    interrupt: jest.fn<
      ReturnType<CodexContext['interrupt']>,
      Parameters<CodexContext['interrupt']>
    >(async () => true),
    updateNextTurn: jest.fn<
      ReturnType<CodexContext['updateNextTurn']>,
      Parameters<CodexContext['updateNextTurn']>
    >(async () => ({
      timing: 'nextTurn' as const,
      revision: 2,
    })),
    compact: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  };
  const callbacks = {
    result: jest.fn(),
    content: jest.fn(),
    live: jest.fn(),
    compaction: jest.fn(),
    error: jest.fn(),
  };
  const lifecycle = { opened: jest.fn(), closed: jest.fn() };
  const scope = container.createChildContainer();
  const open = jest.fn(async () => context);
  scope.register(CODEX_RUNTIME_TOKENS.ParityGate, {
    useValue: new CodexParityGate(),
  });
  scope.register(CODEX_RUNTIME_TOKENS.DevRouteOverride, {
    useFactory: (): CodexDevRouteOverride | null => (
      override ? { consumers: ['chat', 'gateway'], source: 'PTAH_CODEX_RUNTIME_DEV' } : null
    ),
  });
  scope.register(CODEX_RUNTIME_TOKENS.Logger, {
    useValue: { warn: jest.fn() },
  });
  scope.register(CODEX_RUNTIME_TOKENS.Runtime, { useValue: { open } });
  const dispose = jest.fn(async () => {
    await scope.dispose();
  });
  let sink: ApprovalSink | undefined;
  const cancelPrompt = jest.fn();
  const approvals = new SessionApprovalRouter(
    { handleResponse: jest.fn() },
    cancelPrompt,
  );
  const ports: CodexChatAdapterPorts = {
    checkOptions: jest.fn(),
    logger,
    platform: { platform: 'win32', arch: 'x64' },
    info: {
      id: 'ptah-cli',
      name: 'Codex',
      vendor: 'OpenAI',
      version: '1',
      description: 'Native chat',
      capabilities: {
        streaming: true,
        fileAttachments: true,
        contextManagement: true,
        sessionPersistence: true,
        multiTurn: true,
        codeGeneration: true,
        imageAnalysis: true,
        functionCalling: true,
      },
    },
    profile: jest.fn(async (_config, resumeId) => ({
      profile,
      ...(resumeId ? { resume: identity } : {}),
    })),
    createScope: (value) => {
      sink = value;
      return { container: scope, dispose };
    },
    metadata: { save: jest.fn(async () => undefined) },
    approvals,
    presentation: {
      present: jest.fn(),
      dismiss: jest.fn(),
      cancelPrompt,
    },
    replacement: { validateReplacement: jest.fn(), failed: jest.fn() },
    callbacks: jest.fn(() => callbacks),
    sessions: lifecycle,
    publish: jest.fn(async (_id, stream) => {
      for await (const event of stream) void event;
    }),
  };
  return {
    adapter: new CodexChatAdapter(ports, turnState),
    turnState,
    ports,
    context,
    open,
    dispose,
    callbacks,
    lifecycle,
    sink: () => {
      if (!sink) throw new Error('Expected an approval sink after opening');
      return sink;
    },
  };
}

async function collect(stream: AsyncIterable<FlatStreamEventUnion>) {
  const output: FlatStreamEventUnion[] = [];
  for await (const event of stream) output.push(event);
  return output;
}

const delta: CodexRuntimeEvent = {
  ...identity,
  turnId: 'turn',
  sequence: 1,
  type: 'textDelta',
  itemId: 'item',
  delta: 'hello',
};

describe('Codex chat turn lifecycle', () => {
  it('orders generating and completed settlement around the projected message', async () => {
    const h = setup();
    h.context.events.mockImplementation(() =>
      (async function* () {
        yield delta;
        yield terminal;
      })(),
    );
    const output = await collect(
      await h.adapter.startChatSession({ tabId, prompt: 'hello' }),
    );
    expect(output.map((event) => event.eventType)).toEqual([
      'turn_state',
      'message_start',
      'text_delta',
      'message_complete',
      'turn_state',
    ]);
    const states = output.filter((event) => event.eventType === 'turn_state');
    expect(states).toHaveLength(2);
    expect(states[0]).toMatchObject({
      phase: 'generating',
      terminalReason: null,
    });
    expect(states[1]).toMatchObject({
      phase: 'idle',
      terminalReason: 'completed',
    });
    expect(states[1].revision).toBeGreaterThan(states[0].revision);
    expect(h.turnState.get(id)?.revision).toBe(states[1].revision);
    await h.adapter.dispose();
  });

  it('feeds native usage and model into the session-stats payload', async () => {
    const h = setup();
    const stats = jest.fn();
    h.adapter.setResultStatsCallback(stats);
    const reported: CodexReportedUsage = {
      inputTokens: 120,
      cachedInputTokens: 40,
      outputTokens: 30,
      totalTokens: 150,
      lastRequestTotalTokens: 90,
      modelContextWindow: 272_000,
    };
    const usageEvent: CodexRuntimeEvent = {
      ...identity,
      turnId: 'turn',
      sequence: 2,
      type: 'usage',
      usage: reported,
    };
    const settled: CodexRuntimeEvent = {
      ...identity,
      turnId: 'turn',
      sequence: 3,
      type: 'terminal',
      status: 'completed',
      usage: reported,
    };
    h.context.events.mockImplementation(() =>
      (async function* () {
        yield delta;
        yield usageEvent;
        yield settled;
      })(),
    );
    await collect(await h.adapter.startChatSession({ tabId }));
    expect(stats).toHaveBeenCalledTimes(1);
    expect(stats).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: id,
        turnCost: null,
        tokens: { input: 80, output: 30, cacheRead: 40 },
        modelUsage: [
          expect.objectContaining({
            model: 'gpt',
            inputTokens: 80,
            outputTokens: 30,
            contextWindow: 272_000,
            contextCapacity: {
              tokens: 272_000,
              source: 'sdk-native',
              providerId: null,
              model: 'gpt',
            },
            costUSD: null,
            cacheReadInputTokens: 40,
            lastTurnContextTokens: 90,
          }),
        ],
      }),
    );
    await h.adapter.dispose();
  });

  it('reports an unknown native context window without inventing one', async () => {
    const h = setup();
    const stats = jest.fn();
    h.adapter.setResultStatsCallback(stats);
    const reported: CodexReportedUsage = {
      inputTokens: 120,
      cachedInputTokens: 40,
      outputTokens: 30,
      totalTokens: 150,
      lastRequestTotalTokens: 90,
    };
    const usageEvent: CodexRuntimeEvent = {
      ...identity,
      turnId: 'turn',
      sequence: 2,
      type: 'usage',
      usage: reported,
    };
    const settled: CodexRuntimeEvent = {
      ...identity,
      turnId: 'turn',
      sequence: 3,
      type: 'terminal',
      status: 'completed',
      usage: reported,
    };
    h.context.events.mockImplementation(() =>
      (async function* () {
        yield delta;
        yield usageEvent;
        yield settled;
      })(),
    );
    await collect(await h.adapter.startChatSession({ tabId }));
    expect(stats).toHaveBeenCalledTimes(1);
    expect(stats).toHaveBeenCalledWith(
      expect.objectContaining({
        modelUsage: [
          expect.objectContaining({
            model: 'gpt',
            contextWindow: 0,
            contextCapacity: {
              tokens: null,
              source: 'unknown',
              providerId: null,
              model: 'gpt',
            },
            costUSD: null,
            lastTurnContextTokens: 90,
          }),
        ],
      }),
    );
    await h.adapter.dispose();
  });

  it.each([
    ['interrupted', 'idle', 'aborted_streaming'],
    ['failed', 'failed', null],
  ] as const)(
    'settles a %s terminal without yielding message_complete',
    async (status, phase, terminalReason) => {
      const h = setup();
      h.context.events.mockImplementation(() =>
        (async function* () {
          yield delta;
          yield { ...terminal, status };
        })(),
      );
      const iterator = (await h.adapter.startChatSession({ tabId }))[Symbol.asyncIterator]();
      const output = [await iterator.next(), await iterator.next(), await iterator.next()];
      expect(output.map((item) => item.value?.eventType)).toEqual([
        'turn_state',
        'message_start',
        'text_delta',
      ]);
      await expect(iterator.next()).rejects.toMatchObject({
        code: status === 'failed' ? 'runtime-failed' : 'cancelled',
        webviewReported: status === 'failed' ? true : undefined,
      });
      expect(h.turnState.get(id)).toMatchObject({ phase, terminalReason });
      if (status === 'failed') {
        expect(h.turnState.get(id)).toMatchObject({ error: 'unknown' });
        expect(h.callbacks.error).toHaveBeenCalledWith('Codex reported a runtime error.');
        expect(h.ports.logger.error).toHaveBeenCalledWith(
          expect.stringContaining('runtime-failed: turn'),
          expect.any(Error),
        );
      } else {
        expect(h.callbacks.error).not.toHaveBeenCalled();
      }
      await h.adapter.dispose();
    },
  );

  it('rearms generating with a higher revision for the second turn', async () => {
    const h = setup();
    const first = await collect(await h.adapter.startChatSession({ tabId }));
    h.context.startTurn.mockResolvedValue({
      threadId: id,
      turnId: 'second',
      revision: 2,
    });
    h.context.events.mockImplementation(() =>
      (async function* () {
        yield { ...terminal, turnId: 'second' };
      })(),
    );
    const second: FlatStreamEventUnion[] = [];
    jest.mocked(h.ports.publish).mockImplementation(async (_id, stream) => {
      second.push(...(await collect(stream)));
    });
    await h.adapter.sendMessageToSession(id, 'again');
    const lastState = first
      .filter((event) => event.eventType === 'turn_state')
      .at(-1);
    const nextState = second.filter(
      (event) => event.eventType === 'turn_state',
    )[0];
    expect(nextState).toMatchObject({ phase: 'generating' });
    expect(nextState.revision).toBeGreaterThan(lastState?.revision ?? 0);
    expect(second.at(-1)).toMatchObject({
      phase: 'idle',
      terminalReason: 'completed',
    });
    await h.adapter.dispose();
  });

  it.each(['done', 'reject'] as const)(
    'closes and classifies a Stop without a terminal as cancelled when the iterator ends via %s',
    async (mode) => {
      const h = setup();
      let finishStop: (() => void) | undefined;
      const stopped = new Promise<void>((resolve) => { finishStop = resolve; });
      h.context.interrupt.mockImplementation(async () => {
        finishStop?.();
        return true;
      });
      h.context.events.mockImplementation(() =>
        (async function* () {
          yield delta;
          await stopped;
          if (mode === 'reject') throw new Error('Subscription ended');
        })(),
      );
      const stream = await h.adapter.startChatSession({ tabId });
      const iterator = stream[Symbol.asyncIterator]();
      expect((await iterator.next()).value).toMatchObject({
        eventType: 'turn_state',
        phase: 'generating',
      });
      await iterator.next();
      await iterator.next();
      const request = {
        ...identity,
        turnId: 'turn',
        requestId: 7,
        kind: 'command' as const,
        message: 'Run?',
        details: {},
      };
      const approval = h.sink().request(request, new AbortController().signal);
      const pending = iterator.next();
      const rejected = expect(pending).rejects.toBeInstanceOf(
        CodexChatAdapterError,
      );
      await h.adapter.interruptSession(id);
      await rejected;
      await expect(pending).rejects.toMatchObject({
        code: 'cancelled',
        message: expect.stringMatching(/cancel/i),
      });
      await expect(approval).resolves.toBe('cancel');
      expect(h.ports.presentation.cancelPrompt).toHaveBeenCalledWith({
        sessionId: id,
        requestId: '7',
        reason: 'turn-ended',
      });
      expect(h.ports.presentation.dismiss).toHaveBeenCalledWith(id, request);
      expect(h.context.close).toHaveBeenCalledTimes(1);
      expect(h.adapter.isSessionActive(id)).toBe(false);
      // The broadcaster owns forceIdle for a thrown user abort; no settle chunk is emitted here.
      await h.adapter.dispose();
    },
  );

  it('keeps an unexpected end of the runtime stream classified as a failure', async () => {
    const h = setup();
    h.context.events.mockImplementation(() =>
      (async function* () {
        yield delta;
      })(),
    );
    const stream = await h.adapter.startChatSession({ tabId });
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.next();
    await iterator.next();
    const request = {
      ...identity,
      turnId: 'turn',
      requestId: 7,
      kind: 'command' as const,
      message: 'Run?',
      details: {},
    };
    const approval = h.sink().request(request, new AbortController().signal);
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'runtime-failed',
    });
    await expect(approval).resolves.toBe('cancel');
    expect(h.ports.presentation.cancelPrompt).toHaveBeenCalledWith({
      sessionId: id,
      requestId: '7',
      reason: 'turn-ended',
    });
    await h.adapter.dispose();
  });

  it.each(['completed', 'interrupted', 'failed', 'missing'] as const)(
    'settles a detached consumer when its terminal is %s',
    async (status) => {
      const h = setup();
      let finish: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        finish = resolve;
      });
      h.context.events.mockImplementation(() =>
        (async function* () {
          yield delta;
          await gate;
          if (status !== 'missing') yield { ...terminal, status };
        })(),
      );
      const stream = await h.adapter.startChatSession({ tabId });
      const iterator = stream[Symbol.asyncIterator]();
      await iterator.next();
      expect(h.turnState.get(id)?.phase).toBe('generating');
      await iterator.return?.();
      finish?.();
      // Drain runs independently after consumer return; let its microtasks finish.
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(h.turnState.get(id)).toMatchObject({
        phase: status === 'failed' ? 'failed' : 'idle',
        terminalReason:
          status === 'completed'
            ? 'completed'
            : status === 'failed'
              ? null
              : 'aborted_streaming',
      });
      if (status === 'missing')
        expect(h.context.close).toHaveBeenCalledTimes(1);
      if (status === 'interrupted') {
        expect(h.context.close).not.toHaveBeenCalled();
        expect(h.ports.logger.error).not.toHaveBeenCalledWith(
          expect.stringContaining('detached turn cleanup'),
          expect.any(Error),
        );
      }
      await h.adapter.dispose();
    },
  );

  it.each(['completed', 'interrupted', 'failed'] as const)(
    'ends pending approvals on a %s terminal',
    async (status) => {
      const h = setup();
      h.context.events.mockImplementation(() =>
        (async function* () {
          yield delta;
          yield { ...terminal, status };
        })(),
      );
      const stream = await h.adapter.startChatSession({ tabId });
      const iterator = stream[Symbol.asyncIterator]();
      await iterator.next();
      const request = {
        ...identity,
        turnId: 'turn',
        requestId: 7,
        kind: 'command' as const,
        message: 'Run?',
        details: {},
      };
      const approval = h.sink().request(request, new AbortController().signal);
      const consume = async () => {
        while (!(await iterator.next()).done) {
          /* Consume through settlement. */
        }
      };
      if (status === 'completed') {
        await consume();
      } else {
        await expect(consume()).rejects.toMatchObject({
          code: status === 'failed' ? 'runtime-failed' : 'cancelled',
        });
      }
      await expect(approval).resolves.toBe('cancel');
      expect(h.ports.presentation.cancelPrompt).toHaveBeenCalledWith({
        sessionId: id,
        requestId: '7',
        reason: 'turn-ended',
      });
      expect(h.ports.presentation.dismiss).toHaveBeenCalledWith(id, request);
      await h.adapter.dispose();
    },
  );

  it('settles if the consumer returns immediately after message_complete', async () => {
    const h = setup();
    const stream = await h.adapter.startChatSession({ tabId });
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.next();
    expect((await iterator.next()).value).toMatchObject({
      eventType: 'message_complete',
    });
    await iterator.return?.();
    expect(h.turnState.get(id)).toMatchObject({
      phase: 'idle',
      terminalReason: 'completed',
    });
    await h.adapter.dispose();
  });
});
