import 'reflect-metadata';

// `GatewayChatBridge` now imports `@ptah-extension/agent-generation` (for the
// `AGENT_GENERATION_TOKENS.ENHANCED_PROMPTS_SERVICE` injection token), whose
// barrel transitively pulls `@ptah-extension/workspace-intelligence`. That
// lib's TreeSitter module evaluates `import.meta.url` at top level — a construct
// ts-jest's CJS transform cannot parse. Stub it (mirrors the rpc-handlers chat
// session specs).
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: {},
  Framework: {},
  MonorepoType: {},
  FileType: {},
  TreeSitterParserService: class TreeSitterParserServiceStub {},
  AstAnalysisService: class AstAnalysisServiceStub {},
  DependencyGraphService: class DependencyGraphServiceStub {},
  WorkspaceAnalyzerService: class WorkspaceAnalyzerServiceStub {},
  ContextService: class ContextServiceStub {},
  ContextOrchestrationService: class ContextOrchestrationServiceStub {},
  WorkspaceService: class WorkspaceServiceStub {},
  TokenCounterService: class TokenCounterServiceStub {},
  FileSystemService: class FileSystemServiceStub {},
  FileSystemError: class FileSystemErrorStub extends Error {},
  ProjectDetectorService: class ProjectDetectorServiceStub {},
  FrameworkDetectorService: class FrameworkDetectorServiceStub {},
  DependencyAnalyzerService: class DependencyAnalyzerServiceStub {},
  MonorepoDetectorService: class MonorepoDetectorServiceStub {},
  PatternMatcherService: class PatternMatcherServiceStub {},
  IgnorePatternResolverService: class IgnorePatternResolverServiceStub {},
  WorkspaceIndexerService: class WorkspaceIndexerServiceStub {},
  FileTypeClassifierService: class FileTypeClassifierServiceStub {},
  FileRelevanceScorerService: class FileRelevanceScorerServiceStub {},
  ContextSizeOptimizerService: class ContextSizeOptimizerServiceStub {},
  ContextEnrichmentService: class ContextEnrichmentServiceStub {},
}));

// The bridge fail-closed path probes the resolved workspace root on disk via
// `fs.access`. Default the probe to "exists" so turn specs can keep using
// synthetic roots like '/ws/proj'; the missing-on-disk spec flips it per call.
jest.mock('node:fs/promises', () => {
  const actual =
    jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    access: jest.fn(async () => undefined),
  };
});

import { EventEmitter } from 'node:events';
import { access } from 'node:fs/promises';
import { GatewayChatBridge } from './gateway-chat-bridge';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  BindingId,
  ConversationKey,
  ConversationTurnTracker,
  StreamCoalescer,
  type ConversationStore,
  type FlushPayload,
  type GatewayBinding,
  type GatewayConversation,
  type GatewayConversationId,
  type GatewayInboundEvent,
  type GatewayService,
  type GatewayTurnState,
  type InterruptedInboundConversation,
  type OutboundRoute,
} from '@ptah-extension/messaging-gateway';

const accessMock = access as jest.MockedFunction<typeof access>;
import type {
  FlatStreamEventUnion,
  IAgentAdapter,
} from '@ptah-extension/shared';
import type { PermissionPromptLifecycleEvent } from '@ptah-extension/agent-sdk';

function createLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

class FakeGateway extends EventEmitter {
  appendOutboundChunk = jest.fn<void, [OutboundRoute, string]>();
  drainOutbound = jest.fn<Promise<void>, [ConversationKey]>(async () => {
    /* no-op */
  });
  completeOutboundTurn = jest.fn<Promise<void>, [ConversationKey]>(async () => {
    /* no-op */
  });
  sendNotice = jest.fn<Promise<void>, [OutboundRoute, string]>(async () => {
    /* no-op */
  });
  sendTyping = jest.fn<Promise<void>, [OutboundRoute]>(async () => {
    /* no-op */
  });
  discardOutbound = jest.fn<void, [ConversationKey]>();
  recordTurnOutcome = jest.fn<
    void,
    [string, { ok: true } | { ok: false; reason: string }]
  >();
  markInboundTurnState = jest.fn<void, [string, GatewayTurnState]>();
  claimInterruptedInboundTurns = jest.fn<InterruptedInboundConversation[], []>(
    () => [],
  );
}

/**
 * A gateway whose outbound primitives are backed by the REAL
 * {@link StreamCoalescer} the production `OutboundDeliveryService` uses, in the
 * same `'complete'` mode, with the flush recorded instead of sent.
 *
 * The plain {@link FakeGateway} above cannot see the stranded-buffer class of
 * bug at all: its `drainOutbound` is a no-op mock, so a turn that drains
 * without discarding looks identical to one that cleans up. The coalescer's
 * `body` is cumulative per conversation key and is cleared ONLY by `discard()`
 * — that is the entire mechanism, so a regression test has to run it.
 */
class DeliveringGateway extends FakeGateway {
  /** Bodies handed to the platform, in order — one entry per flush. */
  readonly delivered: string[] = [];

  private readonly coalescer = new StreamCoalescer(
    (payload: FlushPayload) => {
      this.delivered.push(payload.body);
    },
    { mode: 'complete' },
  );

  override appendOutboundChunk = jest.fn<void, [OutboundRoute, string]>(
    (route, chunk) => {
      this.coalescer.append(route, chunk);
    },
  );

  /** Mirrors `OutboundDeliveryService.drain` — flushes, does NOT reset. */
  override drainOutbound = jest.fn<Promise<void>, [ConversationKey]>(
    async (key) => {
      await this.coalescer.drain(key);
    },
  );

  /** Mirrors `OutboundDeliveryService.discard`. */
  override discardOutbound = jest.fn<void, [ConversationKey]>((key) => {
    this.coalescer.discard(key);
  });

  /** Mirrors `OutboundDeliveryService.completeTurn` — drain, then reset. */
  override completeOutboundTurn = jest.fn<Promise<void>, [ConversationKey]>(
    async (key) => {
      try {
        await this.coalescer.drain(key);
      } finally {
        this.coalescer.discard(key);
      }
    },
  );
}

/** Captures the bridge's prompt-lifecycle listener so specs can fire events. */
class FakePermissionHandler {
  listener: ((e: PermissionPromptLifecycleEvent) => void) | null = null;
  unsubscribed = 0;
  onPromptLifecycle = jest.fn(
    (l: (e: PermissionPromptLifecycleEvent) => void): (() => void) => {
      this.listener = l;
      return () => {
        this.unsubscribed += 1;
        this.listener = null;
      };
    },
  );
  fire(e: PermissionPromptLifecycleEvent): void {
    this.listener?.(e);
  }
}

function makeBinding(
  overrides: Partial<GatewayBinding> & {
    id?: string;
    platform?: GatewayBinding['platform'];
    externalChatId?: string;
  } = {},
): GatewayBinding {
  return {
    id: BindingId.create(overrides.id ?? 'binding-1'),
    platform: overrides.platform ?? 'telegram',
    externalChatId: overrides.externalChatId ?? 'chat-1',
    allowListId: null,
    displayName: null,
    approvalStatus: 'approved',
    ptahSessionId: overrides.ptahSessionId ?? null,
    workspaceRoot:
      overrides.workspaceRoot === undefined ? null : overrides.workspaceRoot,
    pairingCode: null,
    createdAt: 1,
    approvedAt: 1,
    lastActiveAt: 1,
  };
}

function makeConversation(
  binding: GatewayBinding,
  overrides: Partial<Omit<GatewayConversation, 'id'>> & { id?: string } = {},
): GatewayConversation {
  return {
    id: (overrides.id ?? 'conv-1') as GatewayConversationId,
    bindingId: binding.id,
    externalConversationId: overrides.externalConversationId ?? 'default',
    ptahSessionId: overrides.ptahSessionId ?? null,
    workspaceRoot: overrides.workspaceRoot ?? null,
    createdAt: 1,
    lastActiveAt: 1,
  };
}

function makeEvent(
  binding: GatewayBinding,
  body: string,
  opts: {
    conversation?: GatewayConversation;
    conversationId?: string;
    messageId?: string;
  } = {},
): GatewayInboundEvent {
  const conversation = opts.conversation ?? makeConversation(binding);
  return {
    binding,
    conversation,
    messageId: opts.messageId ?? 'gwmsg-1',
    message: {
      platform: binding.platform,
      externalChatId: binding.externalChatId,
      externalMsgId: 'm-1',
      body,
      conversationId: opts.conversationId,
      conversationKey: ConversationKey.for(
        binding.platform,
        binding.externalChatId,
        opts.conversationId,
      ),
    },
  } as GatewayInboundEvent;
}

const SDK_UUID = '11111111-2222-4333-8444-555555555555';
const SDK_UUID_B = '99999999-8888-4777-8666-555555555555';

function textDelta(sessionId: string, delta: string): FlatStreamEventUnion {
  return {
    id: `t-${delta}`,
    eventType: 'text_delta',
    timestamp: 1,
    sessionId,
    messageId: 'msg-1',
    delta,
    blockIndex: 0,
  } as FlatStreamEventUnion;
}

