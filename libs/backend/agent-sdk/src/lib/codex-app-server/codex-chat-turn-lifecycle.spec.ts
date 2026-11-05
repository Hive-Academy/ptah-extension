import 'reflect-metadata';
import { Logger } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { container } from 'tsyringe';
import {
  CODEX_RUNTIME_TOKENS,
  CodexUnsupportedMethodError,
  CodexSelectionSnapshot,
  CodexEventTranslator,
  type ApprovalSink,
  type CodexContext,
  type CodexExecutionProfile,
  type CodexReportedUsage,
  type CodexRuntimeEvent,
  type CodexUsageEvidence,
} from '@ptah-extension/codex-runtime';
import {
  SessionId,
  calculateExactMessageCost,
  type FlatStreamEventUnion,
} from '@ptah-extension/shared';
import {
  CodexChatAdapter,
  type CodexChatAdapterPorts,
} from './codex-chat-adapter';
import { SessionApprovalRouter } from './session-approval-router';
import { SessionTurnStateRegistry } from '../helpers/session-turn-state.registry';
import {
  CodexSessionUsageOwner,
  type CodexUsageCheckpoint,
} from './codex-session-usage-owner';
import { codexUsageCheckpointSchema } from './codex-session-usage-owner';
import { recordTurnPriceOnce } from './codex-chat-turn-stream';

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

