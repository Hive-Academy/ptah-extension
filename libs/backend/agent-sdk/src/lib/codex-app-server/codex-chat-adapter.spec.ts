import 'reflect-metadata';
import { Logger } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { container } from 'tsyringe';
import {
  CODEX_RUNTIME_TOKENS,
  CodexContextStateError,
  CodexResumeProfileChangedError,
  CodexParityGate,
  type ApprovalSink,
  type CodexContext,
  type CodexDevRouteOverride,
  type CodexExecutionProfile,
  type CodexRuntimeEvent,
} from '@ptah-extension/codex-runtime';
import { SessionId, type FlatStreamEventUnion } from '@ptah-extension/shared';
import {
  CodexChatAdapter,
  type CodexChatAdapterPorts,
} from './codex-chat-adapter';
import {
  CodexChatAdapterError,
  isCodexChatAdapterError,
  type CodexChatAdapterErrorCode,
} from './codex-chat-adapter-error';
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
  cwd: 'C:\\repo',
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

function setup(override: boolean | 'gateway' = true) {
  const logger = mockLogger();
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
      override ? {
        consumers: override === 'gateway' ? ['gateway'] : ['chat', 'gateway'],
        source: 'PTAH_CODEX_RUNTIME_DEV',
      } : null
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
    resolveApprovalPath: async (value) => value,
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
    metadata: { save: jest.fn(async () => undefined), completedTurn: jest.fn(async () => undefined) },
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
    adapter: new CodexChatAdapter(ports, new SessionTurnStateRegistry()),
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
  it('maps the typed resume profile error to the adapter code', async () => {
    const h = setup();
    const cause = new CodexResumeProfileChangedError();
    h.open.mockRejectedValueOnce(cause);

    await expect(h.adapter.resumeSession(id, { tabId })).rejects.toMatchObject({
      code: 'resume-profile-changed',
      cause,
    });
  });

  it('passes files and images when resuming an already open thread', async () => {
    const h = setup();
    await h.adapter.startChatSession({ tabId });

    const stream = await h.adapter.resumeSession(id, {
      prompt: '',
      files: ['src/main.ts'],
      images: [{ data: 'aGVsbG8=', mediaType: 'image/png' }],
    });
    for await (const event of stream) void event;

    expect(h.context.startTurn).toHaveBeenCalledTimes(1);
    expect(h.context.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      text: '',
      attachments: [
        { type: 'file', path: 'src/main.ts' },
        { type: 'image', data: 'aGVsbG8=', mediaType: 'image/png' },
      ],
    }));
    await h.adapter.dispose();
  });
  it('accepts additional peer origin fields like the Claude adapter', async () => {
    const h = setup();
    const first = await h.adapter.startChatSession({ tabId });
    for await (const event of first) void event;
    const origin = {
      kind: 'peer' as const,
      from: 'ptah-agent:lane-a',
      name: 'Codex lane',
      sentAt: '2026-10-31T00:00:00.000Z',
    };

    await h.adapter.sendMessageToSession(id, 'peer message', { origin });

    expect(h.context.startTurn).toHaveBeenLastCalledWith(expect.objectContaining({
      text: 'peer message', attachments: [],
    }));
    await h.adapter.dispose();
  });

  it.each(['failed', 'interrupted'] as const)('does not count a %s native turn', async (status) => {
    const h = setup();
    h.context.events.mockImplementation(() => (async function* () {
      yield { ...terminal, status };
    })());
    const stream = await h.adapter.startChatSession({ tabId, prompt: 'hello' });
    const iterator = stream[Symbol.asyncIterator]();
    if (status === 'failed') {
      expect((await iterator.next()).value).toMatchObject({
        eventType: 'message_start', role: 'assistant', source: 'complete',
      });
      expect((await iterator.next()).value).toMatchObject({
        eventType: 'text_delta', delta: 'Codex reported a runtime error.',
      });
    }
    expect((await iterator.next()).value).toMatchObject({
      eventType: 'turn_state', phase: status === 'failed' ? 'failed' : 'idle',
    });
    await expect(iterator.next()).rejects.toMatchObject({
      code: status === 'failed' ? 'runtime-failed' : 'cancelled',
    });
    expect(h.ports.metadata.completedTurn).not.toHaveBeenCalled();
    await h.adapter.dispose();
  });

  it('accepts a follow-up client id, echoes it once and consumes it without forwarding it', async () => {
    const h = setup();
    const events: FlatStreamEventUnion[] = [];
    let finishPublish: () => void = () => undefined;
    const published = new Promise<void>((resolve) => {
      finishPublish = resolve;
    });
    jest.mocked(h.ports.publish).mockImplementation(async (_id, stream) => {
      try {
        for await (const event of stream) events.push(event);
      } finally {
        finishPublish();
      }
    });
    const first = await h.adapter.startChatSession({ tabId });
    for await (const event of first) void event;
    await h.adapter.sendMessageToSession(id, 'follow-up', {
      clientMessageId: 'prompt-2', files: [], images: [],
    });
    await published;
    expect(events.filter((event) => event.eventType === 'message_start' && event.role === 'user'))
      .toEqual([expect.objectContaining({ clientMessageId: 'prompt-2', sessionId: id })]);
    expect(events.filter((event) => event.eventType === 'turn_state' && event.consumedClientMessageId))
      .toEqual([expect.objectContaining({ consumedClientMessageId: 'prompt-2', phase: 'idle' })]);
    expect(h.context.startTurn).toHaveBeenLastCalledWith(expect.objectContaining({
      text: 'follow-up', attachments: [],
    }));
    expect(jest.mocked(h.context.startTurn).mock.lastCall?.[0]).not.toHaveProperty('clientMessageId');
    await h.adapter.dispose();
  });

  it('renders a delivered lane message as a peer message in native Codex chat', async () => {
    const h = setup();
    const events: FlatStreamEventUnion[] = [];
    let finishPublish: () => void = () => undefined;
    const published = new Promise<void>((resolve) => { finishPublish = resolve; });
    jest.mocked(h.ports.publish).mockImplementation(async (_id, stream) => {
      try {
        for await (const event of stream) events.push(event);
      } finally {
        finishPublish();
      }
    });
    const first = await h.adapter.startChatSession({ tabId });
    for await (const event of first) void event;
    const message = '<agent-lane-completed>Delivered</agent-lane-completed>';
    await h.adapter.sendMessageToSession(id, message, {
      origin: { kind: 'peer', from: 'ptah-agent:lane-a', name: 'Codex lane' },
    });
    await published;
    expect(events.slice(0, 3)).toEqual([
      expect.objectContaining({
        eventType: 'message_start', role: 'user', sessionId: id,
        inboundPeer: { label: 'Codex lane' },
      }),
      expect.objectContaining({ eventType: 'text_delta', delta: message }),
      expect.objectContaining({ eventType: 'message_complete' }),
    ]);
    expect(h.context.startTurn).toHaveBeenLastCalledWith(expect.objectContaining({
      text: message, attachments: [],
    }));
    await h.adapter.dispose();
  });
  it('admits a live follow-up before its native event stream ends', async () => {
    const h = setup();
    const first = await h.adapter.startChatSession({ tabId });
    for await (const event of first) void event;
    const release = deferred<void>();
    let publisherFinished = false;
    let finishPublish: () => void = () => undefined;
    const published = new Promise<void>((resolve) => {
      finishPublish = resolve;
    });
    h.context.events.mockImplementation(() => (async function* () {
      await release.promise;
      yield terminal;
    })());
    jest.mocked(h.ports.publish).mockImplementation(async (_id, stream) => {
      try {
        for await (const event of stream) void event;
      } finally {
        publisherFinished = true;
        finishPublish();
      }
    });

    const send = h.adapter.sendMessageToSession(id, 'follow-up');
    const tick = new Promise<'held'>((resolve) => setImmediate(() => resolve('held')));
    const outcome = await Promise.race([
      send.then(() => 'admitted' as const, () => 'rejected' as const),
      tick,
    ]);
    try {
      expect(h.context.startTurn).toHaveBeenCalledTimes(2);
      expect(publisherFinished).toBe(false);
      expect(h.adapter.canSendFollowUp(id)).toBe(false);
    } finally {
      release.resolve();
      await published;
      await send.catch(() => undefined);
      await tick;
      await h.adapter.dispose();
    }
    expect(outcome).toBe('admitted');
  });

  it('settles a turn/start refusal after the broadcaster publishes its notice', async () => {
    const h = setup();
    const first = await h.adapter.startChatSession({ tabId });
    for await (const event of first) void event;
    h.context.startTurn.mockRejectedValueOnce(new Error('admission refused'));
    const notices: string[] = [];
    jest.mocked(h.ports.publish).mockImplementation(async (_id, stream) => {
      try {
        for await (const event of stream) {
          if (event.eventType === 'text_delta') notices.push(event.delta);
        }
      } catch {
        // The host broadcaster already published the failure notice.
      }
    });

    await expect(h.adapter.sendMessageToSession(id, 'follow-up')).resolves.toBeUndefined();
    expect(notices).toEqual(['Codex reported a runtime error.']);
    await h.adapter.dispose();
  });

  it('logs a publisher rejection after admission without rejecting the send', async () => {
    const h = setup();
    const first = await h.adapter.startChatSession({ tabId });
    for await (const event of first) void event;
    const release = deferred<void>();
    let finishPublish: () => void = () => undefined;
    const published = new Promise<void>((resolve) => {
      finishPublish = resolve;
    });
    h.context.events.mockImplementation(() => (async function* () {
      await release.promise;
      yield {
        ...identity,
        turnId: 'turn',
        sequence: 1,
        type: 'textDelta' as const,
        itemId: 'item',
        delta: 'partial',
      };
      throw new Error('stream lost');
    })());
    jest.mocked(h.ports.publish).mockImplementation(async (_id, stream) => {
      try {
        for await (const event of stream) void event;
      } finally {
        finishPublish();
      }
    });

    const send = h.adapter.sendMessageToSession(id, 'follow-up');
    const tick = new Promise<'held'>((resolve) => setImmediate(() => resolve('held')));
    const outcome = await Promise.race([
      send.then(() => 'admitted' as const, () => 'rejected' as const),
      tick,
    ]);
    try {
      expect(outcome).toBe('admitted');
    } finally {
      release.resolve();
      await published;
      await Promise.resolve();
      await send.catch(() => undefined);
      await tick;
      await h.adapter.dispose();
      expect(h.ports.logger.error).toHaveBeenCalledWith(
        '[CodexChatAdapter] Follow-up publisher failed after admission.',
        expect.any(Error),
      );
    }
  });

  it('accepts Claude-compatible unused follow-up options', async () => {
    const h = setup();
    const first = await h.adapter.startChatSession({ tabId });
    for await (const event of first) void event;
    await h.adapter.sendMessageToSession(id, 'text', { model: 'gpt' });
    expect(h.context.startTurn).toHaveBeenLastCalledWith(expect.objectContaining({
      text: 'text', attachments: [],
    }));
    await h.adapter.dispose();
  });

  it('logs an invalid client message id through failure before starting a turn', async () => {
    const h = setup();
    await expect(h.adapter.sendMessageToSession(id, 'text', { clientMessageId: '' }))
      .rejects.toMatchObject({ code: 'runtime-failed', operation: 'messageOptions' });
    expect(h.ports.logger.error).toHaveBeenCalledWith(
      '[CodexChatAdapter] runtime-failed: messageOptions.', expect.any(Error),
    );
    expect(h.context.startTurn).not.toHaveBeenCalled();
    await h.adapter.dispose();
  });

  it('still presents the turn result when the message-count write fails', async () => {
    const h = setup();
    const completedTurn = jest.fn(async (_id: SessionId): Promise<void> => {
      throw new Error('disk full');
    });
    h.ports.metadata.completedTurn = completedTurn;
    const stream = await h.adapter.startChatSession({ tabId, prompt: 'hello' });
    const output: string[] = [];
    for await (const event of stream) output.push(event.eventType);
    expect(completedTurn).toHaveBeenCalledTimes(1);
    expect(h.callbacks.result).toHaveBeenCalledTimes(1);
    expect(output).toContain('message_complete');
    expect(h.ports.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('message-count-write-failed'),
      { error: 'disk full' },
    );
    await h.adapter.dispose();
  });

  it('does not count a native session opened without a turn', async () => {
    const h = setup();
    await h.adapter.startChatSession({ tabId });
    expect(h.ports.metadata.completedTurn).not.toHaveBeenCalled();
    await h.adapter.dispose();
  });

  it('awaits explicit native close before a cleared tab can start fresh', async () => {
    const h = setup();
    await h.adapter.startChatSession({ tabId });
    let finishClose: (() => void) | undefined;
    const closing = new Promise<void>((resolve) => { finishClose = resolve; });
    h.context.close.mockReturnValue(closing);
    let settled = false;
    const close = h.adapter.closeSession(id).then(() => { settled = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.context.close).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    expect(h.adapter.isSessionActive(id)).toBe(false);
    finishClose?.();
    await close;
    expect(settled).toBe(true);
    expect(h.lifecycle.closed).toHaveBeenCalledWith(id);
  });

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
    expect(output.map((event) => event.eventType)).toEqual([
      'turn_state',
      'message_start',
      'message_complete',
      'turn_state',
    ]);
    expect(callbacks.result).toHaveBeenCalledTimes(1);
    expect(ports.metadata.completedTurn).toHaveBeenCalledTimes(1);
    expect(ports.metadata.completedTurn).toHaveBeenCalledWith(id);
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

  it('passes a start tab name to metadata when it is the only title', async () => {
    const { adapter, ports } = setup();
    await adapter.startChatSession({ tabId, name: 'Tab title' });
    expect(ports.metadata.save).toHaveBeenCalledWith(id, identity, 'Tab title');
  });

  it('falls through a blank session title to the start tab name', async () => {
    const { adapter, ports } = setup();
    await adapter.startChatSession({
      tabId,
      sessionTitle: '   ',
      sessionName: ' \t ',
      name: 'Tab title',
    });
    expect(ports.metadata.save).toHaveBeenCalledWith(id, identity, 'Tab title');
  });

  it('falls through a blank session title to the session name', async () => {
    const { adapter, ports } = setup();
    await adapter.startChatSession({
      tabId,
      sessionTitle: ' \t ',
      sessionName: 'Session name',
      name: 'Tab title',
    });
    expect(ports.metadata.save).toHaveBeenCalledWith(id, identity, 'Session name');
  });

  it('prefers a nonblank session title over session name and tab name', async () => {
    const { adapter, ports } = setup();
    await adapter.startChatSession({
      tabId,
      sessionTitle: 'Explicit title',
      sessionName: 'Session name',
      name: 'Tab title',
    });
    expect(ports.metadata.save).toHaveBeenCalledWith(id, identity, 'Explicit title');
  });

  it('passes the available title during resume', async () => {
    const { adapter, ports } = setup();
    await adapter.resumeSession(id, {
      tabId,
      sessionTitle: '  ',
      sessionName: 'Resumed title',
    });
    expect(ports.metadata.save).toHaveBeenCalledWith(id, identity, 'Resumed title');
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

  it('opens a gateway start with read auto-accept disabled and presents read approvals', async () => {
    const { adapter, ports, open, sink } = setup('gateway');
    jest.mocked(ports.profile).mockImplementation(async (_config, resumeId) => ({
      profile: { ...profile, consumer: 'gateway' },
      ...(resumeId ? { resume: identity } : {}),
    }));
    await adapter.startChatSession({ tabId, consumer: 'gateway' });
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ consumer: 'gateway' }), undefined, undefined,
    );
    const pending = sink().request({
      ...identity,
      turnId: 'turn',
      requestId: 1,
      kind: 'command',
      message: 'Run?',
      details: { command: 'Get-Content README.md', cwd: 'C:\\repo' },
    }, new AbortController().signal);
    expect(ports.presentation.present).toHaveBeenCalledTimes(1);
    await adapter.closeSession(id);
    await expect(pending).resolves.toBe('decline');
  });

  it('reopens a gateway resume through the gateway gate', async () => {
    const { adapter, ports, open } = setup('gateway');
    jest.mocked(ports.profile).mockImplementation(async (_config, resumeId) => ({
      profile: { ...profile, consumer: 'gateway' },
      ...(resumeId ? { resume: identity } : {}),
    }));
    await adapter.resumeSession(id, { tabId, consumer: 'gateway' });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenLastCalledWith(
      expect.objectContaining({ consumer: 'gateway' }), identity, undefined,
    );
    await adapter.closeSession(id);
  });

  it.each([
    ['gateway', 'chat'],
    ['chat', 'gateway'],
  ] as const)('rejects %s config with a %s profile', async (consumer, profileConsumer) => {
    const { adapter, ports, open } = setup();
    jest.mocked(ports.profile).mockResolvedValue({
      profile: { ...profile, consumer: profileConsumer },
    });
    await expect(adapter.startChatSession({ tabId, consumer })).rejects.toMatchObject({
      code: 'identity-mismatch',
    });
    expect(open).not.toHaveBeenCalled();
  });
  it('retains native open and cleanup errors without changing the coded message', async () => {
    const { adapter, open, dispose, ports } = setup();
    const error = new Error('secret token');
    const cleanupError = new Error('secret cleanup');
    open.mockRejectedValue(error);
    dispose.mockRejectedValue(cleanupError);
    await expect(adapter.startChatSession({ tabId })).rejects.toMatchObject({
      message: 'Codex chat open: runtime-failed',
      code: 'runtime-failed',
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
    expect(open).toHaveBeenCalledWith(profile, identity, undefined);
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
  it('types a closed context as unavailable while preserving a real permission failure', async () => {
    const h = setup();
    const stream = await h.adapter.startChatSession({ tabId });
    for await (const event of stream) void event;
    h.context.updateNextTurn.mockRejectedValueOnce(new CodexContextStateError('closed'));
    await expect(h.adapter.setSessionPermissionLevel(id, 'auto-edit'))
      .rejects.toMatchObject({ code: 'unavailable', operation: 'permission' });
    h.context.updateNextTurn.mockRejectedValueOnce(new CodexContextStateError('opening'));
    await expect(h.adapter.setSessionPermissionLevel(id, 'auto-edit'))
      .rejects.toMatchObject({ code: 'runtime-failed', operation: 'permission' });
    h.context.updateNextTurn.mockRejectedValueOnce(new Error('Codex context is not ready'));
    await expect(h.adapter.setSessionPermissionLevel(id, 'auto-edit'))
      .rejects.toMatchObject({ code: 'runtime-failed', operation: 'permission' });
    h.context.updateNextTurn.mockRejectedValueOnce(new Error('disk failed'));
    await expect(h.adapter.setSessionPermissionLevel(id, 'auto-edit'))
      .rejects.toMatchObject({ code: 'runtime-failed', operation: 'permission' });
    await h.adapter.dispose();
  });

  it('passes resolved MCP secrets only to runtime.open on start and resume', async () => {
    // Closing the started session disposes its scope, so the resume must open
    // from a fresh container: chain one setup per createScope call, as the
    // losing-context test below does for two opens on one adapter.
    const first = setup();
    const second = setup();
    first.ports.createScope = jest
      .fn()
      .mockImplementationOnce(first.ports.createScope)
      .mockImplementationOnce(second.ports.createScope);
    const secrets = new Map([['ref:auth', 'Bearer sk-SECRET-123']]);
    first.ports.profile = jest.fn(async (_config, resumeId) => ({
      profile,
      ...(resumeId ? { resume: identity } : {}),
      secrets,
    }));
    const start = await first.adapter.startChatSession({
      tabId,
      prompt: 'hello',
    });
    for await (const event of start) void event;
    expect(first.open).toHaveBeenCalledTimes(1);
    expect(first.open).toHaveBeenCalledWith(profile, undefined, secrets);
    await first.adapter.reset();
    const resumed = await first.adapter.resumeSession(id, {
      prompt: 'continue',
    });
    for await (const event of resumed) void event;
    expect(first.open).toHaveBeenCalledTimes(1);
    expect(second.open).toHaveBeenCalledTimes(1);
    expect(second.open).toHaveBeenCalledWith(profile, identity, secrets);
    // The tracked session and the metadata save never see the secrets map:
    // a turn through the session carries only its input, a save only identity.
    await first.adapter.sendMessageToSession(id, 'follow-up');
    await waitFor(() => first.adapter.canSendFollowUp(id));
    expect(second.context.startTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: 'follow-up', attachments: [] }),
    );
    expect(jest.mocked(first.ports.metadata.save).mock.calls).toEqual([
      [id, identity, undefined],
      [id, identity, undefined],
    ]);
    await first.adapter.reset();
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
  it('retires the session after a missing terminal error', async () => {
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
    const output: FlatStreamEventUnion[] = [];
    await expect(
      (async () => {
        for await (const event of stream) output.push(event);
      })(),
    ).rejects.toMatchObject({ code: 'runtime-failed' });
    expect(output.filter((event) => event.eventType === 'text_delta'))
      .toEqual([
        expect.objectContaining({ delta: 'hello' }),
        expect.objectContaining({ delta: 'Codex reported a runtime error.' }),
      ]);
    expect(output.at(-1)).toMatchObject({ eventType: 'turn_state', phase: 'failed' });
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(adapter.isSessionActive(id)).toBe(false);
    await expect(adapter.interruptSession(id)).resolves.toBeUndefined();
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
    // A stream exit never ends the native thread; the explicit end does.
    expect(await adapter.endSessionIfTokenMatches(id, token)).toBe(false);
    expect(adapter.isSessionActive(id)).toBe(true);
    await adapter.reset();
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
  it('keeps the active turn permission level in the sink until the next turn', async () => {
    const { adapter, ports, sink, context } = setup();
    await adapter.startChatSession({ tabId });
    const request = {
      ...identity,
      turnId: 'turn',
      requestId: 31,
      kind: 'command' as const,
      message: 'Read?',
      details: { command: 'Get-Content README.md', cwd: 'C:\\repo' },
    };
    await expect(sink().request(request, new AbortController().signal))
      .resolves.toBe('accept');
    expect(ports.presentation.present).not.toHaveBeenCalled();
    // A mid-turn change resolves and is stored for later. The sink reads the
    // turn snapshot, which stays 'ask' until the runtime advances it.
    await expect(adapter.setSessionPermissionLevel(id, 'plan')).resolves.toBeUndefined();
    expect(context.updateNextTurn).toHaveBeenCalledWith({
      permissionLevel: 'plan',
    });
    expect(context.turnPermissionLevel).toBe('ask');
    await expect(
      sink().request(
        { ...request, requestId: 32 },
        new AbortController().signal,
      ),
    ).resolves.toBe('accept');
    expect(ports.presentation.present).not.toHaveBeenCalled();
    Object.defineProperty(context, 'turnPermissionLevel', { value: 'plan' });
    const pending = sink().request(
      { ...request, requestId: 33 },
      new AbortController().signal,
    );
    expect(ports.presentation.present).toHaveBeenCalledTimes(1);
    await adapter.reset();
    await expect(pending).resolves.toBe('decline');
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
    await expect(pending).rejects.toBeInstanceOf(CodexChatAdapterError);
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(ports.logger.error).not.toHaveBeenCalled();
    expect(ports.metadata.save).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledTimes(1);
  });
  it('accepts renderer-shaped live resume options and sends the prompt without reapplying settings', async () => {
    const { adapter, ports, context } = setup();
    const stream = await adapter.startChatSession({ tabId });
    for await (const event of stream) void event;
    const config = {
      projectPath: '/workspace', model: 'other', mcpServerRunning: true,
      enhancedPromptsContent: 'instructions', tabId, effort: 'high' as const,
      workflowsDisabled: false, prompt: 'second send', ptahUiFence: true,
      thinking: { type: 'enabled' as const, budgetTokens: 1024 },
      outputStyleName: 'concise', systemPrompt: 'session instructions',
      permissionLevel: 'yolo' as const,
    };
    const resumed = await adapter.resumeSession(id, config);
    for await (const event of resumed) void event;
    expect(ports.checkOptions).toHaveBeenCalledWith(config);
    expect(context.startTurn).toHaveBeenCalledTimes(2);
    expect(context.startTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: 'second send' }),
    );
    expect(ports.profile).toHaveBeenCalledTimes(1);
    expect(context.updateNextTurn).not.toHaveBeenCalled();
    expect(ports.logger.info).toHaveBeenCalledTimes(1);
    expect(ports.logger.info).toHaveBeenCalledWith(
      'Codex chat: changed session options are not applied to the open thread.',
      {
        code: 'codex-active-resume-options-not-applied',
        keys: ['model', 'effort', 'permissionLevel'],
      },
    );
    await adapter.interruptSession(id);
  });
  it.each([false, true])('does not log unchanged or omitted active resume settings (updated=%s)', async (updated) => {
    const { adapter, ports, context } = setup();
    const stream = await adapter.startChatSession({ tabId });
    for await (const event of stream) void event;
    if (updated) {
      await adapter.setSessionModel(id, 'next-model');
      await adapter.setSessionEffort(id, 'high');
      await adapter.setSessionPermissionLevel(id, 'yolo');
    }
    const config = updated
      ? { model: 'next-model', effort: 'high' as const, permissionLevel: 'yolo' as const }
      : { model: profile.model, permissionLevel: profile.permissionLevel };
    for (const options of [config, {}]) {
      const resumed = await adapter.resumeSession(id, { ...options, prompt: 'continue' });
      for await (const event of resumed) void event;
    }
    expect(ports.logger.info).not.toHaveBeenCalled();
    expect(context.startTurn).toHaveBeenCalledTimes(3);
    await adapter.interruptSession(id);
  });
  it.each([
    { key: 'temperature', options: { temperature: 0.5 } },
    { key: 'mcpToolProfile', options: { mcpToolProfile: 'apps' as const } },
  ])('propagates the host coded option error for $key before a live turn starts', async ({ key, options }) => {
    const { adapter, ports, context } = setup();
    const stream = await adapter.startChatSession({ tabId });
    for await (const event of stream) void event;
    // The host owns the concrete error class; this port fake checks identity preservation.
    const error = Object.assign(new Error(`Unsupported option: ${key}`), {
      code: 'unsupported-option', key,
    });
    jest.mocked(ports.checkOptions).mockImplementation(() => { throw error; });
    const config = { prompt: 'rejected', ...options };
    await expect(adapter.resumeSession(id, config)).rejects.toBe(error);
    expect(ports.checkOptions).toHaveBeenCalledWith(config);
    expect(context.startTurn).toHaveBeenCalledTimes(1);
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
    const { adapter, context, ports } = setup();
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
    const release = deferred<void>();
    context.events.mockImplementation(() => (async function* () {
      await release.promise;
      yield terminal;
    })());
    let finishPublish: () => void = () => undefined;
    const published = new Promise<void>((resolve) => {
      finishPublish = resolve;
    });
    // Capture the implementation, not the mock: mockImplementation replaces
    // what the same jest.fn would call, so calling the mock would recurse.
    const originalPublish = jest.mocked(ports.publish).getMockImplementation();
    jest.mocked(ports.publish).mockImplementation(async (...args) => {
      try {
        await originalPublish?.(...args);
      } finally {
        finishPublish();
      }
    });
    try {
      await expect(
        adapter.sendMessageToSession(id, 'next'),
      ).resolves.toBeUndefined();
      await expect(adapter.interruptSession(id)).rejects.toMatchObject({
        code: 'runtime-failed',
      });
      expect(adapter.isSessionActive(id)).toBe(false);
    } finally {
      release.resolve();
      await published;
    }
  });
  it('keeps the thread when a matching token arrives after a completed turn stream', async () => {
    const { adapter, context, dispose, lifecycle } = setup();
    const stream = await adapter.startChatSession({ tabId });
    for await (const event of stream) void event;
    await adapter.sendMessageToSession(id, 'follow-up');
    await waitFor(() => adapter.canSendFollowUp(id));
    const token = adapter.getSessionToken(id);
    if (!token) throw new Error('Expected a token for the active session');

    expect(await adapter.endSessionIfTokenMatches(id, token)).toBe(false);
    expect(adapter.isSessionActive(id)).toBe(true);
    expect(adapter.canSendFollowUp(id)).toBe(true);
    // The stable token native-session-controls compares stays the same.
    expect(adapter.getSessionToken(id)).toBe(token);
    expect(context.close).not.toHaveBeenCalled();
    expect(lifecycle.closed).not.toHaveBeenCalled();

    await adapter.sendMessageToSession(id, 'third');
    await waitFor(() => adapter.canSendFollowUp(id));
    expect(context.startTurn).toHaveBeenCalledTimes(3);

    adapter.endSession(id);
    await waitFor(() => dispose.mock.calls.length > 0);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(lifecycle.closed).toHaveBeenCalledWith(id);
    expect(adapter.isSessionActive(id)).toBe(false);
  });
  it('leaves a mid-turn detach to the turn stream, which closes without a terminal', async () => {
    const { adapter, context } = setup();
    let finish: () => void = () => undefined;
    const ended = new Promise<void>((resolve) => {
      finish = resolve;
    });
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
        await ended;
      })(),
    );
    const stream = await adapter.startChatSession({ tabId });
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.(undefined);
    const token = adapter.getSessionToken(id);
    if (!token) throw new Error('Expected a token for the active session');

    expect(await adapter.endSessionIfTokenMatches(id, token)).toBe(false);
    await waitFor(() => context.interrupt.mock.calls.length > 0);
    expect(context.interrupt).toHaveBeenCalledWith('turn');
    expect(adapter.canSendFollowUp(id)).toBe(false);
    expect(context.close).not.toHaveBeenCalled();

    finish();
    await waitFor(() => context.close.mock.calls.length > 0);
    expect(adapter.isSessionActive(id)).toBe(false);
  });
});

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for the condition');
}

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
it('settles and retires a session after a start-turn rejection', async () => {
  const { adapter, context, ports } = setup();
  const error = new Error('temporary');
  context.startTurn.mockRejectedValueOnce(error);
  const stream = await adapter.startChatSession({ tabId });
  const iterator = stream[Symbol.asyncIterator]();
  expect((await iterator.next()).value).toMatchObject({
    eventType: 'message_start', role: 'assistant', source: 'complete',
  });
  expect((await iterator.next()).value).toMatchObject({
    eventType: 'text_delta', delta: 'Codex reported a runtime error.',
  });
  expect((await iterator.next()).value).toMatchObject({
    eventType: 'turn_state', phase: 'failed', sessionId: id,
  });
  await expect(iterator.next()).rejects.toMatchObject({
    code: 'runtime-failed',
    message: 'Codex chat turn: runtime-failed',
    cause: expect.objectContaining({ cause: error }),
    webviewReported: true,
  });
  expect(ports.logger.error).toHaveBeenCalledWith(
    '[CodexChatAdapter] runtime-failed: turn.',
    error,
  );
  expect(context.close).toHaveBeenCalledTimes(1);
  expect(adapter.isSessionActive(id)).toBe(false);
  await expect(adapter.sendMessageToSession(id, 'retry'))
    .rejects.toMatchObject({ code: 'unavailable' });
  await expect(adapter.interruptSession(id)).resolves.toBeUndefined();
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
  await adapter.reset();
  await expect(adapter.listSessionModels(id)).rejects.toMatchObject({
    code: 'unavailable',
  });
});
it.each([7, 0, undefined])(
  'reports only last-request compaction tokens (%s)',
  async (lastRequestTotalTokens) => {
    const { adapter, context, ports } = setup();
    const published: FlatStreamEventUnion[] = [];
    ports.publish = jest.fn(async (_id, stream) => {
      for await (const event of stream) published.push(event);
    });
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
    if (lastRequestTotalTokens === undefined) {
      expect(callback).not.toHaveBeenCalled();
      expect(ports.logger.debug).toHaveBeenCalledWith(
        '[CodexChatAdapter] Compaction start skipped: native last-request usage unavailable.',
      );
    } else {
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith({
        sessionId: id,
        trigger: 'manual',
        timestamp: expect.any(Number),
        preTokens: lastRequestTotalTokens,
      });
    }
    expect(published).toEqual([
      expect.objectContaining({
        eventType: 'compaction_complete',
        trigger: 'manual',
      }),
    ]);
    await adapter.interruptSession(id);
  },
);