function messageComplete(sessionId: string): FlatStreamEventUnion {
  return {
    id: 'c-1',
    eventType: 'message_complete',
    timestamp: 2,
    sessionId,
    messageId: 'msg-1',
  } as FlatStreamEventUnion;
}

async function scriptedStream(
  events: FlatStreamEventUnion[],
): Promise<AsyncIterable<FlatStreamEventUnion>> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) {
        yield e;
      }
    },
  };
}

function gatedStream(
  gate: Promise<void>,
  events: FlatStreamEventUnion[],
): AsyncIterable<FlatStreamEventUnion> {
  return {
    async *[Symbol.asyncIterator]() {
      await gate;
      for (const e of events) {
        yield e;
      }
    },
  };
}

async function flushUntil(
  predicate: () => boolean,
  attempts = 50,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return;
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

interface Harness {
  bridge: GatewayChatBridge;
  gateway: FakeGateway;
  conversations: jest.Mocked<Pick<ConversationStore, 'setPtahSessionId'>>;
  adapter: jest.Mocked<
    Pick<
      IAgentAdapter,
      | 'startChatSession'
      | 'resumeSession'
      | 'isSessionActive'
      | 'setSessionPermissionLevel'
      | 'endSession'
    >
  >;
  workspace: jest.Mocked<
    Pick<
      IWorkspaceProvider,
      'getWorkspaceRoot' | 'getWorkspaceFolders' | 'getConfiguration'
    >
  >;
  turnTracker: ConversationTurnTracker;
  selectedModelGet: jest.Mock<string, []>;
  codeExecutionMcp: {
    getPort: jest.Mock;
    ensureRegisteredForSubagents: jest.Mock;
  };
  enhancedPromptsService: { getEnhancedPromptContent: jest.Mock };
  pluginLoader: {
    getWorkspacePluginConfig: jest.Mock;
    resolvePluginPaths: jest.Mock;
  };
  permissionHandler: FakePermissionHandler;
}

function setup(options?: {
  workspaceRoot?: string | null;
  workspaceFolders?: string[];
  selectedModel?: string;
  mcpPort?: number | null;
  enhancedPromptsContent?: string | null;
  enabledPluginIds?: string[];
  resolvedPluginPaths?: string[];
  /**
   * Raw `ptah.gateway.permissionLevel` setting value the workspace mock returns.
   * `undefined` means "unset" — `getConfiguration` returns the caller's default,
   * exercising the safe fallback. A non-enum string exercises the reject path.
   */
  gatewayPermissionLevel?: string;
  /**
   * Swap in a gateway whose outbound calls have real behaviour (see
   * {@link DeliveringGateway}) instead of the default no-op mocks.
   */
  gateway?: FakeGateway;
}): Harness {
  const gateway = options?.gateway ?? new FakeGateway();
  const conversations = {
    setPtahSessionId: jest.fn(),
  } as unknown as Harness['conversations'];
  const adapter = {
    startChatSession: jest.fn(),
    resumeSession: jest.fn(),
    isSessionActive: jest.fn().mockReturnValue(false),
    setSessionPermissionLevel: jest.fn().mockResolvedValue(undefined),
    endSession: jest.fn(),
  } as unknown as Harness['adapter'];
  const workspace = {
    // The IWorkspaceProvider port returns `string | undefined` (never null);
    // a `workspaceRoot: null` option means "no workspace open".
    getWorkspaceRoot: jest
      .fn()
      .mockReturnValue(
        options?.workspaceRoot === undefined
          ? '/ws/global'
          : (options.workspaceRoot ?? undefined),
      ),
    getWorkspaceFolders: jest
      .fn()
      .mockReturnValue(options?.workspaceFolders ?? []),
    // Return the configured gateway permission level for its key; every other
    // key resolves to the caller-supplied default (mirrors the real provider).
    getConfiguration: jest.fn(
      (_section: string, key: string, defaultValue?: unknown) =>
        key === 'gateway.permissionLevel'
          ? (options?.gatewayPermissionLevel ?? defaultValue)
          : defaultValue,
    ),
  } as unknown as Harness['workspace'];
  const turnTracker = new ConversationTurnTracker();
  const selectedModelGet = jest
    .fn<string, []>()
    .mockReturnValue(options?.selectedModel ?? '');
  const modelSettings = {
    selectedModel: { get: selectedModelGet },
  };

  const codeExecutionMcp = {
    getPort: jest.fn().mockReturnValue(options?.mcpPort ?? null),
    ensureRegisteredForSubagents: jest.fn(),
  };
  const enhancedPromptsService = {
    getEnhancedPromptContent: jest
      .fn()
      .mockResolvedValue(options?.enhancedPromptsContent ?? null),
  };
  const pluginLoader = {
    getWorkspacePluginConfig: jest
      .fn()
      .mockReturnValue({ enabledPluginIds: options?.enabledPluginIds ?? [] }),
    resolvePluginPaths: jest
      .fn()
      .mockReturnValue(options?.resolvedPluginPaths ?? []),
  };
  const permissionHandler = new FakePermissionHandler();

  const ctorArgs = [
    createLogger(),
    gateway as unknown as GatewayService,
    conversations as unknown as ConversationStore,
    adapter as unknown as IAgentAdapter,
    workspace as unknown as IWorkspaceProvider,
    modelSettings,
    codeExecutionMcp,
    enhancedPromptsService,
    pluginLoader,
    turnTracker,
    permissionHandler,
  ] as unknown as ConstructorParameters<typeof GatewayChatBridge>;
  const bridge = new GatewayChatBridge(...ctorArgs);
  return {
    bridge,
    gateway,
    conversations,
    adapter,
    workspace,
    turnTracker,
    selectedModelGet,
    codeExecutionMcp,
    enhancedPromptsService,
    pluginLoader,
    permissionHandler,
  };
}

describe('GatewayChatBridge', () => {
  it('starts a new session keyed on the conversation row id (gw-<conversationId>)', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const conversation = makeConversation(binding, { id: 'conv-42' });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'hi'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit(
      'inbound',
      makeEvent(binding, 'hello agent', { conversation }),
    );
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    expect(h.adapter.startChatSession).toHaveBeenCalledTimes(1);
    const config = h.adapter.startChatSession.mock.calls[0][0];
    expect(config.prompt).toBe('hello agent');
    expect(config.tabId).toBe('gw-conv-42');
    expect(config.projectPath).toBe('/ws/proj');
    expect(config.workspaceId).toBe('/ws/proj');
  });

  it('appends a route-bearing chunk per text_delta and flushes once at end of turn', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'foo'),
        textDelta(SDK_UUID, 'bar'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    const key = ConversationKey.for(binding.platform, binding.externalChatId);
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    const expectedRoute = {
      conversationKey: key,
      platform: binding.platform,
      externalChatId: binding.externalChatId,
    };
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledWith(
      expectedRoute,
      'foo',
    );
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledWith(
      expectedRoute,
      'bar',
    );
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledTimes(2);
    // No mid-turn drain on the agent-reply path — the single flush is the
    // end-of-turn seal via completeOutboundTurn.
    expect(h.gateway.drainOutbound).not.toHaveBeenCalled();
    expect(h.gateway.completeOutboundTurn).toHaveBeenCalledTimes(1);
    expect(h.gateway.completeOutboundTurn).toHaveBeenCalledWith(key);
    // A clean turn reports ok so a previous turn error clears in the UI.
    expect(h.gateway.recordTurnOutcome).toHaveBeenCalledWith(binding.platform, {
      ok: true,
    });
  });

  it('tells the user when the platform rejects the finished reply at seal (TASK_2026_271 #2)', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'foo'),
        messageComplete(SDK_UUID),
      ]),
    );
    h.gateway.completeOutboundTurn.mockRejectedValueOnce(
      new Error(
        'Outbound delivery to discord failed on page 1/1: Missing Permissions',
      ),
    );

    h.bridge.start();
    const key = ConversationKey.for(binding.platform, binding.externalChatId);
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length > 0);

    // A fresh error reply goes out on the same route via the mid-turn primitive
    // (the seal already reset the buffer), instead of vanishing into a log.
    const errorAppend = h.gateway.appendOutboundChunk.mock.calls.find(
      ([, text]) => text.includes('could not deliver the reply'),
    );
    expect(errorAppend?.[0].conversationKey).toBe(key);
    expect(h.gateway.drainOutbound).toHaveBeenCalledWith(key);
    await flushUntil(() => h.gateway.recordTurnOutcome.mock.calls.length > 0);
    expect(h.gateway.recordTurnOutcome).toHaveBeenCalledWith(binding.platform, {
      ok: false,
      reason: expect.stringContaining('reply not delivered'),
    });
  });

  it('relays unroutable permission prompts to the chat user mid-turn (TASK_2026_271 #1)', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const conversation = makeConversation(binding, { id: 'conv-7' });
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    h.adapter.startChatSession.mockResolvedValue(
      gatedStream(gate, [textDelta(SDK_UUID, 'ok'), messageComplete(SDK_UUID)]),
    );

    h.bridge.start();
    expect(h.permissionHandler.onPromptLifecycle).toHaveBeenCalledTimes(1);
    h.gateway.emit('inbound', makeEvent(binding, 'write it', { conversation }));
    await flushUntil(() => h.adapter.startChatSession.mock.calls.length > 0);

    // Mid-turn: the SDK asks for Write, unroutable, 60s deny window.
    h.permissionHandler.fire({
      phase: 'requested',
      requestId: 'r1',
      routingHint: 'gw-conv-7',
      toolName: 'Write',
      description: 'Write /ws/proj/a.ts',
      routable: false,
      timeoutMs: 60_000,
    });
    // A routable prompt (real webview surface) is not our business.
    h.permissionHandler.fire({
      phase: 'requested',
      requestId: 'r2',
      routingHint: 'some-uuid-tab',
      toolName: 'Bash',
      description: 'ls',
      routable: true,
    });
    h.permissionHandler.fire({
      phase: 'resolved',
      requestId: 'r1',
      routingHint: 'gw-conv-7',
      toolName: 'Write',
      outcome: 'timed-out',
    });
    await flushUntil(() => h.gateway.sendNotice.mock.calls.length >= 2);

    const notices = h.gateway.sendNotice.mock.calls.map(([, t]) => t);
    expect(notices).toHaveLength(2);
    expect(notices[0]).toContain('needs approval to run `Write`');
    expect(notices[0]).toContain('within 60s');
    expect(notices[1]).toContain('No approval arrived for `Write`');
    // Notices bypass the coalescer — the reply buffer is untouched by them.
    expect(h.gateway.appendOutboundChunk).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('approval'),
    );

    release();
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );
    // After the turn the route is gone: a stray late event sends nothing.
    h.permissionHandler.fire({
      phase: 'requested',
      requestId: 'r3',
      routingHint: 'gw-conv-7',
      toolName: 'Bash',
      description: 'late',
      routable: false,
      timeoutMs: 60_000,
    });
    await flushUntil(() => false, 3);
    expect(h.gateway.sendNotice).toHaveBeenCalledTimes(2);

    h.bridge.stop();
    expect(h.permissionHandler.unsubscribed).toBe(1);
  });

  it('includes conversationId in the outbound route for threaded inbound', async () => {
    const h = setup();
    const binding = makeBinding({
      platform: 'discord',
      workspaceRoot: '/ws/proj',
    });
    const conversation = makeConversation(binding, {
      id: 'conv-thread',
      externalConversationId: 'thread-9',
    });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'reply'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit(
      'inbound',
      makeEvent(binding, 'go', { conversation, conversationId: 'thread-9' }),
    );
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    const key = ConversationKey.for(
      binding.platform,
      binding.externalChatId,
      'thread-9',
    );
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledWith(
      {
        conversationKey: key,
        platform: 'discord',
        externalChatId: binding.externalChatId,
        conversationId: 'thread-9',
      },
      'reply',
    );
    expect(h.gateway.completeOutboundTurn).toHaveBeenCalledWith(key);
    expect(h.gateway.drainOutbound).not.toHaveBeenCalled();
  });

  it('persists the first non-tabId sessionId to the conversation row exactly once', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const conversation = makeConversation(binding, { id: 'conv-7' });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'a'),
        textDelta(SDK_UUID, 'b'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go', { conversation }));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    expect(h.conversations.setPtahSessionId).toHaveBeenCalledTimes(1);
    expect(h.conversations.setPtahSessionId).toHaveBeenCalledWith(
      conversation.id,
      SDK_UUID,
    );
  });

  it('ends the SDK session after the turn drains so the next message resumes cleanly', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.isSessionActive.mockReturnValue(true);
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'x'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );
    await flushUntil(() => h.adapter.endSession.mock.calls.length > 0);

    expect(h.adapter.endSession).toHaveBeenCalledWith(SDK_UUID);
  });

  it('seeds the safe default permission level (ask) at start, not a post-hoc bypass flip (TASK_2026_192)', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'x'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    expect(h.adapter.setSessionPermissionLevel).not.toHaveBeenCalled();
    expect(h.adapter.startChatSession.mock.calls[0][0].permissionLevel).toBe(
      'ask',
    );
  });

  it('resumes an active persisted session from conversation.ptahSessionId', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const conversation = makeConversation(binding, {
      ptahSessionId: SDK_UUID,
    });
    h.adapter.isSessionActive.mockReturnValue(true);
    h.adapter.resumeSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'r'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'again', { conversation }));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    expect(h.adapter.resumeSession).toHaveBeenCalledTimes(1);
    expect(h.adapter.startChatSession).not.toHaveBeenCalled();
    const [sid, cfg] = h.adapter.resumeSession.mock.calls[0];
    expect(sid).toBe(SDK_UUID);
    expect(cfg?.prompt).toBe('again');
  });

  it('passes the user-selected model (not a hardcoded default) to new + resumed sessions', async () => {
    const h = setup({ selectedModel: 'gpt-5-codex' });
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const fresh = makeConversation(binding, { ptahSessionId: null });
    const resumable = makeConversation(binding, { ptahSessionId: SDK_UUID });
    h.adapter.isSessionActive.mockReturnValue(true);
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'a'),
        messageComplete(SDK_UUID),
      ]),
    );
    h.adapter.resumeSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'b'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit(
      'inbound',
      makeEvent(binding, 'first', { conversation: fresh }),
    );
    await flushUntil(() => h.adapter.startChatSession.mock.calls.length > 0);
    h.gateway.emit(
      'inbound',
      makeEvent(binding, 'again', { conversation: resumable }),
    );
    await flushUntil(() => h.adapter.resumeSession.mock.calls.length > 0);

    expect(h.adapter.startChatSession.mock.calls[0][0].model).toBe(
      'gpt-5-codex',
    );
    expect(h.adapter.resumeSession.mock.calls[0][1]?.model).toBe('gpt-5-codex');
  });

  it('ignores a stale binding.ptahSessionId when the conversation row has none', async () => {
    const h = setup();
    const binding = makeBinding({
      workspaceRoot: '/ws/proj',
      ptahSessionId: SDK_UUID,
    });
    const conversation = makeConversation(binding, { ptahSessionId: null });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID_B, 'fresh'),
        messageComplete(SDK_UUID_B),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go', { conversation }));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    expect(h.adapter.resumeSession).not.toHaveBeenCalled();
    expect(h.adapter.startChatSession).toHaveBeenCalledTimes(1);
  });

  it('runs two conversations on one binding concurrently without prompt bleed', async () => {
    const h = setup();
    const binding = makeBinding({
      platform: 'discord',
      workspaceRoot: '/ws/proj',
    });
    const convA = makeConversation(binding, {
      id: 'conv-a',
      externalConversationId: 'thread-a',
    });
    const convB = makeConversation(binding, {
      id: 'conv-b',
      externalConversationId: 'thread-b',
    });
    const release: Record<string, () => void> = {};
    h.adapter.startChatSession.mockImplementation(async (config) => {
      const gate = new Promise<void>((r) => {
        release[config.tabId] = r;
      });
      const uuid = config.tabId === 'gw-conv-a' ? SDK_UUID : SDK_UUID_B;
      const delta = config.tabId === 'gw-conv-a' ? 'answer-a' : 'answer-b';
      return gatedStream(gate, [textDelta(uuid, delta), messageComplete(uuid)]);
    });

    h.bridge.start();
    h.gateway.emit(
      'inbound',
      makeEvent(binding, 'prompt A', {
        conversation: convA,
        conversationId: 'thread-a',
      }),
    );
    h.gateway.emit(
      'inbound',
      makeEvent(binding, 'prompt B', {
        conversation: convB,
        conversationId: 'thread-b',
      }),
    );
    await flushUntil(() => h.adapter.startChatSession.mock.calls.length === 2);

    expect(h.adapter.startChatSession).toHaveBeenCalledTimes(2);
    const byTab = new Map(
      h.adapter.startChatSession.mock.calls.map(([cfg]) => [cfg.tabId, cfg]),
    );
    expect(byTab.get('gw-conv-a')?.prompt).toBe('prompt A');
    expect(byTab.get('gw-conv-b')?.prompt).toBe('prompt B');

    release['gw-conv-a']();
    release['gw-conv-b']();
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length === 2,
    );

    const keyA = ConversationKey.for(
      'discord',
      binding.externalChatId,
      'thread-a',
    );
    const keyB = ConversationKey.for(
      'discord',
      binding.externalChatId,
      'thread-b',
    );
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: keyA,
        conversationId: 'thread-a',
      }),
      'answer-a',
    );
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: keyB,
        conversationId: 'thread-b',
      }),
      'answer-b',
    );
    expect(h.gateway.completeOutboundTurn).toHaveBeenCalledWith(keyA);
    expect(h.gateway.completeOutboundTurn).toHaveBeenCalledWith(keyB);
    expect(h.gateway.drainOutbound).not.toHaveBeenCalled();
    expect(h.conversations.setPtahSessionId).toHaveBeenCalledWith(
      convA.id,
      SDK_UUID,
    );
    expect(h.conversations.setPtahSessionId).toHaveBeenCalledWith(
      convB.id,
      SDK_UUID_B,
    );
  });

  it('serializes turns for the same conversation key', async () => {
    const h = setup();
    const binding = makeBinding({
      platform: 'discord',
      workspaceRoot: '/ws/proj',
    });
    const conversation = makeConversation(binding, {
      id: 'conv-a',
      externalConversationId: 'thread-a',
    });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => {
      releaseFirst = r;
    });
    let calls = 0;
    h.adapter.startChatSession.mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        return gatedStream(firstGate, [
          textDelta(SDK_UUID, 'one'),
          messageComplete(SDK_UUID),
        ]);
      }
      return scriptedStream([
        textDelta(SDK_UUID_B, 'two'),
        messageComplete(SDK_UUID_B),
      ]);
    });

    h.bridge.start();
    const event = (body: string): GatewayInboundEvent =>
      makeEvent(binding, body, { conversation, conversationId: 'thread-a' });
    h.gateway.emit('inbound', event('first'));
    h.gateway.emit('inbound', event('second'));
    await flushUntil(() => false, 5);

    expect(h.adapter.startChatSession).toHaveBeenCalledTimes(1);

    releaseFirst();
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length === 2,
    );

    expect(h.adapter.startChatSession).toHaveBeenCalledTimes(2);
    expect(h.adapter.startChatSession.mock.calls[0][0].prompt).toBe('first');
    expect(h.adapter.startChatSession.mock.calls[1][0].prompt).toBe('second');
  });

  it('resumes a persisted conversation session on a fresh bridge after restart', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const conversation = makeConversation(binding, {
      id: 'conv-restored',
      ptahSessionId: SDK_UUID,
    });
    h.adapter.isSessionActive.mockReturnValue(false);
    h.adapter.resumeSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'restored'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go', { conversation }));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    expect(h.adapter.resumeSession).toHaveBeenCalledTimes(1);
    expect(h.adapter.resumeSession.mock.calls[0][0]).toBe(SDK_UUID);
    expect(h.adapter.startChatSession).not.toHaveBeenCalled();
  });

  it('resumes a non-active persisted id; falls back to startChatSession on resume error', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const conversation = makeConversation(binding, {
      ptahSessionId: SDK_UUID,
    });
    h.adapter.isSessionActive.mockReturnValue(false);
    h.adapter.resumeSession.mockRejectedValue(new Error('no such session'));
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'fresh'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go', { conversation }));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    expect(h.adapter.resumeSession).toHaveBeenCalled();
    expect(h.adapter.startChatSession).toHaveBeenCalledTimes(1);
  });

  it('falls back to startChatSession when a resumed stream produces zero events', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const conversation = makeConversation(binding, {
      ptahSessionId: SDK_UUID,
    });
    h.adapter.isSessionActive.mockReturnValue(true);
    h.adapter.resumeSession.mockResolvedValue(await scriptedStream([]));
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'recovered'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go', { conversation }));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    expect(h.adapter.startChatSession).toHaveBeenCalledTimes(1);
  });

  it('sends an error reply and never starts a session when no workspace is resolvable', async () => {
    const h = setup({ workspaceRoot: null });
    const binding = makeBinding({ workspaceRoot: null });

    h.bridge.start();
    const key = ConversationKey.for(binding.platform, binding.externalChatId);
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
    // NOT `completeOutboundTurn` — this path returns before the seal is wired,
    // so polling for it would time out silently and assert nothing.
    await flushUntil(() => h.gateway.discardOutbound.mock.calls.length > 0);

    expect(h.adapter.startChatSession).not.toHaveBeenCalled();
    expect(h.adapter.resumeSession).not.toHaveBeenCalled();
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledTimes(1);
    expect(h.gateway.appendOutboundChunk.mock.calls[0][0].conversationKey).toBe(
      key,
    );
    expect(h.gateway.drainOutbound).toHaveBeenCalledWith(key);
    // The error text must not survive into the next turn's buffer.
    expect(h.gateway.discardOutbound).toHaveBeenCalledWith(key);
  });

  it('drains and sends an error message when the adapter throws mid-stream', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.startChatSession.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield textDelta(SDK_UUID, 'partial');
        throw new Error('mid-stream boom');
      },
    } as AsyncIterable<FlatStreamEventUnion>);

    h.bridge.start();
    const key = ConversationKey.for(binding.platform, binding.externalChatId);
    await expect(
      (async () => {
        h.gateway.emit('inbound', makeEvent(binding, 'go'));
        await flushUntil(
          () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
        );
      })(),
    ).resolves.toBeUndefined();

    expect(h.gateway.drainOutbound).toHaveBeenCalledWith(key);
    expect(
      h.gateway.appendOutboundChunk.mock.calls.some(
        ([, msg]) => typeof msg === 'string' && msg.length > 0,
      ),
    ).toBe(true);
  });

  it('discards a stranded partial reply before retrying a failed resume on a fresh session (TASK_2026_271 #6)', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const conversation = makeConversation(binding, {
      ptahSessionId: SDK_UUID,
    });
    h.adapter.isSessionActive.mockReturnValue(true);
    // Resume streams half an answer, then dies.
    h.adapter.resumeSession.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield textDelta(SDK_UUID, 'stranded half');
        throw new Error('resume died');
      },
    } as AsyncIterable<FlatStreamEventUnion>);
    // Fresh session answers cleanly.
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID_B, 'full answer'),
        messageComplete(SDK_UUID_B),
      ]),
    );

    h.bridge.start();
    const key = ConversationKey.for(binding.platform, binding.externalChatId);
    h.gateway.emit('inbound', makeEvent(binding, 'go', { conversation }));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    expect(h.adapter.startChatSession).toHaveBeenCalledTimes(1);
    // The buffer holding "stranded half" is dropped BEFORE the retry appends.
    const discardIdx = h.gateway.discardOutbound.mock.invocationCallOrder[0];
    const retryAppend = h.gateway.appendOutboundChunk.mock.calls.findIndex(
      ([, t]) => t === 'full answer',
    );
    expect(h.gateway.discardOutbound).toHaveBeenCalledWith(key);
    expect(retryAppend).toBeGreaterThanOrEqual(0);
    expect(
      h.gateway.appendOutboundChunk.mock.invocationCallOrder[retryAppend],
    ).toBeGreaterThan(discardIdx);
    expect(h.gateway.recordTurnOutcome).toHaveBeenCalledWith(binding.platform, {
      ok: true,
    });
  });

  it('seals the turn once via completeOutboundTurn in the finally (success path)', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'x'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    const key = ConversationKey.for(binding.platform, binding.externalChatId);
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    // Sealed exactly once, on the same key used for append/drain this turn.
    expect(h.gateway.completeOutboundTurn).toHaveBeenCalledTimes(1);
    expect(h.gateway.completeOutboundTurn).toHaveBeenCalledWith(key);
  });

  it('emits exactly ONE outbound flush per turn — no mid-turn send on message_complete', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    // A turn with several text_delta events plus message_complete must NOT
    // flush mid-turn. Every delta only accumulates; the single send happens
    // once at end-of-turn via completeOutboundTurn. message_complete is no
    // longer a flush point.
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'a'),
        textDelta(SDK_UUID, 'b'),
        messageComplete(SDK_UUID),
        textDelta(SDK_UUID, 'c'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    const key = ConversationKey.for(binding.platform, binding.externalChatId);
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    // All three deltas were appended (accumulated), none triggered a send.
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledTimes(3);
    // NO mid-turn drain on the agent-reply path.
    expect(h.gateway.drainOutbound).not.toHaveBeenCalled();
    // The single flush is the end-of-turn seal, fired exactly once.
    expect(h.gateway.completeOutboundTurn).toHaveBeenCalledTimes(1);
    expect(h.gateway.completeOutboundTurn).toHaveBeenCalledWith(key);
  });

  it('still seals the turn when the stream errors mid-flight (finally path)', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.startChatSession.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield textDelta(SDK_UUID, 'partial');
        throw new Error('mid-stream boom');
      },
    } as AsyncIterable<FlatStreamEventUnion>);

    h.bridge.start();
    const key = ConversationKey.for(binding.platform, binding.externalChatId);
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    expect(h.gateway.completeOutboundTurn).toHaveBeenCalledTimes(1);
    expect(h.gateway.completeOutboundTurn).toHaveBeenCalledWith(key);
  });

  it('stop() removes the listener so no further turns run', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'x'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.bridge.stop();
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
    await flushUntil(() => false, 5);

    expect(h.adapter.startChatSession).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// F1 — seeded permissionLevel on resume (TASK_2026_155, Task 2.1/3.3)
// Updated for TASK_2026_192: the seeded level is the configurable gateway
// level (safe default 'ask'), no longer an unconditional 'yolo'.
// ---------------------------------------------------------------------------
//
// `startChatSession` carrying the seeded level and `bindSession` never calling
// `setSessionPermissionLevel` are already exercised by the "seeds the safe
// default permission level (ask) at start..." spec above. These two specs close
// the remaining gaps: BOTH `resumeSession` call sites (the canResume fast path
// and the try/catch resume-recovery path) must also carry the seeded level, and
// `bindSession` must still persist the sessionId even though it never flips
// permissions.
describe('GatewayChatBridge — F1 resume permissionLevel + bindSession (Task 2.1/2.2/3.3)', () => {
  it('resumeSession receives the safe default permissionLevel ("ask") on the canResume fast path', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const conversation = makeConversation(binding, { ptahSessionId: SDK_UUID });
    h.adapter.isSessionActive.mockReturnValue(true);
    h.adapter.resumeSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'r'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'again', { conversation }));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    expect(h.adapter.resumeSession).toHaveBeenCalledTimes(1);
    expect(h.adapter.resumeSession.mock.calls[0][1]?.permissionLevel).toBe(
      'ask',
    );
  });

  it('resumeSession receives the safe default permissionLevel ("ask") on the try/catch resume-recovery path (persisted but not active)', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const conversation = makeConversation(binding, { ptahSessionId: SDK_UUID });
    // Not active -> canResume fast path is skipped, falls into the
    // try/catch resume-recovery branch in openStream (still attempted
    // before giving up to startNew).
    h.adapter.isSessionActive.mockReturnValue(false);
    h.adapter.resumeSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'restored'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'again', { conversation }));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    expect(h.adapter.resumeSession).toHaveBeenCalledTimes(1);
    expect(h.adapter.startChatSession).not.toHaveBeenCalled();
    expect(h.adapter.resumeSession.mock.calls[0][1]?.permissionLevel).toBe(
      'ask',
    );
  });

  it('bindSession never calls setSessionPermissionLevel, but still persists the resolved sessionId via setPtahSessionId', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const conversation = makeConversation(binding, { id: 'conv-bind' });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'x'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go', { conversation }));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    expect(h.adapter.setSessionPermissionLevel).not.toHaveBeenCalled();
    expect(h.conversations.setPtahSessionId).toHaveBeenCalledWith(
      conversation.id,
      SDK_UUID,
    );
  });
});

