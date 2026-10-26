import 'reflect-metadata';
import { Logger } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { container } from 'tsyringe';
import {
  CODEX_RUNTIME_TOKENS,
  CodexParityGate,
  type ApprovalSink,
  type CodexContext,
  type CodexExecutionProfile,
  type CodexRuntimeEvent,
} from '@ptah-extension/codex-runtime';
import { SessionId } from '@ptah-extension/shared';
import {
  CodexChatAdapter,
  CodexChatAdapterError,
  type CodexChatAdapterPorts,
} from './codex-chat-adapter';
import { SessionApprovalRouter } from './session-approval-router';

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
  const context: jest.Mocked<CodexContext> = {
    listModels: jest.fn(async () => [
      { id: 'catalog-gpt', model: 'gpt', displayName: 'GPT', isDefault: true },
    ]),
    identity,
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
    useFactory: () => (override ? { consumer: 'chat' } : null),
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
    adapter: new CodexChatAdapter(ports),
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

describe('CodexChatAdapter', () => {
  it('awaits result presentation before emitting message_complete or ending the generator', async () => {
    const h = setup();
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    h.callbacks.result.mockImplementation(() => { entered?.(); return gate; });
    const stream = await h.adapter.startChatSession({ tabId, prompt: 'hello' });
    const output: string[] = [];
    let ended = false;
    const drain = (async () => {
      for await (const event of stream) output.push(event.eventType);
      ended = true;
    })();
    await started;
    expect(output).not.toContain('message_complete');
    expect(ended).toBe(false);
    release?.();
    await drain;
    expect(output).toContain('message_complete');
    expect(ended).toBe(true);
    await h.adapter.dispose();
  });

  it('opens through the DS1 gate, persists native identity and emits one terminal result', async () => {
    const { adapter, context, ports, callbacks, lifecycle } = setup();
    const resolved = jest.fn();
    const stats = jest.fn();
    adapter.setSessionIdResolvedCallback(resolved);
    adapter.setResultStatsCallback(stats);
    const stream = await adapter.startChatSession({
      tabId,
      prompt: 'hello',
    });
    const output = [];
    for await (const event of stream) output.push(event);
    expect(context.events.mock.invocationCallOrder[0]).toBeLessThan(
      context.startTurn.mock.invocationCallOrder[0],
    );
    expect(ports.metadata.save).toHaveBeenCalledWith(id, identity, undefined);
    expect(lifecycle.opened.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(ports.metadata.save).mock.invocationCallOrder[0],
    );
    expect(resolved).toHaveBeenCalledWith(tabId, id);
    expect(output).toHaveLength(2);
    expect(callbacks.result).toHaveBeenCalledTimes(1);
    // Callbacks are bound to the native turn id from the turn/start receipt.
    expect(ports.callbacks).toHaveBeenCalledWith(
      id,
      expect.objectContaining({
        contextId: identity.contextId,
        processGeneration: identity.processGeneration,
        threadId: identity.threadId,
        turnId: 'turn',
      }),
    );
    expect(stats).not.toHaveBeenCalled();
    expect(lifecycle.opened).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ profile }),
    );
    expect(lifecycle.closed).not.toHaveBeenCalled();
    await adapter.interruptSession(id);
    adapter.endSession(id);
    adapter.endSession(id);
    expect(lifecycle.closed).toHaveBeenCalledTimes(1);
    expect(lifecycle.closed).toHaveBeenCalledWith(id);
  });
  it('refuses a closed gate without opening a context', async () => {
    const { adapter, open, dispose, lifecycle } = setup(false);
    await expect(adapter.startChatSession({ tabId })).rejects.toMatchObject({
      code: 'runtime-failed',
    });
    expect(open).not.toHaveBeenCalled();
    expect(lifecycle.opened).not.toHaveBeenCalled();
    expect(lifecycle.closed).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  it('retains native open and cleanup errors without changing the coded message', async () => {
    const { adapter, open, dispose, ports } = setup();
    const error = new Error('secret token');
    const cleanupError = new Error('secret cleanup');
    open.mockRejectedValue(error);
    dispose.mockRejectedValue(cleanupError);
    await expect(adapter.startChatSession({ tabId })).rejects.toMatchObject({
      message: 'Codex chat open: runtime-failed',
      cause: error,
    });
    expect(ports.logger.error).toHaveBeenCalledWith(
      '[CodexChatAdapter] runtime-failed: open.',
      error,
    );
    expect(jest.mocked(ports.logger.error).mock.calls[0]?.[1]).toBe(error);
    expect(ports.logger.error).toHaveBeenCalledWith(
      '[CodexChatAdapter] runtime-failed: scope cleanup.',
      cleanupError,
    );
  });
  it.each(['start', 'resume'] as const)(
    'does not persist identity when lifecycle staging throws during %s',
    async (operation) => {
      const { adapter, ports, lifecycle, context, dispose } = setup();
      const error = new Error('record failed');
      const contextError = new Error('context close failed');
      const lifecycleError = new Error('lifecycle cleanup failed');
      lifecycle.opened.mockImplementation(() => {
        throw error;
      });
      lifecycle.closed.mockImplementation(() => {
        throw lifecycleError;
      });
      context.close.mockRejectedValue(contextError);
      const opening =
        operation === 'start'
          ? adapter.startChatSession({ tabId })
          : adapter.resumeSession(id, { tabId });
      await expect(opening).rejects.toMatchObject({
        message: 'Codex chat open: runtime-failed',
        cause: error,
      });
      expect(ports.metadata.save).not.toHaveBeenCalled();
      expect(context.startTurn).not.toHaveBeenCalled();
      expect(adapter.owns(id)).toBe(false);
      expect(lifecycle.closed).toHaveBeenCalledWith(id);
      expect(context.close).toHaveBeenCalledTimes(1);
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(ports.logger.error).toHaveBeenCalledWith(
        '[CodexChatAdapter] runtime-failed: open.',
        error,
      );
      expect(ports.logger.error).toHaveBeenCalledWith(
        '[CodexChatAdapter] runtime-failed: lifecycle cleanup.',
        lifecycleError,
      );
      expect(ports.logger.error).toHaveBeenCalledWith(
        '[CodexChatAdapter] runtime-failed: context cleanup.',
        contextError,
      );
    },
  );
  it('stages lifecycle before persistence and releases it when persistence fails', async () => {
    const { adapter, ports, lifecycle, context, dispose } = setup();
    const error = new Error('metadata failed');
    ports.metadata.save = jest.fn(async () => {
      expect(lifecycle.opened).toHaveBeenCalledWith(
        id,
        expect.objectContaining({ profile }),
      );
      expect(adapter.owns(id)).toBe(false);
      throw error;
    });
    await expect(adapter.startChatSession({ tabId })).rejects.toMatchObject({
      message: 'Codex chat open: runtime-failed',
      cause: error,
    });
    expect(lifecycle.closed).toHaveBeenCalledTimes(1);
    expect(lifecycle.closed).toHaveBeenCalledWith(id);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(adapter.owns(id)).toBe(false);
  });
  it('normalizes a non-Error failure for logging and retains the original cause', async () => {
    const { adapter, open, ports } = setup();
    open.mockRejectedValue('native failure');
    await expect(adapter.startChatSession({ tabId })).rejects.toMatchObject({
      message: 'Codex chat open: runtime-failed',
      cause: 'native failure',
    });
    expect(ports.logger.error).toHaveBeenCalledWith(
      '[CodexChatAdapter] runtime-failed: open.',
      new Error('native failure'),
    );
  });
  it('resumes native identity, supports settings and compaction without SDK aliases', async () => {
    const { adapter, open, context } = setup();
    const stream = await adapter.resumeSession(id, { prompt: 'continue' });
    for await (const event of stream) void event;
    expect(open).toHaveBeenCalledWith(profile, identity);
    await adapter.setSessionPermissionLevel(id, 'yolo');
    await adapter.setSessionModel(id, 'next');
    await adapter.setSessionEffort(id, undefined);
    expect(context.updateNextTurn).toHaveBeenCalledWith({
      permissionLevel: 'yolo',
    });
    expect(context.updateNextTurn).toHaveBeenCalledWith({ effort: undefined });
    await adapter.executeSlashCommand(id, '/compact', {});
    expect(context.compact).toHaveBeenCalledTimes(1);
    await expect(
      adapter.setSessionPermissionLevel(id, 'bypassPermissions'),
    ).rejects.toMatchObject({ code: 'unsupported' });
    await adapter.interruptSession(id);
  });
  it('fails unsupported methods visibly', async () => {
    const { adapter } = setup();
    for (const action of [
      () => adapter.verifyInstallation(),
      () => adapter.getSupportedModels(),
      () => adapter.getApiModels(),
      () => adapter.getDefaultModel(),
      () => adapter.executeSlashCommand(id, '/unknown', {}),
    ])
      await expect(action()).rejects.toBeInstanceOf(CodexChatAdapterError);
    for (const action of [
      () => adapter.setLiveStatsCallback(),
      () => adapter.setWorktreeCreatedCallback(),
      () => adapter.setWorktreeRemovedCallback(),
    ])
      expect(action).toThrow(CodexChatAdapterError);
  });
  it('keeps the session after a missing terminal error', async () => {
    const { adapter, context, dispose } = setup();
    context.events.mockImplementation(() =>
      (async function* () {
        yield {
          ...identity,
          turnId: 'turn',
          sequence: 1,
          type: 'textDelta' as const,
          itemId: 'item',
          delta: 'hello',
        };
      })(),
    );
    const stream = await adapter.startChatSession({ tabId });
    await expect(
      (async () => {
        for await (const event of stream) void event;
      })(),
    ).rejects.toMatchObject({ code: 'runtime-failed' });
    expect(context.close).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    expect(adapter.isSessionActive(id)).toBe(true);
    context.events.mockImplementation(() =>
      (async function* () {
        yield terminal;
      })(),
    );
    await adapter.sendMessageToSession(id, 'retry');
    await adapter.interruptSession(id);
  });
  it('binds approval ownership to the context and releases it on end', async () => {
    const { adapter, ports, sink } = setup();
    await adapter.startChatSession({ tabId });
    const request = {
      ...identity,
      turnId: 'turn',
      requestId: 1,
      kind: 'command' as const,
      message: 'Run?',
      details: {},
    };
    const pending = sink().request(request, new AbortController().signal);
    expect(ports.presentation.present).toHaveBeenCalledWith(
      id,
      request,
      expect.any(Array),
    );
    const token = adapter.getSessionToken(id);
    if (!token) throw new Error('Expected a token for the active session');
    expect(await adapter.endSessionIfTokenMatches(id, 'stale')).toBe(false);
    expect(await adapter.endSessionIfTokenMatches(id, token)).toBe(true);
    await expect(pending).resolves.toBe('decline');
    expect(
      ports.approvals.respond(
        { sessionId: id, threadId: id, requestId: '1' },
        {
          kind: 'codex',
          response: { ...request, sessionId: id, decision: 'accept' },
        },
      ),
    ).toBe(false);
    const release = ports.approvals.register(
      { sessionId: id, threadId: id, requestId: '1' },
      { kind: 'claude' },
    );
    release();
    await expect(
      sink().request(
        { ...request, requestId: 2 },
        new AbortController().signal,
      ),
    ).resolves.toBe('decline');
  });
  it('holds approval beyond sixty seconds and releases on cancellation', async () => {
    jest.useFakeTimers();
    const { adapter, ports, sink } = setup();
    try {
      await adapter.startChatSession({ tabId });
      const request = {
        ...identity,
        turnId: 'turn',
        requestId: 7,
        kind: 'command' as const,
        message: 'Run?',
        details: {},
      };
      const pending = sink().request(request, new AbortController().signal);
      jest.advanceTimersByTime(60_000);
      expect(ports.presentation.dismiss).not.toHaveBeenCalled();
      ports.approvals.cancelPrompt(
        { sessionId: id, threadId: id, requestId: '7' },
        'turn-ended',
      );
      await expect(pending).resolves.toBe('cancel');
      const release = ports.approvals.register(
        { sessionId: id, threadId: id, requestId: '7' },
        { kind: 'claude' },
      );
      release();
      expect(ports.presentation.cancelPrompt).toHaveBeenCalledWith({
        sessionId: id,
        requestId: '7',
        reason: 'turn-ended',
      });
      expect(ports.presentation.cancelPrompt).toHaveBeenCalledTimes(1);
      await adapter.interruptSession(id);
    } finally {
      jest.useRealTimers();
    }
  });
  it('does not publish a session whose open was invalidated by reset', async () => {
    const { adapter, open, context, ports } = setup();
    let release!: (value: typeof context) => void;
    open.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = adapter.startChatSession({ tabId });
    // profile resolution yields before runtime.open.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await adapter.reset();
    release(context);
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(adapter.isSessionActive(id)).toBe(false);
    expect(ports.metadata.save).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledTimes(1);
  });
  it('cancels a pending open when its tab is ended', async () => {
    const { adapter, open, context, ports } = setup();
    let release!: (value: typeof context) => void;
    open.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = adapter.startChatSession({ tabId });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    adapter.endSession(tabId);
    release(context);
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(ports.metadata.save).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledTimes(1);
  });
  it('rejects live resume configuration rather than silently ignoring it', async () => {
    const { adapter } = setup();
    const stream = await adapter.startChatSession({ tabId });
    for await (const event of stream) void event;
    await expect(
      adapter.resumeSession(id, { model: 'other' }),
    ).rejects.toMatchObject({
      code: 'unsupported',
      operation: 'activeResumeConfig',
    });
    await adapter.interruptSession(id);
  });
  it('emits only reported usage, with unknown cost, once per turn', async () => {
    const { adapter, context } = setup();
    const stats = jest.fn();
    adapter.setResultStatsCallback(stats);
    context.events.mockImplementation(() =>
      (async function* () {
        yield {
          ...terminal,
          usage: {
            inputTokens: 12,
            outputTokens: 5,
            cachedInputTokens: 3,
            cacheWriteInputTokens: 2,
            reasoningOutputTokens: 4,
          },
        };
        yield terminal;
      })(),
    );
    const stream = await adapter.startChatSession({ tabId });
    for await (const event of stream) void event;
    expect(stats).toHaveBeenCalledTimes(1);
    expect(stats).toHaveBeenCalledWith(
      expect.objectContaining({
        turnCost: null,
        tokens: { input: 9, output: 5, cacheRead: 3, cacheCreation: 2 },
      }),
    );
    await adapter.interruptSession(id);
  });
  it('blocks overlapping turns and follow-ups after a failed interrupt', async () => {
    const { adapter, context } = setup();
    context.events.mockImplementation(() =>
      (async function* () {
        yield {
          ...identity,
          turnId: 'turn',
          sequence: 1,
          type: 'textDelta' as const,
          itemId: 'item',
          delta: 'hello',
        };
        yield terminal;
      })(),
    );
    const stream = await adapter.startChatSession({ tabId });
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();
    expect(adapter.canSendFollowUp(id)).toBe(false);
    context.interrupt.mockRejectedValue(new Error('secret'));
    await expect(adapter.interruptCurrentTurn(id)).rejects.toMatchObject({
      code: 'runtime-failed',
    });
    await expect(
      adapter.sendMessageToSession(id, 'next'),
    ).rejects.toBeInstanceOf(CodexChatAdapterError);
    while (!(await iterator.next()).done) {
      /* Finish the interrupted turn. */
    }
    expect(adapter.canSendFollowUp(id)).toBe(true);
    await expect(
      adapter.sendMessageToSession(id, 'next'),
    ).resolves.toBeUndefined();
    await adapter.interruptSession(id);
  });
});