it.each([
  { phase: 'completed', preTokens: 7 },
  { phase: 'completed', preTokens: 0 },
  { phase: 'completed', preTokens: undefined },
  { phase: 'failed', preTokens: 37 },
  { phase: 'stream-ended', preTokens: 37 },
] as const)(
  'deduplicates automatic starts with native usage and forwards $phase ($preTokens)',
  async ({ phase, preTokens }) => {
    const { adapter, context, callbacks, ports } = setup();
    const debug = jest.spyOn(ports.logger, 'debug');
    const start = jest.fn();
    adapter.setCompactionStartCallback(start);
    context.events.mockImplementation(() =>
      (async function* (): AsyncGenerator<CodexRuntimeEvent> {
        const base = { ...identity, turnId: 'turn' };
        yield {
          ...base,
          sequence: 1,
          type: 'usage',
          usage: { lastRequestTotalTokens: preTokens },
        };
        yield { ...base, sequence: 2, type: 'compaction', phase: 'started' };
        yield { ...base, sequence: 3, type: 'compaction', phase: 'started' };
        if (phase !== 'stream-ended') {
          yield { ...base, sequence: 4, type: 'compaction', phase };
          yield { ...terminal, sequence: 5 };
        }
      })(),
    );
    const stream = await adapter.startChatSession({ tabId });
    const consume = async () => {
      for await (const event of stream) void event;
    };
    if (phase === 'stream-ended') await expect(consume()).rejects.toThrow();
    else await consume();
    if (preTokens === undefined) {
      expect(start).not.toHaveBeenCalled();
      expect(
        debug.mock.calls.filter(
          ([message]) =>
            message ===
            '[CodexChatAdapter] Compaction start skipped: native last-request usage unavailable.',
        ),
      ).toHaveLength(1);
    } else {
      expect(start).toHaveBeenCalledTimes(1);
      expect(start).toHaveBeenCalledWith({
        sessionId: id,
        timestamp: expect.any(Number),
        trigger: 'auto',
        preTokens,
      });
    }
    expect(callbacks.compaction).toHaveBeenCalledTimes(1);
    expect(callbacks.compaction).toHaveBeenCalledWith(
      phase === 'stream-ended' ? 'failed' : phase,
    );
    await adapter.interruptSession(id);
  },
);