// ---------------------------------------------------------------------------
// Inbound permission gate (TASK_2026_192)
// ---------------------------------------------------------------------------
//
// Gateway inbound is a REMOTE, non-interactive path. The bridge must seed the
// session's permission level from `ptah.gateway.permissionLevel`, defaulting to
// the safe `'ask'` — NEVER an unconditional `'yolo'`. At `'ask'` the downstream
// SdkPermissionHandler routes every DANGEROUS_TOOL (`Write`/`Edit`/`Bash`/
// `NotebookEdit`), network, and MCP tool to an approval surface instead of
// auto-approving; only when the operator explicitly opts into `'yolo'` are those
// tools auto-approved. These specs pin the seeded level at the bridge boundary
// (the SDK-side gate mapping is covered by sdk-permission-handler.spec.ts).
describe('GatewayChatBridge — inbound permission gate (TASK_2026_192)', () => {
  const DANGEROUS_TOOLS = ['Write', 'Edit', 'Bash', 'NotebookEdit'] as const;

  async function seededLevelForNewSession(
    gatewayPermissionLevel?: string,
  ): Promise<string | undefined> {
    const h = setup(
      gatewayPermissionLevel === undefined
        ? undefined
        : { gatewayPermissionLevel },
    );
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'x'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    return h.adapter.startChatSession.mock.calls[0][0].permissionLevel;
  }

  it('defaults a new gateway session to "ask" — dangerous tools are NOT auto-approved without explicit opt-in', async () => {
    const level = await seededLevelForNewSession();
    expect(level).toBe('ask');
    // The safe default is precisely the level at which the SDK gate does NOT
    // auto-approve any dangerous tool — assert it is not the auto-approve-all
    // level for each dangerous tool the gateway session could otherwise reach.
    expect(level).not.toBe('yolo');
    expect(DANGEROUS_TOOLS.length).toBeGreaterThan(0);
    for (const _tool of DANGEROUS_TOOLS) {
      expect(level).not.toBe('yolo');
    }
  });

  it('defaults a resumed gateway session to "ask" (not "yolo")', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const conversation = makeConversation(binding, { ptahSessionId: SDK_UUID });
    h.adapter.isSessionActive.mockReturnValue(true);
    h.adapter.resumeSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'r'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'again', { conversation }));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    expect(h.adapter.resumeSession.mock.calls[0][1]?.permissionLevel).toBe(
      'ask',
    );
    expect(h.adapter.resumeSession.mock.calls[0][1]?.permissionLevel).not.toBe(
      'yolo',
    );
  });

  it('auto-approves (yolo) ONLY when the operator explicitly configures it', async () => {
    expect(await seededLevelForNewSession('yolo')).toBe('yolo');
  });

  it('honors an explicit "auto-edit" opt-in', async () => {
    expect(await seededLevelForNewSession('auto-edit')).toBe('auto-edit');
  });

  it('rejects an unknown/invalid configured level and falls back to the safe default "ask"', async () => {
    expect(await seededLevelForNewSession('bypassPermissions')).toBe('ask');
    expect(await seededLevelForNewSession('plan')).toBe('ask');
    expect(await seededLevelForNewSession('')).toBe('ask');
    expect(await seededLevelForNewSession('garbage')).toBe('ask');
  });

  it('never flips the session permission level post-hoc regardless of configured level', async () => {
    const h = setup({ gatewayPermissionLevel: 'yolo' });
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'x'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    expect(h.adapter.setSessionPermissionLevel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// F3 — turn watchdog (TASK_2026_155, Task 2.3/3.3)
// ---------------------------------------------------------------------------
describe('GatewayChatBridge — turn watchdog (Task 2.3/3.3)', () => {
  // Mirrors gateway-chat-bridge.ts's private `TURN_WATCHDOG_MS` (10 min).
  // Not exported (module-private constant); hardcoded here the same way
  // `UNROUTABLE_PERMISSION_TIMEOUT_MS` is hardcoded in the permission-handler
  // spec. If the production constant changes, this test's window must too.
  const TURN_WATCHDOG_MS = 10 * 60_000;

  afterEach(() => {
    jest.useRealTimers();
  });

  it('a stream that never settles is force-terminated after TURN_WATCHDOG_MS: session ended once, ONE error reply sent, turn sealed once, and the enqueue promise resolves so a queued second turn runs', async () => {
    jest.useFakeTimers();
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });

    // Realistic stateful mock: isSessionActive flips to false once endSession
    // is actually called, mirroring the real adapter (ending a session makes
    // it inactive). This is what makes endSessionAfterTurn's second call (in
    // the `finally`) a genuine no-op instead of a lucky mock default.
    let sessionActive = true;
    h.adapter.isSessionActive.mockImplementation(() => sessionActive);
    h.adapter.endSession.mockImplementation(() => {
      sessionActive = false;
    });

    let startCalls = 0;
    h.adapter.startChatSession.mockImplementation(async () => {
      startCalls++;
      if (startCalls === 1) {
        return {
          async *[Symbol.asyncIterator]() {
            // Simulates a wedged canUseTool: the stream never produces an
            // event and never completes. The `yield` below is unreachable
            // (only present to satisfy eslint's require-yield rule).
            await new Promise<void>(() => {
              /* never resolves */
            });
            yield textDelta(SDK_UUID, 'unreachable');
          },
        } as AsyncIterable<FlatStreamEventUnion>;
      }
      return scriptedStream([
        textDelta(SDK_UUID_B, 'second-turn'),
        messageComplete(SDK_UUID_B),
      ]);
    });

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'first (hangs)'));
    h.gateway.emit('inbound', makeEvent(binding, 'second (queued)'));

    // Let the first (hanging) turn actually start before advancing the clock.
    await jest.advanceTimersByTimeAsync(0);
    expect(h.adapter.startChatSession).toHaveBeenCalledTimes(1);
    expect(h.gateway.completeOutboundTurn).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(TURN_WATCHDOG_MS);

    // Watchdog fired on the first turn: session ended exactly once
    // (idempotency proven via the stateful isSessionActive/endSession mock
    // above, not a lucky default) and exactly one error reply was appended.
    expect(h.adapter.endSession).toHaveBeenCalledTimes(1);
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledWith(
      expect.anything(),
      'This request took too long and was stopped. Please try again.',
    );
    expect(
      h.gateway.appendOutboundChunk.mock.calls.filter(
        ([, msg]) =>
          msg ===
          'This request took too long and was stopped. Please try again.',
      ),
    ).toHaveLength(1);

    // The ConversationQueue link settled as soon as the watchdog force-ended
    // the first turn, so the queued second turn ran to completion within the
    // same flush — this is the whole point of F3: the queue never wedges.
    expect(h.adapter.startChatSession).toHaveBeenCalledTimes(2);
    expect(h.gateway.completeOutboundTurn).toHaveBeenCalledTimes(2);
  });

  it('an abandoned (watchdog-terminated) turn that later unblocks does NOT retry, append, or re-bind into the next turn', async () => {
    jest.useFakeTimers();
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    // Persisted session so the abandoned turn's fallback path (tryFallbackStart
    // -> startNew) is actually reachable — a fresh (null ptahSessionId) turn
    // would bail out of tryFallbackStart before startNew regardless of the
    // cancellation guard, making the sanity-check inert.
    const conversation = makeConversation(binding, {
      id: 'conv-x',
      ptahSessionId: SDK_UUID,
    });

    // The hung first turn unblocks ONLY once endSession is dispatched, mirroring
    // the real SDK where endSession -> query.interrupt() unwedges the for-await
    // loop. It then completes with ZERO events. WITHOUT the per-turn
    // cancellation guard, pumpStream's zero-event sentinel throws ->
    // tryFallbackStart -> a stray startChatSession (startNew) into the SAME
    // tabId the second turn now owns (the cross-turn corruption Critical Issue 1
    // flags). A manual async iterator (not a generator) yields nothing without
    // tripping eslint's require-yield.
    let releaseHung!: () => void;
    const hungGate = new Promise<void>((r) => {
      releaseHung = r;
    });
    const active = new Set<string>([SDK_UUID]);
    h.adapter.isSessionActive.mockImplementation((id) =>
      active.has(String(id)),
    );
    h.adapter.endSession.mockImplementation((id) => {
      active.delete(String(id));
      releaseHung();
    });

    const hungStream: AsyncIterable<FlatStreamEventUnion> = {
      [Symbol.asyncIterator]() {
        let done = false;
        return {
          async next(): Promise<IteratorResult<FlatStreamEventUnion>> {
            if (done) return { done: true, value: undefined };
            await hungGate;
            done = true;
            return { done: true, value: undefined };
          },
        };
      },
    };

    let resumeCalls = 0;
    h.adapter.resumeSession.mockImplementation(async () => {
      resumeCalls++;
      if (resumeCalls === 1) {
        return hungStream; // first turn: hangs, then zero events post-watchdog
      }
      return scriptedStream([
        textDelta(SDK_UUID_B, 'second'),
        messageComplete(SDK_UUID_B),
      ]);
    });
    // startChatSession is ONLY reachable here via the abandoned turn's stray
    // fallback (startNew). If the guard holds, it is never called.
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'STRAY'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit(
      'inbound',
      makeEvent(binding, 'first (hangs)', { conversation }),
    );
    h.gateway.emit(
      'inbound',
      makeEvent(binding, 'second (queued)', { conversation }),
    );

    await jest.advanceTimersByTimeAsync(0);
    expect(h.adapter.resumeSession).toHaveBeenCalledTimes(1);

    // Watchdog fires: cancels + ends the first turn (which unblocks the hung
    // stream), then the queued second turn runs.
    await jest.advanceTimersByTimeAsync(TURN_WATCHDOG_MS);
    // Flush the now-unblocked abandoned turn's continuation.
    await jest.advanceTimersByTimeAsync(0);

    // The abandoned turn's zero-event resume did NOT spawn a stray fallback
    // session — the cancellation guard turned its continuation into a no-op.
    expect(h.adapter.startChatSession).not.toHaveBeenCalled();

    // Outbound bucket only ever saw the watchdog error and the SECOND turn's
    // text — never the stray fallback's 'STRAY' debris.
    const appended = h.gateway.appendOutboundChunk.mock.calls.map(
      ([, msg]) => msg,
    );
    expect(appended).toContain('second');
    expect(appended).toContain(
      'This request took too long and was stopped. Please try again.',
    );
    expect(appended).not.toContain('STRAY');

    // setPtahSessionId written once, for the second (legitimate) turn's session
    // — never overwritten by the abandoned first turn's stray session.
    expect(h.conversations.setPtahSessionId).toHaveBeenCalledTimes(1);
    expect(h.conversations.setPtahSessionId).toHaveBeenCalledWith(
      conversation.id,
      SDK_UUID_B,
    );
  });

  it('a fast turn never triggers the watchdog error reply and clears the timer', async () => {
    jest.useFakeTimers();
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'fast'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go'));

    await jest.advanceTimersByTimeAsync(0);
    expect(h.gateway.completeOutboundTurn).toHaveBeenCalledTimes(1);

    // Advance well past the watchdog window — the timer was cleared in the
    // `finally`, so nothing fires and no extra error reply is sent.
    await jest.advanceTimersByTimeAsync(TURN_WATCHDOG_MS + 60_000);

    expect(h.gateway.completeOutboundTurn).toHaveBeenCalledTimes(1);
    expect(
      h.gateway.appendOutboundChunk.mock.calls.some(
        ([, msg]) =>
          msg ===
          'This request took too long and was stopped. Please try again.',
      ),
    ).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F4 — SDK context wiring: MCP + prompts/plugins (TASK_2026_155, Task 2.4/3.3)
// ---------------------------------------------------------------------------
//
// Ptah is now fully open source: there is no premium/free tier and no
// `isPremium` on the SDK config. The formerly premium-gated capabilities
// (code-exec MCP, enhanced prompts, plugins) are unconditional — the ONLY
// governor is the live MCP port + the resolved prompt/plugin wiring. These
// specs prove that wiring drives the SDK config correctly.
describe('GatewayChatBridge — SDK context wiring (MCP + prompts/plugins) (Task 2.4/3.3)', () => {
  it('live MCP port + resolved prompts/plugins: startChatSession receives mcpServerRunning true, the enhanced prompt, and plugin paths, and registers the MCP for subagents', async () => {
    const h = setup({
      mcpPort: 4319,
      enhancedPromptsContent: 'ENHANCED SYSTEM PROMPT',
      enabledPluginIds: ['plugin-a'],
      resolvedPluginPaths: ['/plugins/plugin-a'],
    });
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'x'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    const config = h.adapter.startChatSession.mock.calls[0][0];
    expect(config.mcpServerRunning).toBe(true);
    expect(config.enhancedPromptsContent).toBe('ENHANCED SYSTEM PROMPT');
    expect(config.pluginPaths).toEqual(['/plugins/plugin-a']);
    expect(h.codeExecutionMcp.ensureRegisteredForSubagents).toHaveBeenCalled();
  });

  it('no MCP port and no prompts/plugins: startChatSession receives mcpServerRunning false, undefined prompts/plugins, does not register the MCP, and the turn still completes', async () => {
    const h = setup({
      mcpPort: null,
    });
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'x'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    const config = h.adapter.startChatSession.mock.calls[0][0];
    expect(config.mcpServerRunning).toBe(false);
    expect(config.enhancedPromptsContent).toBeUndefined();
    expect(config.pluginPaths).toBeUndefined();
    expect(
      h.codeExecutionMcp.ensureRegisteredForSubagents,
    ).not.toHaveBeenCalled();
    expect(h.gateway.completeOutboundTurn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Conversation-first effective-workspace resolution (TASK_2026_156, plan §6)
// ---------------------------------------------------------------------------
const WORKSPACE_UNAVAILABLE_MESSAGE =
  "This thread's workspace is no longer available in Ptah. Run /workspace use to pick another.";

describe('GatewayChatBridge — conversation-first workspace resolution (TASK_2026_156)', () => {
  it('prefers an allowlisted conversation-pinned root over the binding root', async () => {
    const h = setup({ workspaceFolders: ['/ws/conv', '/ws/proj'] });
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const conversation = makeConversation(binding, {
      id: 'conv-pinned',
      workspaceRoot: '/ws/conv',
    });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'hi'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go', { conversation }));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    expect(h.adapter.startChatSession).toHaveBeenCalledTimes(1);
    const config = h.adapter.startChatSession.mock.calls[0][0];
    expect(config.projectPath).toBe('/ws/conv');
    expect(config.workspaceId).toBe('/ws/conv');
    expect(h.workspace.getWorkspaceFolders).toHaveBeenCalled();
  });

  it('a NULL conversation root inherits the binding root', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const conversation = makeConversation(binding, { workspaceRoot: null });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'hi'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go', { conversation }));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    expect(h.adapter.startChatSession.mock.calls[0][0].projectPath).toBe(
      '/ws/proj',
    );
  });

  it('NULL conversation root and NULL binding root fall back to the active workspace', async () => {
    const h = setup({ workspaceRoot: '/ws/global' });
    const binding = makeBinding({ workspaceRoot: null });
    const conversation = makeConversation(binding, { workspaceRoot: null });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'hi'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go', { conversation }));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    expect(h.adapter.startChatSession.mock.calls[0][0].projectPath).toBe(
      '/ws/global',
    );
  });

  it('a conversation root that left the allowlist fails the turn closed — no silent fallback to the binding root, no session start', async () => {
    const h = setup({ workspaceFolders: ['/ws/other'] });
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const conversation = makeConversation(binding, {
      workspaceRoot: '/ws/revoked',
    });

    h.bridge.start();
    const key = ConversationKey.for(binding.platform, binding.externalChatId);
    h.gateway.emit('inbound', makeEvent(binding, 'go', { conversation }));
    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length > 0);

    expect(h.adapter.startChatSession).not.toHaveBeenCalled();
    expect(h.adapter.resumeSession).not.toHaveBeenCalled();
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledTimes(1);
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledWith(
      expect.objectContaining({ conversationKey: key }),
      WORKSPACE_UNAVAILABLE_MESSAGE,
    );
    expect(h.gateway.drainOutbound).toHaveBeenCalledWith(key);
    expect(h.gateway.discardOutbound).toHaveBeenCalledWith(key);
  });

  it('an allowlisted conversation root that vanished on disk fails the turn closed', async () => {
    const h = setup({ workspaceFolders: ['/ws/conv'] });
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const conversation = makeConversation(binding, {
      workspaceRoot: '/ws/conv',
    });
    accessMock.mockRejectedValueOnce(new Error('ENOENT'));

    h.bridge.start();
    const key = ConversationKey.for(binding.platform, binding.externalChatId);
    h.gateway.emit('inbound', makeEvent(binding, 'go', { conversation }));
    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length > 0);

    expect(accessMock).toHaveBeenCalledWith('/ws/conv');
    expect(h.adapter.startChatSession).not.toHaveBeenCalled();
    expect(h.adapter.resumeSession).not.toHaveBeenCalled();
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledTimes(1);
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledWith(
      expect.objectContaining({ conversationKey: key }),
      WORKSPACE_UNAVAILABLE_MESSAGE,
    );
    expect(h.gateway.drainOutbound).toHaveBeenCalledWith(key);
    expect(h.gateway.discardOutbound).toHaveBeenCalledWith(key);
  });
});

// ---------------------------------------------------------------------------
// ConversationTurnTracker wiring (TASK_2026_156, plan §4.6)
// ---------------------------------------------------------------------------
describe('GatewayChatBridge — turn tracker wiring (TASK_2026_156)', () => {
  const TURN_WATCHDOG_MS = 10 * 60_000;

  afterEach(() => {
    jest.useRealTimers();
  });

  it('marks the key busy while a turn runs and while a second is queued, and releases it once the chain settles', async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const conversation = makeConversation(binding);
    const key = ConversationKey.for(binding.platform, binding.externalChatId);
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => {
      releaseFirst = r;
    });
    let calls = 0;
    h.adapter.startChatSession.mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        return gatedStream(firstGate, [
          textDelta(SDK_UUID, 'one'),
          messageComplete(SDK_UUID),
        ]);
      }
      return scriptedStream([
        textDelta(SDK_UUID_B, 'two'),
        messageComplete(SDK_UUID_B),
      ]);
    });

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'first', { conversation }));
    h.gateway.emit('inbound', makeEvent(binding, 'second', { conversation }));
    expect(h.turnTracker.isBusy(key)).toBe(true);

    await flushUntil(() => h.adapter.startChatSession.mock.calls.length === 1);
    // First turn mid-stream, second queued behind it — still busy.
    expect(h.turnTracker.isBusy(key)).toBe(true);

    releaseFirst();
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length === 2,
    );
    await flushUntil(() => !h.turnTracker.isBusy(key));
    expect(h.turnTracker.isBusy(key)).toBe(false);
  });

  it('releases the key even when the turn fails before a session starts (no workspace open)', async () => {
    const h = setup({ workspaceRoot: null });
    const binding = makeBinding({ workspaceRoot: null });
    const key = ConversationKey.for(binding.platform, binding.externalChatId);

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
    expect(h.turnTracker.isBusy(key)).toBe(true);

    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length > 0);
    await flushUntil(() => !h.turnTracker.isBusy(key));
    expect(h.turnTracker.isBusy(key)).toBe(false);
  });

  it('releases the key after the watchdog force-terminates a hung turn', async () => {
    jest.useFakeTimers();
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    const key = ConversationKey.for(binding.platform, binding.externalChatId);
    h.adapter.startChatSession.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        await new Promise<void>(() => {
          /* never resolves */
        });
        yield textDelta(SDK_UUID, 'unreachable');
      },
    } as AsyncIterable<FlatStreamEventUnion>);

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'hangs'));
    expect(h.turnTracker.isBusy(key)).toBe(true);

    await jest.advanceTimersByTimeAsync(0);
    expect(h.turnTracker.isBusy(key)).toBe(true);

    await jest.advanceTimersByTimeAsync(TURN_WATCHDOG_MS);
    await jest.advanceTimersByTimeAsync(0);

    expect(h.gateway.completeOutboundTurn).toHaveBeenCalledTimes(1);
    expect(h.turnTracker.isBusy(key)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('GatewayChatBridge — typing indicator (TASK_2026_271)', () => {
  // Mirrors the module-private `TYPING_REARM_MS` in gateway-chat-bridge.ts,
  // the same way TURN_WATCHDOG_MS is mirrored above.
  const TYPING_REARM_MS = 8_000;

  /** Advance zero-length ticks (never the 8 s interval) until `predicate`. */
  async function settle(predicate: () => boolean, ticks = 10): Promise<void> {
    for (let i = 0; i < ticks && !predicate(); i++) {
      await jest.advanceTimersByTimeAsync(0);
    }
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('types once when the turn starts, re-arms while it runs, and stops when it ends', async () => {
    jest.useFakeTimers();
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    h.adapter.startChatSession.mockResolvedValue(
      gatedStream(gate, [textDelta(SDK_UUID, 'hi'), messageComplete(SDK_UUID)]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'hello agent'));

    // Immediate ping — the user sees the bot react before the first token.
    await settle(() => h.gateway.sendTyping.mock.calls.length > 0);
    expect(h.gateway.sendTyping).toHaveBeenCalledTimes(1);
    expect(h.gateway.sendTyping.mock.calls[0][0]).toMatchObject({
      platform: 'telegram',
      externalChatId: 'chat-1',
    });

    // A long tool call / approval wait: the indicator is re-armed, not dropped.
    await jest.advanceTimersByTimeAsync(TYPING_REARM_MS * 3);
    expect(h.gateway.sendTyping).toHaveBeenCalledTimes(4);

    release();
    await settle(() => h.gateway.completeOutboundTurn.mock.calls.length > 0);
    expect(h.gateway.completeOutboundTurn).toHaveBeenCalledTimes(1);

    // Turn over — the interval was cleared, so nothing keeps typing.
    const afterTurn = h.gateway.sendTyping.mock.calls.length;
    await jest.advanceTimersByTimeAsync(TYPING_REARM_MS * 3);
    expect(h.gateway.sendTyping).toHaveBeenCalledTimes(afterTurn);
  });

  it('stops typing when the watchdog force-terminates a hung turn', async () => {
    jest.useFakeTimers();
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.startChatSession.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        await new Promise<void>(() => {
          /* never resolves */
        });
        yield textDelta(SDK_UUID, 'unreachable');
      },
    } as AsyncIterable<FlatStreamEventUnion>);

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'hangs'));

    await jest.advanceTimersByTimeAsync(10 * 60_000); // TURN_WATCHDOG_MS
    await settle(() => h.gateway.completeOutboundTurn.mock.calls.length > 0);

    const afterWatchdog = h.gateway.sendTyping.mock.calls.length;
    expect(afterWatchdog).toBeGreaterThan(1); // it did keep typing while hung
    await jest.advanceTimersByTimeAsync(TYPING_REARM_MS * 3);
    expect(h.gateway.sendTyping).toHaveBeenCalledTimes(afterWatchdog);
  });

  it('never types for a turn that fails closed before it starts', async () => {
    // No binding root, no active workspace -> the turn is rejected up front.
    const h = setup({ workspaceRoot: null });
    const binding = makeBinding({ workspaceRoot: null });

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'hello agent'));
    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length > 0);

    expect(h.adapter.startChatSession).not.toHaveBeenCalled();
    expect(h.gateway.sendTyping).not.toHaveBeenCalled();
  });
});