it.each(['unconsumed', 'returned', 'publish-failure'] as const)(
  'does not latch busy for %s streams',
  async (mode) => {
    const { adapter, ports, context } = setup();
    const stream = await adapter.startChatSession({ tabId });
    if (mode === 'returned') await stream[Symbol.asyncIterator]().return?.();
    if (mode === 'publish-failure') {
      ports.publish = jest.fn(async () => {
        throw new Error('publish failed');
      });
      await expect(
        adapter.sendMessageToSession(id, 'fail'),
      ).rejects.toMatchObject({ code: 'runtime-failed' });
    }
    const retry = await adapter.resumeSession(id, {
      prompt: 'retry',
      model: undefined,
    });
    for await (const event of retry) void event;
    expect(context.startTurn).toHaveBeenCalledTimes(1);
    await adapter.interruptSession(id);
  },
);
it('retains context and releases busy after a transient start rejection', async () => {
  const { adapter, context, ports } = setup();
  const error = new Error('temporary');
  context.startTurn.mockRejectedValueOnce(error);
  const stream = await adapter.startChatSession({ tabId });
  await expect(stream[Symbol.asyncIterator]().next()).rejects.toMatchObject({
    code: 'runtime-failed',
    message: 'Codex chat turn: runtime-failed',
    cause: error,
  });
  expect(ports.logger.error).toHaveBeenCalledWith(
    '[CodexChatAdapter] runtime-failed: turn.',
    error,
  );
  await adapter.sendMessageToSession(id, 'retry');
  expect(context.close).not.toHaveBeenCalled();
  await adapter.interruptSession(id);
});
it('retains setting failures as causes and logs the original error', async () => {
  const { adapter, context, ports } = setup();
  await adapter.startChatSession({ tabId });
  const error = new Error('model update failed');
  context.updateNextTurn.mockRejectedValueOnce(error);
  await expect(adapter.setSessionModel(id, 'gpt')).rejects.toMatchObject({
    message: 'Codex chat model: runtime-failed',
    cause: error,
  });
  expect(ports.logger.error).toHaveBeenCalledWith(
    '[CodexChatAdapter] runtime-failed: model.',
    error,
  );
  expect(jest.mocked(ports.logger.error).mock.calls[0]?.[1]).toBe(error);
  await adapter.interruptSession(id);
});
it('logs the original subscription cleanup error after a terminal result', async () => {
  const { adapter, context, ports, callbacks } = setup();
  const error = new Error('subscription cleanup failed');
  // Same contract as a generator whose `finally` throws: after the terminal
  // event, both further reads and `return()` reject with the cleanup error.
  context.events.mockImplementation(() => {
    let delivered = false;
    const iterator: AsyncIterableIterator<typeof terminal> = {
      [Symbol.asyncIterator]: () => iterator,
      next: async () => {
        if (delivered) throw error;
        delivered = true;
        return { done: false, value: terminal };
      },
      return: async () => {
        throw error;
      },
    };
    return iterator;
  });
  const stream = await adapter.startChatSession({ tabId });
  for await (const event of stream) void event;
  expect(callbacks.result).toHaveBeenCalledTimes(1);
  expect(ports.logger.error).toHaveBeenCalledWith(
    '[CodexChatAdapter] runtime-failed: event subscription cleanup.',
    error,
  );
  expect(jest.mocked(ports.logger.error).mock.calls[0]?.[1]).toBe(error);
  await adapter.interruptSession(id);
});
it('clears a rejected interrupt when the turn ends', async () => {
  const { adapter, context } = setup();
  const stream = await adapter.startChatSession({ tabId });
  const iterator = stream[Symbol.asyncIterator]();
  await iterator.next();
  context.interrupt.mockResolvedValue(false);
  expect(await adapter.interruptCurrentTurn(id)).toBe(false);
  while (!(await iterator.next()).done) {
    /* Drain the terminal event. */
  }
  expect(await adapter.interruptCurrentTurn(id)).toBe(false);
  await adapter.sendMessageToSession(id, 'retry');
  await adapter.interruptSession(id);
});
it('queries the session context model list and rejects closed sessions', async () => {
  const { adapter, context } = setup();
  expect(adapter.getHealth().status).toBe('available');
  await adapter.startChatSession({ tabId });
  await expect(adapter.listSessionModels(id)).resolves.toEqual([
    { value: 'gpt', displayName: 'GPT' },
  ]);
  expect(context.listModels).toHaveBeenCalledTimes(1);
  await adapter.interruptSession(id);
  await expect(adapter.listSessionModels(id)).rejects.toMatchObject({
    code: 'unavailable',
  });
});
it.each([7, undefined])(
  'reports only last-request compaction tokens (%s)',
  async (lastRequestTotalTokens) => {
    const { adapter, context } = setup();
    context.events.mockImplementation(() =>
      (async function* () {
        yield {
          ...identity,
          turnId: 'turn',
          sequence: 1,
          type: 'usage' as const,
          usage: {
            inputTokens: 10,
            outputTokens: 3,
            cachedInputTokens: 4,
            totalTokens: 13,
            lastRequestTotalTokens,
          },
        };
        yield terminal;
      })(),
    );
    const callback = jest.fn();
    adapter.setCompactionStartCallback(callback);
    const stream = await adapter.startChatSession({ tabId });
    for await (const event of stream) void event;
    await adapter.executeSlashCommand(id, '/compact', {});
    if (lastRequestTotalTokens === undefined)
      expect(callback).not.toHaveBeenCalled();
    else
      expect(callback).toHaveBeenCalledWith({
        sessionId: id,
        trigger: 'manual',
        timestamp: expect.any(Number),
        preTokens: 7,
      });
    await adapter.interruptSession(id);
  },
);