it.each([false, true])(
  'coalesces manual compaction and publishes a boundary only on success (failure: %s)',
  async (fails) => {
    const { adapter, context, ports, callbacks } = setup();
    const start = jest.fn();
    const published: FlatStreamEventUnion[] = [];
    adapter.setCompactionStartCallback(start);
    ports.publish = jest.fn(async (_id, stream) => {
      for await (const event of stream) published.push(event);
    });
    await adapter.startChatSession({ tabId });
    const completion = deferred<void>();
    context.compact.mockImplementation(async () => {
      await completion.promise;
      if (fails) throw new Error('Native compaction failed');
    });
    const first = adapter.executeSlashCommand(id, '/compact', {});
    const second = adapter.executeSlashCommand(id, '/compact', {});
    const outcome = Promise.all([first, second]);
    completion.resolve();
    if (fails)
      await expect(outcome).rejects.toMatchObject({ code: 'runtime-failed' });
    else await outcome;
    expect(start).not.toHaveBeenCalled();
    expect(context.compact).toHaveBeenCalledTimes(1);
    if (fails) {
      expect(published).toEqual([]);
      expect(callbacks.error).toHaveBeenCalledTimes(1);
      expect(callbacks.error).toHaveBeenCalledWith(
        'Codex context compaction failed.',
      );
    } else {
      expect(callbacks.error).not.toHaveBeenCalled();
      expect(published).toEqual([
        expect.objectContaining({
          eventType: 'compaction_complete',
          trigger: 'manual',
        }),
      ]);
    }
    await adapter.interruptSession(id);
  },
);