const INTERRUPTED_NOTICE =
  'Ptah restarted while working on your last message. Please send it again.';

describe('GatewayChatBridge — inbound turn state (TASK_2026_277)', () => {
  /** Advance zero-length ticks until `predicate` (fake-timer specs only). */
  async function settle(predicate: () => boolean, ticks = 10): Promise<void> {
    for (let i = 0; i < ticks && !predicate(); i++) {
      await jest.advanceTimersByTimeAsync(0);
    }
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it("marks the row 'running' at turn start and 'done' in the finally", async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'hi'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit(
      'inbound',
      makeEvent(binding, 'hello', { messageId: 'gwmsg-7' }),
    );
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    expect(h.gateway.markInboundTurnState.mock.calls).toEqual([
      ['gwmsg-7', 'running'],
      ['gwmsg-7', 'done'],
    ]);
  });

  it("marks 'failed' when the agent turn throws", async () => {
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.startChatSession.mockRejectedValue(new Error('sdk exploded'));

    h.bridge.start();
    h.gateway.emit(
      'inbound',
      makeEvent(binding, 'hello', { messageId: 'gwmsg-7' }),
    );
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    expect(h.gateway.markInboundTurnState).toHaveBeenLastCalledWith(
      'gwmsg-7',
      'failed',
    );
  });

  it("marks 'failed' when the turn fails closed on workspace resolution", async () => {
    const h = setup({ workspaceRoot: null });
    const binding = makeBinding({ workspaceRoot: null });

    h.bridge.start();
    h.gateway.emit(
      'inbound',
      makeEvent(binding, 'hello', { messageId: 'gwmsg-7' }),
    );
    await flushUntil(() => h.gateway.drainOutbound.mock.calls.length > 0);

    // A turn that never reached the SDK still leaves a terminal state, or the
    // next boot would tell the user to resend a message that WAS answered.
    expect(h.gateway.markInboundTurnState.mock.calls).toEqual([
      ['gwmsg-7', 'running'],
      ['gwmsg-7', 'failed'],
    ]);
  });

  it("marks 'failed' when the watchdog force-terminates the turn", async () => {
    jest.useFakeTimers();
    const h = setup();
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.startChatSession.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        await new Promise<void>(() => {
          /* never resolves */
        });
        yield textDelta(SDK_UUID, 'unreachable');
      },
    } as AsyncIterable<FlatStreamEventUnion>);

    h.bridge.start();
    h.gateway.emit(
      'inbound',
      makeEvent(binding, 'hangs', { messageId: 'gwmsg-7' }),
    );
    await jest.advanceTimersByTimeAsync(10 * 60_000); // TURN_WATCHDOG_MS
    await settle(() => h.gateway.completeOutboundTurn.mock.calls.length > 0);

    expect(h.gateway.markInboundTurnState).toHaveBeenLastCalledWith(
      'gwmsg-7',
      'failed',
    );
  });
});