function deferred<T>() {
  let complete: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    complete = resolve;
  });
  return {
    promise,
    resolve(value: T) {
      if (!complete) throw new Error('Deferred promise has no resolver');
      complete(value);
    },
  };
}

it('rejects overlapping resumes of one thread before creating another scope', async () => {
  const { adapter, ports, open, context, dispose } = setup();
  const entered = deferred<void>();
  const finishSave = deferred<void>();
  ports.metadata.save = jest.fn(async () => {
    entered.resolve();
    await finishSave.promise;
  });
  const first = adapter.resumeSession(id, { tabId });
  await entered.promise;
  await expect(
    adapter.resumeSession(id, {
      tabId: SessionId.from('33333333-3333-4333-8333-333333333333'),
    }),
  ).rejects.toMatchObject({ code: 'busy', operation: 'open' });
  expect(open).toHaveBeenCalledTimes(1);
  expect(context.close).not.toHaveBeenCalled();
  expect(dispose).not.toHaveBeenCalled();
  finishSave.resolve();
  await first;
  expect(adapter.owns(tabId)).toBe(false);
  expect(adapter.owns(id)).toBe(true);
  await adapter.interruptSession(id);
  expect(context.close).toHaveBeenCalledTimes(1);
  expect(dispose).toHaveBeenCalledTimes(1);
});