it('narrows adapter errors by instance, not by a lookalike code or name', () => {
  const error: unknown = new CodexChatAdapterError('busy', 'turn');
  expect(isCodexChatAdapterError(error)).toBe(true);
  if (!isCodexChatAdapterError(error)) throw new Error('Expected adapter error');
  const code: CodexChatAdapterErrorCode = error.code;
  expect(code).toBe('busy');
  for (const value of [
    null,
    undefined,
    'busy',
    new Error('busy'),
    { name: 'CodexChatAdapterError', code: 'busy', operation: 'turn' },
  ])
    expect(isCodexChatAdapterError(value)).toBe(false);
});

it('does not announce manual compaction when the native context has an active turn', async () => {
  const { adapter, context } = setup();
  const start = jest.fn();
  adapter.setCompactionStartCallback(start);
  const stream = await adapter.startChatSession({ tabId });
  const iterator = stream[Symbol.asyncIterator]();
  await iterator.next();
  await expect(adapter.executeSlashCommand(id, '/compact', {})).rejects.toMatchObject({
    code: 'busy',
    operation: 'compact',
  });
  expect(start).not.toHaveBeenCalled();
  expect(context.compact).not.toHaveBeenCalled();
  while (!(await iterator.next()).done) {
    /* Drain the native turn. */
  }
  await adapter.interruptSession(id);
});

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
  await adapter.reset();
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
  await first.adapter.reset();
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
    await expect(opening).rejects.toBeInstanceOf(CodexChatAdapterError);
    expect(ports.logger.error).not.toHaveBeenCalled();
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