function setup(
  consumer: 'chat' | 'gateway' = 'chat',
  billingMode: 'api-key' | 'subscription' | 'unknown' = 'unknown',
  model = 'gpt',
  checkpoint?: CodexUsageCheckpoint,
) {
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
  const persistUsage = jest.fn<
    Promise<void>,
    [SessionId, CodexUsageCheckpoint]
  >(async () => undefined);
  const lifecycle = { opened: jest.fn(), closed: jest.fn() };
  const scope = container.createChildContainer();
  const open = jest.fn(async () => context);
  const bundledContext: jest.Mocked<CodexContext> = {
    ...context,
    startTurn: jest.fn<
      ReturnType<CodexContext['startTurn']>,
      Parameters<CodexContext['startTurn']>
    >(async () => ({
      threadId: id,
      turnId: 'turn',
      revision: 1,
    })),
    close: jest.fn(async () => undefined),
  };
  const retryFirstTurnOnBundle = jest.fn(async () => {
    await context.close();
    return bundledContext;
  });
  const markUnsupported = jest.fn(
    (_context: CodexContext, _method: string) => false,
  );
  scope.register(CODEX_RUNTIME_TOKENS.Logger, {
    useValue: { warn: jest.fn() },
  });
  scope.register(CODEX_RUNTIME_TOKENS.Runtime, {
    useValue: { open, retryFirstTurnOnBundle, markUnsupported },
  });
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
    driver: { admit: jest.fn(async () => ({ release: jest.fn() })) },
    checkOptions: jest.fn(),
    logger,
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
      profile: { ...profile, consumer, model },
      billingMode,
      ...(resumeId ? { resume: identity } : {}),
    })),
    createScope: (value) => {
      sink = value;
      return { container: scope, dispose };
    },
    metadata: {
      save: jest.fn(async () => undefined),
      readUsage: jest.fn(async () => ({ checkpoint, messageCount: 0 })),
      persistUsage,
    },
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
    bundledContext,
    retryFirstTurnOnBundle,
    markUnsupported,
    open,
    dispose,
    callbacks,
    persistUsage,
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
  it('prices native model-less turns through translator, owner and stream across an auth change', async () => {
    const translator = new CodexEventTranslator('context', 1);
    const nativeCounts = (inputTokens: number, outputTokens: number) => ({
      inputTokens,
      cachedInputTokens: 0,
      outputTokens,
      reasoningOutputTokens: 0,
      totalTokens: inputTokens + outputTokens,
    });
    const nativeEvents = (
      turnId: string,
      inputTokens: number,
      outputTokens: number,
    ) => [
      ...translator.translate({
        method: 'thread/tokenUsage/updated',
        params: {
          threadId: id,
          turnId,
          tokenUsage: {
            last: nativeCounts(100, 20),
            total: nativeCounts(inputTokens, outputTokens),
          },
        },
      }),
      ...translator.translate({
        method: 'turn/completed',
        params: {
          threadId: id,
          turn: { id: turnId, items: [], status: 'completed' },
        },
      }),
    ];
    translator.setThreadModel(id, 'gpt-4o');
    translator.setTurnModel(id, 'turn', 'gpt-4o');
    const first = setup('chat', 'api-key', 'gpt-4o');
    first.context.events.mockImplementation(() =>
      (async function* () {
        yield* nativeEvents('turn', 100, 20);
      })(),
    );
    await collect(await first.adapter.startChatSession({ tabId }));
    const checkpoint = codexUsageCheckpointSchema.parse(
      first.persistUsage.mock.lastCall?.[1],
    );
    expect(checkpoint.pricing?.basis).toBe('estimated');
    await first.adapter.dispose();

    translator.setThreadModel(id, 'gpt-4o-mini');
    translator.setTurnModel(id, 'turn-2', 'gpt-4o-mini');
    const second = setup('chat', 'subscription', 'gpt-4o-mini', checkpoint);
    second.context.startTurn.mockResolvedValue({
      threadId: id,
      turnId: 'turn-2',
      revision: 2,
    });
    const stats = jest.fn();
    second.adapter.setResultStatsCallback(stats);
    second.context.events.mockImplementation(() =>
      (async function* () {
        yield* nativeEvents('turn-2', 200, 40);
      })(),
    );
    await collect(await second.adapter.resumeSession(id, { tabId }));
    const result = stats.mock.lastCall?.[0];
    expect(result).toMatchObject({
      costBasis: 'covered-by-subscription',
      sessionStats: {
        totalCost: null,
        costBasis: 'unknown',
        pricingCoverage: 'partial',
      },
    });
    expect(result?.turnCost).toBeGreaterThan(0);
    const saved = codexUsageCheckpointSchema.parse(
      second.persistUsage.mock.lastCall?.[1],
    );
    expect(saved.pricing?.basis).toBe('unknown');
    expect(saved.pricing?.segments).toMatchObject([
      { basis: 'estimated', turns: 1 },
      { basis: 'covered-by-subscription', turns: 1 },
    ]);
    expect(saved.pricing?.provenance).toEqual([
      expect.objectContaining({ modelIdUsed: 'gpt-4o' }),
      expect.objectContaining({ modelIdUsed: 'gpt-4o-mini' }),
    ]);
    await second.adapter.dispose();
  });

  it.each(['in-turn', 'detached'] as const)(
    'records the %s terminal price once through the real stream',
    async (path) => {
      const h = setup('chat', 'api-key', 'gpt-4o');
      const stats = jest.fn();
      h.adapter.setResultStatsCallback(stats);
      const recordPrice = jest.spyOn(
        CodexSessionUsageOwner.prototype,
        'recordTurnPrice',
      );
      let finish: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        finish = resolve;
      });
      h.context.events.mockImplementation(() =>
        (async function* () {
          if (path === 'detached') {
            yield delta;
            await gate;
          }
          yield {
            ...terminal,
            evidence,
            usage: { inputTokens: 100, outputTokens: 20 },
          };
        })(),
      );
      try {
        const stream = await h.adapter.startChatSession({ tabId });
        if (path === 'detached') {
          const iterator = stream[Symbol.asyncIterator]();
          await iterator.next();
          await iterator.return?.();
          finish?.();
          await new Promise<void>((resolve) => setImmediate(resolve));
        } else {
          await collect(stream);
        }
        const price = calculateExactMessageCost(
          'gpt-4o',
          {
            input: 100,
            output: 20,
            cacheHit: 0,
            cacheCreation: 0,
          },
          {
            billingMode: 'api-key',
            cacheSemantics: 'disjoint',
            usageObserved: true,
          },
        );
        expect(price.totalCost).not.toBeNull();
        expect(recordPrice).toHaveBeenCalledTimes(1);
        expect(stats).toHaveBeenCalledTimes(1);
        expect(stats).toHaveBeenCalledWith(
          expect.objectContaining({
            turnCost: price.totalCost,
            sessionStats: expect.objectContaining({
              totalCost: price.totalCost,
            }),
          }),
        );
      } finally {
        finish?.();
        recordPrice.mockRestore();
        await h.adapter.dispose();
      }
    },
  );

  it('retries a failed price write and never adds the same turn twice', () => {
    const owner = new CodexSessionUsageOwner(id, id);
    const price = calculateExactMessageCost(
      'gpt-4o',
      {
        input: 100,
        output: 20,
        cacheHit: 0,
        cacheCreation: 0,
      },
      {
        billingMode: 'api-key',
        cacheSemantics: 'disjoint',
        usageObserved: true,
      },
    );
    if (price.totalCost === null) throw new Error('Expected a catalog price');
    const priced = new Set<string>();
    const record = jest.spyOn(owner, 'recordTurnPrice');
    expect(() =>
      recordTurnPriceOnce('turn', priced, () => {
        throw new Error('temporary price write failure');
      }),
    ).toThrow('temporary price write failure');
    expect(priced.has('turn')).toBe(false);
    expect(
      recordTurnPriceOnce('turn', priced, () => owner.recordTurnPrice(price)),
    ).toBe(true);
    expect(
      recordTurnPriceOnce('turn', priced, () => owner.recordTurnPrice(price)),
    ).toBe(false);
    expect(record).toHaveBeenCalledTimes(1);
    expect(owner.serialize().pricing?.knownCost).toBe(price.totalCost);
  });
  const counters = {
    uncachedInputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 120,
  };
  const evidence: CodexUsageEvidence = {
    threadId: id,
    turnId: 'turn',
    modelId: 'gpt-4o',
    total: counters,
    last: counters,
    timestamp: 1,
    terminalState: 'completed',
    accepted: true,
    epoch: 0,
    resetOrStale: false,
    cacheSemanticsAmbiguous: false,
    lastExceedsTotal: false,
    diagnostics: [],
  };

  it.each([
    ['api-key', 'estimated'],
    ['subscription', 'covered-by-subscription'],
  ] as const)('prices %s native usage as %s', async (mode, basis) => {
    const h = setup('chat', mode, 'gpt-4o');
    const stats = jest.fn();
    h.adapter.setResultStatsCallback(stats);
    h.context.events.mockImplementation(() =>
      (async function* () {
        yield {
          ...terminal,
          evidence,
          usage: { inputTokens: 100, outputTokens: 20 },
        };
      })(),
    );
    await collect(await h.adapter.startChatSession({ tabId }));
    expect(stats).toHaveBeenCalledWith(
      expect.objectContaining({
        costBasis: basis,
        turnCost: expect.any(Number),
        priceProvenance: [expect.objectContaining({ modelIdUsed: 'gpt-4o' })],
        sessionStats: expect.objectContaining({
          totalCost: expect.any(Number),
          costBasis: basis,
          pricingCoverage: 'full',
          tokens: {
            input: 100,
            output: 20,
            cacheRead: 0,
            cacheCreation: 0,
          },
          priceProvenance: [expect.objectContaining({ modelIdUsed: 'gpt-4o' })],
        }),
      }),
    );
    await h.adapter.dispose();
  });

  it('retains unknown prices and emits lifetime stats on a failed terminal', async () => {
    const h = setup('chat', 'api-key', 'unpriced-native-model');
    const stats = jest.fn();
    h.adapter.setResultStatsCallback(stats);
    h.context.events.mockImplementation(() =>
      (async function* () {
        yield {
          ...terminal,
          status: 'failed' as const,
          evidence: {
            ...evidence,
            modelId: 'unpriced-native-model',
            terminalState: 'failed' as const,
          },
        };
      })(),
    );
    await expect(
      collect(await h.adapter.startChatSession({ tabId })),
    ).rejects.toMatchObject({
      code: 'runtime-failed',
    });
    expect(stats).toHaveBeenCalledWith(
      expect.objectContaining({
        turnCost: null,
        costBasis: 'unknown',
        pricingCoverage: 'none',
        sessionStats: expect.objectContaining({
          totalCost: null,
          costBasis: 'unknown',
          pricingCoverage: 'none',
          tokens: expect.objectContaining({ input: 100 }),
        }),
      }),
    );
    await h.adapter.dispose();
  });

  it('keeps a missing rate generic when an earlier turn had no usage evidence', async () => {
    const h = setup('chat', 'api-key', 'unpriced-native-model');
    const stats = jest.fn();
    h.adapter.setResultStatsCallback(stats);
    h.context.startTurn
      .mockResolvedValueOnce({ threadId: id, turnId: 'turn', revision: 1 })
      .mockResolvedValueOnce({ threadId: id, turnId: 'turn-2', revision: 2 });
    h.context.events
      .mockImplementationOnce(() =>
        (async function* () {
          yield terminal;
        })(),
      )
      .mockImplementationOnce(() =>
        (async function* () {
          yield {
            ...terminal,
            turnId: 'turn-2',
            evidence: {
              ...evidence,
              turnId: 'turn-2',
              modelId: 'unpriced-native-model',
            },
            usage: { inputTokens: 100, outputTokens: 20 },
          };
        })(),
      );

    await collect(await h.adapter.startChatSession({ tabId }));
    expect(stats.mock.lastCall?.[0].sessionStats.coverage).toBe('partial');
    await h.adapter.sendMessageToSession(id, 'follow-up');
    expect(stats.mock.lastCall?.[0]).toMatchObject({
      turnCost: null,
      sessionStats: expect.objectContaining({
        totalCost: null,
        coverage: 'partial',
        pricingCoverage: 'none',
      }),
    });
    expect(stats.mock.lastCall?.[0].sessionStats).not.toHaveProperty(
      'costUnavailableReason',
      'rate-missing',
    );
    await h.adapter.dispose();
  });

  it('labels a missing rate when every turn has usage evidence', async () => {
    const h = setup('chat', 'api-key', 'unpriced-native-model');
    const stats = jest.fn();
    h.adapter.setResultStatsCallback(stats);
    h.context.events.mockImplementation(() =>
      (async function* () {
        yield {
          ...terminal,
          evidence: { ...evidence, modelId: 'unpriced-native-model' },
          usage: { inputTokens: 100, outputTokens: 20 },
        };
      })(),
    );

    await collect(await h.adapter.startChatSession({ tabId }));
    expect(stats.mock.lastCall?.[0].sessionStats).toMatchObject({
      coverage: 'complete',
      totalCost: null,
      costUnavailableReason: 'rate-missing',
    });
    await h.adapter.dispose();
  });

  it('keeps a known rate unavailable when auth mode is unknown', async () => {
    const h = setup('chat', 'unknown', 'gpt-4o');
    const stats = jest.fn();
    h.adapter.setResultStatsCallback(stats);
    h.context.events.mockImplementation(() =>
      (async function* () {
        yield { ...terminal, evidence };
      })(),
    );
    await collect(await h.adapter.startChatSession({ tabId }));
    expect(stats).toHaveBeenCalledWith(
      expect.objectContaining({
        turnCost: null,
        costBasis: 'unknown',
        pricingCoverage: 'none',
        sessionStats: expect.objectContaining({ totalCost: null }),
      }),
    );
    await h.adapter.dispose();
  });

  it('continues restored lifetime usage on resume', async () => {
    const owner = new CodexSessionUsageOwner(id, id);
    owner.accept({
      ...evidence,
      turnId: 'prior',
      total: {
        ...counters,
        uncachedInputTokens: 50,
        totalTokens: 70,
      },
    });
    const h = setup('chat', 'api-key', 'gpt-4o', owner.serialize());
    const stats = jest.fn();
    h.adapter.setResultStatsCallback(stats);
    h.context.events.mockImplementation(() =>
      (async function* () {
        yield { ...terminal, evidence };
      })(),
    );
    await collect(await h.adapter.resumeSession(id, { tabId }));
    expect(stats).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionStats: expect.objectContaining({
          tokens: expect.objectContaining({ input: 100 }),
        }),
      }),
    );
    await h.adapter.dispose();
  });

  it('retains exact lifetime cost across a priced model switch and resume', async () => {
    const owner = new CodexSessionUsageOwner(id, id);
    const priorCounters = {
      ...counters,
      uncachedInputTokens: 40,
      outputTokens: 10,
      totalTokens: 50,
    };
    owner.accept({
      ...evidence,
      turnId: 'prior',
      modelId: 'gpt-4o-mini',
      total: priorCounters,
      last: priorCounters,
    });
    const priorPrice = calculateExactMessageCost(
      'gpt-4o-mini',
      {
        input: 40,
        output: 10,
      },
      { billingMode: 'api-key', usageObserved: true },
    );
    if (priorPrice.totalCost === null)
      throw new Error('Expected a catalog rate');
    owner.recordTurnPrice(priorPrice);
    const h = setup('chat', 'api-key', 'gpt-4o', owner.serialize());
    const stats = jest.fn();
    h.adapter.setResultStatsCallback(stats);
    h.context.events.mockImplementation(() =>
      (async function* () {
        yield { ...terminal, evidence };
      })(),
    );
    await collect(await h.adapter.resumeSession(id, { tabId }));
    const result = stats.mock.calls[0]?.[0];
    if (!result) throw new Error('Expected native result stats');
    expect(result.turnCost).toBeGreaterThan(0);
    expect(result.sessionStats.totalCost).toBeCloseTo(
      priorPrice.totalCost + result.turnCost,
      10,
    );
    expect(result.sessionStats.pricingCoverage).toBe('full');
    expect(result.sessionStats.priceProvenance).toEqual([
      expect.objectContaining({ modelIdUsed: 'gpt-4o-mini' }),
      expect.objectContaining({ modelIdUsed: 'gpt-4o' }),
    ]);
    await h.adapter.dispose();
  });

  it('does not price usage from a configured alias when evidence omits the model', async () => {
    const h = setup('chat', 'api-key', 'gpt-4o');
    const stats = jest.fn();
    h.adapter.setResultStatsCallback(stats);
    h.context.events.mockImplementation(() =>
      (async function* () {
        yield { ...terminal, evidence: { ...evidence, modelId: undefined } };
      })(),
    );
    await collect(await h.adapter.startChatSession({ tabId }));
    expect(stats).toHaveBeenCalledWith(
      expect.objectContaining({
        turnCost: null,
        costBasis: 'unknown',
        sessionStats: expect.objectContaining({ totalCost: null }),
      }),
    );
    await h.adapter.dispose();
  });

  it('reports a checkpoint read failure and continues with partial coverage', async () => {
    const h = setup('chat', 'api-key', 'gpt-4o');
    h.ports.metadata.readUsage = jest
      .fn()
      .mockRejectedValue(new Error('disk read failed'));
    const stats = jest.fn();
    h.adapter.setResultStatsCallback(stats);
    h.context.events.mockImplementation(() =>
      (async function* () {
        yield { ...terminal, evidence };
      })(),
    );
    await collect(await h.adapter.resumeSession(id, { tabId }));
    expect(h.ports.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('checkpoint read failed'),
      expect.any(Error),
    );
    expect(stats).toHaveBeenCalledWith(
      expect.objectContaining({
        turnCost: expect.any(Number),
        sessionStats: expect.objectContaining({
          coverage: 'partial',
          totalCost: null,
        }),
      }),
    );
    await h.adapter.dispose();
  });

  it('logs a checkpoint write failure without losing the terminal result', async () => {
    const h = setup('chat', 'api-key', 'gpt-4o');
    const stats = jest.fn();
    h.adapter.setResultStatsCallback(stats);
    h.persistUsage.mockRejectedValueOnce(new Error('storage unavailable'));
    h.context.events.mockImplementation(() =>
      (async function* () {
        yield { ...terminal, evidence };
      })(),
    );
    await collect(await h.adapter.startChatSession({ tabId }));
    expect(stats).toHaveBeenCalledTimes(1);
    expect(h.ports.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('checkpoint persistence failed'),
      expect.any(Error),
    );
    await h.adapter.dispose();
  });

  it('reports an unavailable host usage store on the terminal path', async () => {
    const h = setup('chat', 'api-key', 'gpt-4o');
    h.ports.metadata.persistUsage = undefined;
    h.context.events.mockImplementation(() =>
      (async function* () {
        yield { ...terminal, evidence };
      })(),
    );
    await collect(await h.adapter.startChatSession({ tabId }));
    expect(h.ports.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('checkpoint persistence unavailable'),
      expect.objectContaining({ sessionId: id }),
    );
    await h.adapter.dispose();
  });

  it('forwards a linked child after the root terminal before closing its card', async () => {
    const h = setup();
    h.context.events.mockImplementation(() =>
      (async function* () {
        yield {
          ...identity,
          turnId: 'turn',
          sequence: 1,
          type: 'toolStarted',
          toolId: 'spawn',
          toolName: 'spawnAgent',
          agentThreadIds: ['child'],
          input: { subagent_type: 'codex', description: 'Inspect' },
        } satisfies CodexRuntimeEvent;
        yield {
          ...identity,
          turnId: 'turn',
          sequence: 2,
          type: 'toolCompleted',
          toolId: 'spawn',
          status: 'completed',
          agentThreadIds: ['child'],
          output: null,
        } satisfies CodexRuntimeEvent;
        yield { ...terminal, sequence: 3 };
        yield {
          ...identity,
          threadId: 'child',
          turnId: 'child-turn',
          sequence: 4,
          type: 'textFinal',
          itemId: 'answer',
          text: 'Child answer',
          parentToolUseId: 'spawn',
        } satisfies CodexRuntimeEvent;
        yield {
          ...identity,
          threadId: 'child',
          turnId: 'child-turn',
          sequence: 5,
          type: 'terminal',
          status: 'completed',
          parentToolUseId: 'spawn',
        } satisfies CodexRuntimeEvent;
      })(),
    );
    const output = await collect(
      await h.adapter.startChatSession({ tabId, prompt: 'inspect' }),
    );
    const childComplete = output.findIndex(
      (event) =>
        event.eventType === 'message_complete' &&
        event.parentToolUseId === 'spawn',
    );
    const result = output.findIndex(
      (event) =>
        event.eventType === 'tool_result' && event.toolCallId === 'spawn',
    );
    expect(childComplete).toBeGreaterThan(-1);
    expect(result).toBeGreaterThan(childComplete);
    expect(output[result]).toMatchObject({
      output: 'Child answer',
      isError: false,
    });
    expect(h.callbacks.result).toHaveBeenCalledTimes(1);
    await h.adapter.dispose();
  });
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

  it.each([
    ['completed', 'idle'],
    ['interrupted', 'idle'],
    ['failed', 'failed'],
  ] as const)('consumes a first-turn prompt on %s', async (status, phase) => {
    const h = setup();
    h.context.events.mockImplementation(() =>
      (async function* () {
        yield { ...terminal, status };
      })(),
    );
    const start = { tabId, prompt: 'hello', clientMessageId: 'prompt-1' };
    const output: FlatStreamEventUnion[] = [];
    let failure: unknown;
    try {
      for await (const event of await h.adapter.startChatSession(start))
        output.push(event);
    } catch (error) {
      failure = error;
    }
    expect(
      output.filter(
        (event) =>
          event?.eventType === 'message_start' && event.role === 'user',
      ),
    ).toEqual([expect.objectContaining({ clientMessageId: 'prompt-1' })]);
    expect(output.at(-1)).toMatchObject({
      eventType: 'turn_state',
      phase,
      consumedClientMessageId: 'prompt-1',
    });
    if (status === 'completed') expect(failure).toBeUndefined();
    else
      expect(failure).toMatchObject({
        code: status === 'failed' ? 'runtime-failed' : 'cancelled',
      });
    const notices = output.filter(
      (event) =>
        event.eventType === 'text_delta' &&
        event.delta === 'Codex reported a runtime error.',
    );
    expect(notices).toHaveLength(status === 'failed' ? 1 : 0);
    if (status === 'failed')
      expect(output.indexOf(notices[0])).toBeLessThan(output.length - 1);
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
    'settles a %s terminal with a consumable terminal state',
    async (status, phase, terminalReason) => {
      const h = setup();
      const stats = jest.fn();
      h.adapter.setResultStatsCallback(stats);
      h.context.events.mockImplementation(() =>
        (async function* () {
          yield delta;
          yield { ...terminal, status };
        })(),
      );
      const output: FlatStreamEventUnion[] = [];
      let failure: unknown;
      try {
        for await (const event of await h.adapter.startChatSession({ tabId }))
          output.push(event);
      } catch (error) {
        failure = error;
      }
      expect(output.map((event) => event.eventType)).toEqual(
        status === 'failed'
          ? [
              'turn_state',
              'message_start',
              'text_delta',
              'message_start',
              'text_delta',
              'turn_state',
            ]
          : ['turn_state', 'message_start', 'text_delta', 'turn_state'],
      );
      expect(output.at(-1)).toMatchObject({
        phase,
        terminalReason,
        sessionId: id,
      });
      expect(failure).toMatchObject({
        code: status === 'failed' ? 'runtime-failed' : 'cancelled',
        webviewReported: status === 'failed' ? true : undefined,
      });
      expect(stats).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionStats: expect.objectContaining({ coverage: 'partial' }),
        }),
      );
      expect(
        output.filter(
          (event) =>
            event.eventType === 'text_delta' &&
            event.delta === 'Codex reported a runtime error.',
        ),
      ).toHaveLength(status === 'failed' ? 1 : 0);
      expect(h.turnState.get(id)).toMatchObject({ phase, terminalReason });
      if (status === 'failed') {
        expect(h.turnState.get(id)).toMatchObject({ error: 'unknown' });
        expect(h.callbacks.error).toHaveBeenCalledWith(
          'Codex reported a runtime error.',
          '/workspace',
        );
        expect(h.ports.logger.error).toHaveBeenCalledWith(
          expect.stringContaining('runtime-failed: turn'),
          expect.any(Error),
        );
      } else {
        expect(h.callbacks.error).not.toHaveBeenCalled();
      }
      if (status === 'failed') expect(h.adapter.owns(id)).toBe(false);
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
    let finishPublish: () => void = () => undefined;
    const published = new Promise<void>((resolve) => {
      finishPublish = resolve;
    });
    jest.mocked(h.ports.publish).mockImplementation(async (_id, stream) => {
      try {
        second.push(...(await collect(stream)));
      } finally {
        finishPublish();
      }
    });
    await h.adapter.sendMessageToSession(id, 'again');
    await published;
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
      const stopped = new Promise<void>((resolve) => {
        finishStop = resolve;
      });
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
      await h.adapter.interruptSession(id);
      await expect(pending).resolves.toMatchObject({
        value: { eventType: 'turn_state', phase: 'idle' },
      });
      await expect(iterator.next()).rejects.toMatchObject({
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
    expect((await iterator.next()).value).toMatchObject({
      eventType: 'message_start',
      role: 'assistant',
    });
    expect((await iterator.next()).value).toMatchObject({
      eventType: 'text_delta',
      delta: 'Codex reported a runtime error.',
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { eventType: 'turn_state', phase: 'failed', sessionId: id },
    });
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

  it.each(['before receipt', 'after receipt'] as const)(
    'settles a zero-content process death %s with one failure presentation',
    async (point) => {
      const h = setup();
      if (point === 'before receipt')
        h.context.startTurn.mockRejectedValueOnce(new Error('process died'));
      else
        h.context.events.mockImplementation(() => ({
          [Symbol.asyncIterator]: () => ({
            next: async () => {
              throw new Error('process died');
            },
          }),
        }));
      const start = { tabId, prompt: 'hello', clientMessageId: 'prompt-1' };
      const stream = await h.adapter.startChatSession(start);
      const iterator = stream[Symbol.asyncIterator]();
      if (point === 'after receipt')
        expect((await iterator.next()).value).toMatchObject({
          eventType: 'message_start',
          role: 'user',
          clientMessageId: 'prompt-1',
        });
      expect((await iterator.next()).value).toMatchObject({
        eventType: 'message_start',
        role: 'assistant',
        source: 'complete',
      });
      expect((await iterator.next()).value).toMatchObject({
        eventType: 'text_delta',
        delta: 'Codex reported a runtime error.',
        source: 'complete',
      });
      expect((await iterator.next()).value).toMatchObject({
        eventType: 'turn_state',
        phase: 'failed',
        sessionId: id,
        consumedClientMessageId: 'prompt-1',
      });
      await expect(iterator.next()).rejects.toMatchObject({
        code: 'runtime-failed',
        webviewReported: true,
      });
      expect(h.callbacks.error).toHaveBeenCalledTimes(1);
      expect(h.callbacks.error).toHaveBeenCalledWith(
        'Codex reported a runtime error.',
        '/workspace',
      );
      expect(h.context.close).toHaveBeenCalledTimes(1);
      expect(h.adapter.isSessionActive(id)).toBe(false);
      await expect(h.adapter.interruptSession(id)).resolves.toBeUndefined();
      await h.adapter.dispose();
    },
  );

  it('reports an installed first-turn unsupported method without changing the bound chat session id', async () => {
    const h = setup();
    const snapshot = new CodexSelectionSnapshot({
      installedCandidates: async () => ['/installed/codex'],
      bundledCandidate: async () => '/bundle/codex',
      canonicalNativePath: async (path) => path,
      readVersion: async (path) =>
        path === '/installed/codex' ? 'codex-cli 0.166.0' : 'codex-cli 0.165.0',
    });
    const first = await snapshot.selectForOpen();
    h.markUnsupported.mockImplementation((_context, method) => {
      snapshot.markUnsupported(first.selected, method);
      return true;
    });
    h.context.startTurn.mockRejectedValueOnce(
      new CodexUnsupportedMethodError('turn/start', '0.166.0', 'installed'),
    );
    const output: FlatStreamEventUnion[] = [];
    await expect(
      (async () => {
        for await (const event of await h.adapter.startChatSession({ tabId }))
          output.push(event);
      })(),
    ).rejects.toMatchObject({ code: 'runtime-failed' });
    expect(h.retryFirstTurnOnBundle).not.toHaveBeenCalled();
    expect(h.markUnsupported).toHaveBeenCalledWith(h.context, 'turn/start');
    expect(h.context.close).toHaveBeenCalledTimes(1);
    expect(h.context.startTurn).toHaveBeenCalledTimes(1);
    expect(h.bundledContext.startTurn).not.toHaveBeenCalled();
    expect(
      output.find(
        (event) =>
          event.eventType === 'text_delta' && event.source === 'complete',
      ),
    ).toMatchObject({
      delta:
        'Codex 0.166.0 does not support required method turn/start. Update Codex or Ptah. The next session will use bundled Codex.',
    });
    expect(h.adapter.isSessionActive(id)).toBe(false);
    expect((await snapshot.selectForOpen()).selected).toMatchObject({
      source: 'bundled',
    });
    await h.adapter.dispose();
  });

  it('reports a safe terminal error when bundled turn/start is also unsupported', async () => {
    const h = setup();
    h.context.startTurn.mockRejectedValueOnce(
      new CodexUnsupportedMethodError('turn/start', '0.165.0', 'bundled'),
    );
    const output: FlatStreamEventUnion[] = [];
    await expect(
      (async () => {
        for await (const event of await h.adapter.startChatSession({ tabId }))
          output.push(event);
      })(),
    ).rejects.toMatchObject({ code: 'runtime-failed' });
    expect(h.retryFirstTurnOnBundle).not.toHaveBeenCalled();
    expect(h.bundledContext.startTurn).not.toHaveBeenCalled();
    expect(
      output.find(
        (event) =>
          event.eventType === 'text_delta' && event.source === 'complete',
      ),
    ).toMatchObject({
      delta:
        'Codex 0.165.0 does not support required method turn/start. Update Codex or Ptah.',
    });
    await h.adapter.dispose();
  });

  it('does not replay turn/start after a receipt', async () => {
    const h = setup();
    const unsupported = new CodexUnsupportedMethodError(
      'turn/start',
      '0.166.0',
      'installed',
    );
    h.context.events.mockImplementation(() => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          throw unsupported;
        },
      }),
    }));
    await expect(
      collect(await h.adapter.startChatSession({ tabId })),
    ).rejects.toMatchObject({ code: 'runtime-failed' });
    expect(h.retryFirstTurnOnBundle).not.toHaveBeenCalled();
    expect(h.context.startTurn).toHaveBeenCalledTimes(1);
    await h.adapter.dispose();
  });

  it.each(['before receipt', 'after receipt'] as const)(
    'retires a failed turn %s when error publication never settles',
    async (point) => {
      const h = setup();
      h.callbacks.error.mockReturnValue(new Promise<void>(() => undefined));
      if (point === 'before receipt')
        h.context.startTurn.mockRejectedValueOnce(new Error('process died'));
      else
        h.context.events.mockImplementation(() =>
          (async function* () {
            yield { ...terminal, status: 'failed' as const };
          })(),
        );
      const output: FlatStreamEventUnion[] = [];
      let failure: unknown;
      try {
        for await (const event of await h.adapter.startChatSession({ tabId }))
          output.push(event);
      } catch (error) {
        failure = error;
      }
      expect(output.at(-1)).toMatchObject({
        eventType: 'turn_state',
        phase: 'failed',
      });
      expect(failure).toMatchObject({
        code: 'runtime-failed',
        webviewReported: true,
      });
      expect(h.context.close).toHaveBeenCalledTimes(1);
      expect(h.adapter.owns(id)).toBe(false);
      await h.adapter.dispose();
    },
  );

  it('keeps the gateway failure notice out of reply text', async () => {
    const h = setup('gateway');
    h.context.events.mockImplementation(() =>
      (async function* () {
        yield { ...terminal, status: 'failed' as const };
      })(),
    );
    const output: FlatStreamEventUnion[] = [];
    let failure: unknown;
    try {
      for await (const event of await h.adapter.startChatSession({
        tabId,
        consumer: 'gateway',
      }))
        output.push(event);
    } catch (error) {
      failure = error;
    }
    expect(
      output.filter((event) => event.eventType === 'text_delta'),
    ).toHaveLength(0);
    expect(output.at(-1)).toMatchObject({
      eventType: 'turn_state',
      phase: 'failed',
    });
    expect(failure).toMatchObject({ code: 'runtime-failed' });
    expect(h.callbacks.error).toHaveBeenCalledTimes(1);
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

  it('closes a detached session when interrupt is refused without a terminal', async () => {
    const h = setup();
    let finish: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    h.context.interrupt.mockResolvedValue(false);
    h.context.events.mockImplementation(() =>
      (async function* () {
        yield delta;
        await gate;
      })(),
    );
    h.context.close.mockImplementation(async () => {
      finish?.();
    });
    const stats = jest.fn();
    h.adapter.setResultStatsCallback(stats);
    jest.useFakeTimers({
      doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'],
    });

    try {
      const stream = await h.adapter.startChatSession({ tabId });
      const iterator = stream[Symbol.asyncIterator]();
      await iterator.next();
      await iterator.return?.();
      await new Promise<void>((resolve) => setImmediate(resolve));
      // No terminal is queued: the bounded drain wait expires, then the session closes.
      expect(h.context.close).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(5_000);

      expect(h.context.interrupt).toHaveBeenCalledWith('turn');
      expect(h.context.close).toHaveBeenCalledTimes(1);
      expect(h.lifecycle.closed).toHaveBeenCalledTimes(1);
      expect(h.adapter.owns(id)).toBe(false);
      expect(h.turnState.get(id)).toMatchObject({
        phase: 'idle',
        terminalReason: 'aborted_streaming',
      });
      expect(stats).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
      finish?.();
      await h.adapter.dispose();
    }
  });

  it('drains a queued completed terminal when interrupt reports the turn already finished', async () => {
    const h = setup('chat', 'api-key', 'gpt-4o');
    const stats = jest.fn();
    h.adapter.setResultStatsCallback(stats);
    h.context.interrupt.mockResolvedValue(false);
    h.context.events.mockImplementation(() =>
      (async function* () {
        yield delta;
        yield {
          ...terminal,
          evidence,
          usage: { inputTokens: 100, outputTokens: 20 },
        };
      })(),
    );

    const stream = await h.adapter.startChatSession({ tabId });
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(h.context.interrupt).toHaveBeenCalledWith('turn');
    expect(h.context.close).not.toHaveBeenCalled();
    expect(h.adapter.owns(id)).toBe(true);
    expect(h.turnState.get(id)).toMatchObject({
      phase: 'idle',
      terminalReason: 'completed',
    });
    expect(stats).toHaveBeenCalledWith(
      expect.objectContaining({
        turnCost: expect.any(Number),
      }),
    );
    await h.adapter.dispose();
  });

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