it('closes the losing context when another open publishes during metadata save', async () => {
  const first = setup();
  const second = setup();
  first.ports.createScope = jest
    .fn()
    .mockImplementationOnce(first.ports.createScope)
    .mockImplementationOnce(second.ports.createScope);
  const entered = deferred<void>();
  const finishSave = deferred<void>();
  first.ports.metadata.save = jest
    .fn()
    .mockImplementationOnce(async () => {
      entered.resolve();
      await finishSave.promise;
    })
    .mockResolvedValue(undefined);
  const losing = first.adapter.startChatSession({ tabId });
  const rejected = expect(losing).rejects.toMatchObject({
    code: 'busy',
    operation: 'open',
  });
  await entered.promise;
  await first.adapter.startChatSession({
    tabId: SessionId.from('33333333-3333-4333-8333-333333333333'),
  });
  finishSave.resolve();
  await rejected;
  expect(first.context.close).toHaveBeenCalledTimes(1);
  expect(first.dispose).toHaveBeenCalledTimes(1);
  expect(second.context.close).not.toHaveBeenCalled();
  expect(first.lifecycle.closed).not.toHaveBeenCalled();
  expect(first.adapter.owns(id)).toBe(true);
  await first.adapter.interruptSession(id);
  expect(second.context.close).toHaveBeenCalledTimes(1);
  expect(second.dispose).toHaveBeenCalledTimes(1);
});
it('releases staged lifecycle state when cancellation arrives during metadata save', async () => {
  const { adapter, ports, lifecycle, context, dispose } = setup();
  const entered = deferred<void>();
  const finishSave = deferred<void>();
  ports.metadata.save = jest.fn(async () => {
    entered.resolve();
    await finishSave.promise;
  });
  const opening = adapter.startChatSession({ tabId });
  const rejected = expect(opening).rejects.toMatchObject({ code: 'cancelled' });
  await entered.promise;
  expect(lifecycle.opened).toHaveBeenCalledTimes(1);
  adapter.endSession(tabId);
  finishSave.resolve();
  await rejected;
  expect(lifecycle.closed).toHaveBeenCalledTimes(1);
  expect(lifecycle.closed).toHaveBeenCalledWith(id);
  expect(context.startTurn).not.toHaveBeenCalled();
  expect(context.close).toHaveBeenCalledTimes(1);
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(adapter.owns(id)).toBe(false);
});