it('keeps an idle native thread after Stop', async () => {
  const { adapter, context, open } = setup();
  const stream = await adapter.startChatSession({ tabId });
  for await (const event of stream) void event;
  await adapter.interruptSession(id);
  expect(context.interrupt).not.toHaveBeenCalled();
  expect(context.close).not.toHaveBeenCalled();
  expect(adapter.canSendFollowUp(id)).toBe(true);
  await adapter.sendMessageToSession(id, 'still here');
  expect(open).toHaveBeenCalledTimes(1);
});

it('cancels an approval on Stop and keeps the thread for a send and compact', async () => {
  const { adapter, context, sink, ports, open } = setup();
  const stopped = deferred<void>();
  context.events.mockImplementation(() => (async function* () {
    yield { ...identity, turnId: 'turn', sequence: 1, type: 'textDelta' as const, itemId: 'item', delta: 'hello' };
    await stopped.promise;
    yield terminal;
  })());
  context.interrupt.mockImplementation(async () => {
    stopped.resolve();
    return true;
  });
  const stream = await adapter.startChatSession({ tabId });
  const iterator = stream[Symbol.asyncIterator]();
  await iterator.next();
  const request = { ...identity, turnId: 'turn', requestId: 7, kind: 'command' as const, message: 'Run?', details: {} };
  const approval = sink().request(request, new AbortController().signal);
  await adapter.interruptSession(id);
  await expect(approval).resolves.toBe('cancel');
  expect(ports.presentation.cancelPrompt).toHaveBeenCalledTimes(1);
  await expect((async () => { while (!(await iterator.next()).done) { /* Drain. */ } })()).rejects.toMatchObject({ code: 'cancelled' });
  expect(context.close).not.toHaveBeenCalled();
  expect(adapter.canSendFollowUp(id)).toBe(true);
  context.events.mockImplementation(() => (async function* () { yield terminal; })());
  await adapter.sendMessageToSession(id, 'next');
  await waitFor(() => adapter.canSendFollowUp(id));
  await adapter.executeSlashCommand(id, '/compact', {});
  expect(context.compact).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledTimes(1);
});