describe('GatewayChatBridge.start — interrupted-turn recovery (TASK_2026_277)', () => {
  function routeFor(
    conversationId?: string,
  ): InterruptedInboundConversation['route'] {
    return {
      conversationKey: ConversationKey.for(
        'telegram',
        'chat-1',
        conversationId,
      ),
      platform: 'telegram',
      externalChatId: 'chat-1',
      ...(conversationId !== undefined ? { conversationId } : {}),
    };
  }

  it('sends exactly one notice per interrupted conversation and starts no turn', async () => {
    const h = setup();
    h.gateway.claimInterruptedInboundTurns.mockReturnValue([
      { route: routeFor(), messageCount: 3 },
      { route: routeFor('thread-9'), messageCount: 1 },
    ]);

    h.bridge.start();
    await flushUntil(() => h.gateway.sendNotice.mock.calls.length >= 2);

    expect(h.gateway.sendNotice).toHaveBeenCalledTimes(2);
    expect(h.gateway.sendNotice).toHaveBeenNthCalledWith(
      1,
      routeFor(),
      INTERRUPTED_NOTICE,
    );
    expect(h.gateway.sendNotice).toHaveBeenNthCalledWith(
      2,
      routeFor('thread-9'),
      INTERRUPTED_NOTICE,
    );
    // NEVER replay: a dead turn may already have run Write/Bash.
    expect(h.adapter.startChatSession).not.toHaveBeenCalled();
    expect(h.adapter.resumeSession).not.toHaveBeenCalled();
    expect(h.gateway.appendOutboundChunk).not.toHaveBeenCalled();
    expect(h.gateway.completeOutboundTurn).not.toHaveBeenCalled();
  });

  it('sends the exact resend wording', async () => {
    const h = setup();
    h.gateway.claimInterruptedInboundTurns.mockReturnValue([
      { route: routeFor(), messageCount: 1 },
    ]);

    h.bridge.start();
    await flushUntil(() => h.gateway.sendNotice.mock.calls.length > 0);

    expect(h.gateway.sendNotice.mock.calls[0][1]).toBe(
      'Ptah restarted while working on your last message. Please send it again.',
    );
  });

  it('does nothing when there was nothing in flight', async () => {
    const h = setup();
    h.gateway.claimInterruptedInboundTurns.mockReturnValue([]);

    h.bridge.start();
    await flushUntil(() => false, 3);

    expect(h.gateway.sendNotice).not.toHaveBeenCalled();
  });

  it('keeps going — and never throws out of start() — when a notice fails to send', async () => {
    const h = setup();
    h.gateway.claimInterruptedInboundTurns.mockReturnValue([
      { route: routeFor('thread-a'), messageCount: 1 },
      { route: routeFor('thread-b'), messageCount: 1 },
    ]);
    h.gateway.sendNotice.mockRejectedValueOnce(new Error('Unknown Channel'));

    expect(() => h.bridge.start()).not.toThrow();
    await flushUntil(() => h.gateway.sendNotice.mock.calls.length >= 2);

    // The rows are already claimed by `claimInterruptedInboundTurns`, so the
    // failed notice is lost rather than retried — and the second conversation
    // is still told.
    expect(h.gateway.sendNotice).toHaveBeenCalledTimes(2);
  });

  it('survives a claim that throws, and still subscribes to inbound', async () => {
    const h = setup();
    h.gateway.claimInterruptedInboundTurns.mockImplementation(() => {
      throw new Error('database is locked');
    });
    const binding = makeBinding({ workspaceRoot: '/ws/proj' });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'hi'),
        messageComplete(SDK_UUID),
      ]),
    );

    expect(() => h.bridge.start()).not.toThrow();
    h.gateway.emit('inbound', makeEvent(binding, 'still works'));
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    expect(h.gateway.sendNotice).not.toHaveBeenCalled();
    expect(h.adapter.startChatSession).toHaveBeenCalledTimes(1);
  });

  it('does not sweep again on a second start() while already subscribed', async () => {
    const h = setup();
    h.gateway.claimInterruptedInboundTurns.mockReturnValue([
      { route: routeFor(), messageCount: 1 },
    ]);

    h.bridge.start();
    h.bridge.start();
    await flushUntil(() => h.gateway.sendNotice.mock.calls.length > 0);

    expect(h.gateway.claimInterruptedInboundTurns).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// A turn that ends early must not leak its text into the NEXT turn
// (TASK_2026_271 blocker A — verification review 2026-08-18)
// ---------------------------------------------------------------------------
const DELIVERY_FAILED_MESSAGE =
  'Ptah finished this request but could not deliver the reply here. Please try again.';

describe('GatewayChatBridge — a failed turn never pollutes the next reply', () => {
  /**
   * These specs run the real {@link StreamCoalescer} (see
   * {@link DeliveringGateway}) and always assert on the SECOND turn's delivered
   * body. Asserting that `discardOutbound` was called would pass against a
   * `drain`-only implementation too, because the mock has no buffer to leak.
   */
  function twoTurnHarness(): {
    h: Harness;
    gateway: DeliveringGateway;
    binding: GatewayBinding;
  } {
    const gateway = new DeliveringGateway();
    const h = setup({ gateway, workspaceFolders: ['/ws/proj'] });
    return {
      h,
      gateway,
      binding: makeBinding({ workspaceRoot: '/ws/proj' }),
    };
  }

  /** A second turn on the SAME conversation key that replies normally. */
  async function runSecondTurn(
    h: Harness,
    gateway: DeliveringGateway,
    binding: GatewayBinding,
  ): Promise<void> {
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'second reply'),
        messageComplete(SDK_UUID),
      ]),
    );
    const delivered = gateway.delivered.length;
    h.gateway.emit(
      'inbound',
      makeEvent(binding, 'try again', {
        conversation: makeConversation(binding, { workspaceRoot: null }),
      }),
    );
    await flushUntil(() => gateway.delivered.length > delivered);
  }

  it('a turn that fails closed on a revoked workspace root leaves nothing behind for the next turn', async () => {
    const { h, gateway, binding } = twoTurnHarness();

    h.bridge.start();
    // Turn 1: conversation pinned to a root that left the allowlist — the
    // fail-closed early return, which happens BEFORE the end-of-turn seal is
    // wired and so has to clean up after itself.
    h.gateway.emit(
      'inbound',
      makeEvent(binding, 'go', {
        conversation: makeConversation(binding, { workspaceRoot: '/ws/gone' }),
      }),
    );
    await flushUntil(() => gateway.delivered.length > 0);
    expect(gateway.delivered).toEqual([WORKSPACE_UNAVAILABLE_MESSAGE]);
    expect(h.adapter.startChatSession).not.toHaveBeenCalled();

    // Turn 2 on the same conversation key resolves fine and answers.
    await runSecondTurn(h, gateway, binding);

    expect(gateway.delivered).toHaveLength(2);
    expect(gateway.delivered[1]).toBe('second reply');
    expect(gateway.delivered[1]).not.toContain('no longer available');
  });

  it('a turn that fails closed because the root vanished on disk leaves nothing behind either', async () => {
    const { h, gateway, binding } = twoTurnHarness();
    accessMock.mockRejectedValueOnce(new Error('ENOENT'));

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
    await flushUntil(() => gateway.delivered.length > 0);
    expect(gateway.delivered).toEqual([WORKSPACE_UNAVAILABLE_MESSAGE]);

    await runSecondTurn(h, gateway, binding);

    expect(gateway.delivered).toHaveLength(2);
    expect(gateway.delivered[1]).toBe('second reply');
    expect(gateway.delivered[1]).not.toContain('no longer available');
  });

  it('the post-seal delivery-failure reply does not survive into the next turn', async () => {
    const { h, gateway, binding } = twoTurnHarness();
    // The seal throws — the reply was generated but the platform rejected it —
    // so the bridge sends DELIVERY_FAILED_MESSAGE *after* `completeOutboundTurn`
    // already reset the buffer. That reply is the third entrance to the same
    // bug: nothing seals again behind it.
    gateway.completeOutboundTurn.mockImplementationOnce(async (key) => {
      // Production `completeTurn` resets the buffer in a `finally` even when
      // the flush throws — only the error propagates.
      gateway.discardOutbound(key);
      throw new Error('Missing Permissions');
    });
    h.adapter.startChatSession.mockResolvedValue(
      await scriptedStream([
        textDelta(SDK_UUID, 'first reply'),
        messageComplete(SDK_UUID),
      ]),
    );

    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, 'go'));
    await flushUntil(() => gateway.delivered.length > 0);
    expect(gateway.delivered).toEqual([DELIVERY_FAILED_MESSAGE]);

    await runSecondTurn(h, gateway, binding);

    expect(gateway.delivered).toHaveLength(2);
    expect(gateway.delivered[1]).toBe('second reply');
    expect(gateway.delivered[1]).not.toContain('could not deliver');
  });
});