it.each(['end', 'interrupt'] as const)(
  'cancels a pending resume by thread id (%s)',
  async (method) => {
    const { adapter, open, context, ports, dispose } = setup();
    const entered = deferred<void>();
    const pending = deferred<jest.Mocked<CodexContext>>();
    open.mockImplementation(async () => {
      entered.resolve();
      return pending.promise;
    });
    const opening = adapter.resumeSession(id, { tabId });
    const rejected = expect(opening).rejects.toMatchObject({
      code: 'cancelled',
    });
    await entered.promise;
    expect(adapter.owns(id)).toBe(true);
    expect(adapter.owns(tabId)).toBe(true);
    if (method === 'end') adapter.endSession(id);
    else await expect(adapter.interruptSession(id)).resolves.toBeUndefined();
    expect(adapter.isSessionActive(id)).toBe(false);
    expect(adapter.isSessionActive(tabId)).toBe(false);
    pending.resolve(context);
    await rejected;
    expect(ports.metadata.save).not.toHaveBeenCalled();
    expect(context.startTurn).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(adapter.owns(id)).toBe(false);
    expect(adapter.owns(tabId)).toBe(false);
  },
);

it.each(['end', 'interrupt'] as const)(
  'close the tab during a native open (%s)',
  async (method) => {
    const { adapter, open, context, ports, dispose } = setup();
    const pending = deferred<jest.Mocked<CodexContext>>();
    const entered = deferred<void>();
    open.mockImplementation(async () => {
      entered.resolve();
      return pending.promise;
    });
    const resolved = jest.fn();
    adapter.setSessionIdResolvedCallback(resolved);
    const opening = adapter.startChatSession({ tabId });
    const rejected = expect(opening).rejects.toMatchObject({
      code: 'cancelled',
    });
    await entered.promise;
    expect(adapter.owns(tabId)).toBe(true);
    expect(adapter.isSessionActive(tabId)).toBe(true);
    expect(adapter.canSendFollowUp(tabId)).toBe(false);
    if (method === 'end') adapter.endSession(tabId);
    else await adapter.interruptSession(tabId);
    expect(adapter.isSessionActive(tabId)).toBe(false);
    pending.resolve(context);
    await rejected;
    expect(ports.metadata.save).not.toHaveBeenCalled();
    expect(resolved).not.toHaveBeenCalled();
    expect(context.startTurn).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(adapter.owns(tabId)).toBe(false);
    expect(adapter.owns(id)).toBe(false);
  },
);