it('preserves the runtime refusal when a stored thread changes execution profile', async () => {
  const { adapter, open } = setup();
  const refusal = new CodexResumeProfileChangedError();
  open.mockRejectedValue(refusal);
  await expect(adapter.resumeSession(id, { tabId })).rejects.toMatchObject({
    code: 'resume-profile-changed',
    cause: refusal,
  });
});

it.each(['rejected', 'missing-terminal'] as const)(
  'closes after a %s interrupt and resumes the stored thread',
  async (mode) => {
    const first = setup();
    const second = setup();
    const { adapter, context, open } = first;
    first.ports.createScope = jest.fn()
      .mockImplementationOnce(first.ports.createScope)
      .mockImplementationOnce(second.ports.createScope);
    const stopped = deferred<void>();
    context.events.mockImplementation(() => (async function* () {
      yield { ...identity, turnId: 'turn', sequence: 1, type: 'textDelta' as const, itemId: 'item', delta: 'hello' };
      await stopped.promise;
    })());
    context.interrupt.mockImplementation(async () => {
      stopped.resolve();
      if (mode === 'rejected') throw new Error('interrupt failed');
      return true;
    });
    const stream = await adapter.startChatSession({ tabId });
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();
    if (mode === 'rejected')
      await expect(adapter.interruptSession(id)).rejects.toMatchObject({ code: 'runtime-failed' });
    else await adapter.interruptSession(id);
    await expect((async () => { while (!(await iterator.next()).done) { /* Drain. */ } })()).rejects.toMatchObject({ code: 'cancelled' });
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(adapter.isSessionActive(id)).toBe(false);
    const resumed = await adapter.resumeSession(id, { prompt: 'next' });
    for await (const event of resumed) void event;
    expect(open).toHaveBeenCalledTimes(1);
    expect(second.open).toHaveBeenCalledWith(profile, identity, undefined);
    await adapter.executeSlashCommand(id, '/compact', {});
    expect(second.context.compact).toHaveBeenCalledTimes(1);
  },
);

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