it('uses execution slugs and prefers the default catalog entry for duplicate slugs', async () => {
  const { adapter, context, open } = setup();
  context.listModels.mockResolvedValue([
    { id: 'alias', model: 'gpt', displayName: 'Alias', isDefault: false },
    {
      id: 'default-key',
      model: 'gpt',
      displayName: 'Default',
      isDefault: true,
    },
    { id: 'later', model: 'gpt', displayName: 'Later', isDefault: false },
  ]);
  const stream = await adapter.startChatSession({ tabId, model: 'gpt' });
  for await (const event of stream) void event;
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({ model: 'gpt' }),
    undefined,
  );
  const models = await adapter.listSessionModels(id);
  expect(models).toEqual([{ value: 'gpt', displayName: 'Default' }]);
  await adapter.setSessionModel(id, models[0].value);
  expect(context.updateNextTurn).toHaveBeenCalledWith({ model: 'gpt' });
  await adapter.interruptSession(id);
});

it('applies Stop requested before the startTurn receipt arrives', async () => {
  const { adapter, context } = setup();
  const receipt = deferred<Awaited<ReturnType<CodexContext['startTurn']>>>();
  context.startTurn.mockReturnValue(receipt.promise);
  const stream = await adapter.startChatSession({ tabId });
  const iterator = stream[Symbol.asyncIterator]();
  const next = iterator.next();
  expect(await adapter.interruptCurrentTurn(id)).toBe(true);
  expect(adapter.canSendFollowUp(id)).toBe(false);
  receipt.resolve({ threadId: id, turnId: 'turn', revision: 1 });
  await next;
  expect(context.interrupt).toHaveBeenCalledWith('turn');
  while (!(await iterator.next()).done) {
    /* Drain terminal. */
  }
  expect(adapter.canSendFollowUp(id)).toBe(true);
  await adapter.interruptSession(id);
});

it('keeps busy after consumer return until the interrupted turn terminal', async () => {
  const { adapter, context, callbacks } = setup();
  const finished = deferred<void>();
  const delivered = deferred<void>();
  callbacks.result.mockImplementation(() => delivered.resolve());
  context.events.mockImplementation(() =>
    (async function* () {
      yield {
        ...identity,
        turnId: 'turn',
        sequence: 1,
        type: 'textDelta' as const,
        itemId: 'item',
        delta: 'hello',
      };
      await finished.promise;
      yield terminal;
    })(),
  );
  const stream = await adapter.startChatSession({ tabId });
  const iterator = stream[Symbol.asyncIterator]();
  await iterator.next();
  await iterator.return?.();
  expect(adapter.canSendFollowUp(id)).toBe(false);
  await expect(
    adapter.sendMessageToSession(id, 'too soon'),
  ).rejects.toMatchObject({ code: 'busy' });
  finished.resolve();
  await delivered.promise;
  // Cleanup completes after the result callback and iterator return.
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(adapter.canSendFollowUp(id)).toBe(true);
  expect(context.interrupt).toHaveBeenCalledTimes(1);
  await adapter.interruptSession(id);
});

it('refuses live stats without exact resumed session history', () => {
  const { adapter } = setup();
  expect(() => adapter.setLiveStatsCallback()).toThrow(
    'Codex chat liveStats: unsupported',
  );
});

it.each(['end', 'interrupt'] as const)(
  'cancel during save (%s)',
  async (method) => {
    const { adapter, context, ports, dispose } = setup();
    const entered = deferred<void>();
    const finishSave = deferred<void>();
    const saved = jest.fn();
    const save = jest.fn(async () => {
      entered.resolve();
      await finishSave.promise;
      saved(id, identity);
    });
    ports.metadata.save = save;
    const resolved = jest.fn();
    adapter.setSessionIdResolvedCallback(resolved);
    const opening = adapter.startChatSession({ tabId });
    const rejected = expect(opening).rejects.toMatchObject({
      code: 'cancelled',
    });
    await entered.promise;
    expect(adapter.owns(tabId)).toBe(true);
    if (method === 'end') adapter.endSession(tabId);
    else await adapter.interruptSession(tabId);
    expect(saved).not.toHaveBeenCalled();
    expect(context.close).not.toHaveBeenCalled();
    expect(adapter.canSendFollowUp(tabId)).toBe(false);
    finishSave.resolve();
    await rejected;
    expect(save).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledWith(id, identity);
    expect(resolved).not.toHaveBeenCalled();
    expect(ports.publish).not.toHaveBeenCalled();
    expect(context.startTurn).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(adapter.owns(tabId)).toBe(false);
    expect(adapter.owns(id)).toBe(false);
    expect(adapter.isSessionActive(tabId)).toBe(false);
    expect(adapter.isSessionActive(id)).toBe(false);
    expect(adapter.canSendFollowUp(id)).toBe(false);
  },
);
