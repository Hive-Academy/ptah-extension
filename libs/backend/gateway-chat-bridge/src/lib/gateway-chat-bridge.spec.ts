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

import { EventEmitter } from 'node:events';
import { GatewayChatBridge } from './gateway-chat-bridge';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  BindingId,
  ConversationKey,
  type ConversationStore,
  type GatewayBinding,
  type GatewayConversation,
  type GatewayConversationId,
  type GatewayInboundEvent,
  type GatewayService,
  type OutboundRoute,
} from '@ptah-extension/messaging-gateway';
import type {
  FlatStreamEventUnion,
  IAgentAdapter,
} from '@ptah-extension/shared';

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
    createdAt: 1,
    lastActiveAt: 1,
  };
}

function makeEvent(
  binding: GatewayBinding,
  body: string,
  opts: { conversation?: GatewayConversation; conversationId?: string } = {},
): GatewayInboundEvent {
  const conversation = opts.conversation ?? makeConversation(binding);
  return {
    binding,
    conversation,
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
  workspace: jest.Mocked<Pick<IWorkspaceProvider, 'getWorkspaceRoot'>>;
  selectedModelGet: jest.Mock<string, []>;
  licenseService: { verifyLicense: jest.Mock };
  codeExecutionMcp: {
    getPort: jest.Mock;
    ensureRegisteredForSubagents: jest.Mock;
  };
  enhancedPromptsService: { getEnhancedPromptContent: jest.Mock };
  pluginLoader: {
    getWorkspacePluginConfig: jest.Mock;
    resolvePluginPaths: jest.Mock;
  };
}

function setup(options?: {
  workspaceRoot?: string | null;
  selectedModel?: string;
  licenseStatus?: unknown;
  mcpPort?: number | null;
  enhancedPromptsContent?: string | null;
  enabledPluginIds?: string[];
  resolvedPluginPaths?: string[];
}): Harness {
  const gateway = new FakeGateway();
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
    getWorkspaceRoot: jest
      .fn()
      .mockReturnValue(
        options?.workspaceRoot === undefined
          ? '/ws/global'
          : options.workspaceRoot,
      ),
  } as unknown as Harness['workspace'];
  const selectedModelGet = jest
    .fn<string, []>()
    .mockReturnValue(options?.selectedModel ?? '');
  const modelSettings = {
    selectedModel: { get: selectedModelGet },
  };

  const licenseService = {
    verifyLicense: jest
      .fn()
      .mockResolvedValue(options?.licenseStatus ?? { tier: 'free' }),
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

  const ctorArgs = [
    createLogger(),
    gateway as unknown as GatewayService,
    conversations as unknown as ConversationStore,
    adapter as unknown as IAgentAdapter,
    workspace as unknown as IWorkspaceProvider,
    modelSettings,
    licenseService,
    codeExecutionMcp,
    enhancedPromptsService,
    pluginLoader,
  ] as unknown as ConstructorParameters<typeof GatewayChatBridge>;
  const bridge = new GatewayChatBridge(...ctorArgs);
  return {
    bridge,
    gateway,
    conversations,
    adapter,
    workspace,
    selectedModelGet,
    licenseService,
    codeExecutionMcp,
    enhancedPromptsService,
    pluginLoader,
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

  it('auto-approves via the initial yolo permission level, not a post-hoc bypass flip', async () => {
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
      'yolo',
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
    await flushUntil(
      () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
    );

    expect(h.adapter.startChatSession).not.toHaveBeenCalled();
    expect(h.adapter.resumeSession).not.toHaveBeenCalled();
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledTimes(1);
    expect(h.gateway.appendOutboundChunk.mock.calls[0][0].conversationKey).toBe(
      key,
    );
    expect(h.gateway.drainOutbound).toHaveBeenCalledWith(key);
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
// F1 — permissionLevel: 'yolo' on resume (TASK_2026_155, Task 2.1/3.3)
// ---------------------------------------------------------------------------
//
// `startChatSession` carrying `permissionLevel: 'yolo'` and `bindSession`
// never calling `setSessionPermissionLevel` are already exercised by
// 'auto-approves via the initial yolo permission level...' above. These two
// specs close the remaining acceptance-criteria gaps: BOTH `resumeSession`
// call sites (the canResume fast path and the try/catch resume-recovery
// path) must also carry `permissionLevel: 'yolo'`, and `bindSession` must
// still persist the sessionId even though it no longer flips permissions.
describe('GatewayChatBridge — F1 resume permissionLevel + bindSession (Task 2.1/2.2/3.3)', () => {
  it('resumeSession receives permissionLevel: "yolo" on the canResume fast path', async () => {
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
      'yolo',
    );
  });

  it('resumeSession receives permissionLevel: "yolo" on the try/catch resume-recovery path (persisted but not active)', async () => {
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
      'yolo',
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
          msg === 'This request took too long and was stopped. Please try again.',
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
          msg === 'This request took too long and was stopped. Please try again.',
      ),
    ).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F4 — premium parity (TASK_2026_155, Task 2.4/3.3)
// ---------------------------------------------------------------------------
describe('GatewayChatBridge — premium parity (Task 2.4/3.3)', () => {
  it('premium license + live MCP port: startChatSession receives isPremium true, mcpServerRunning true, and resolved prompts/plugins', async () => {
    const h = setup({
      licenseStatus: { valid: true, tier: 'pro' },
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
    expect(config.isPremium).toBe(true);
    expect(config.mcpServerRunning).toBe(true);
    expect(config.enhancedPromptsContent).toBe('ENHANCED SYSTEM PROMPT');
    expect(config.pluginPaths).toEqual(['/plugins/plugin-a']);
    expect(h.codeExecutionMcp.ensureRegisteredForSubagents).toHaveBeenCalled();
  });

  it('non-premium license: startChatSession receives isPremium false, undefined prompts/plugins, and the turn still completes', async () => {
    const h = setup({
      licenseStatus: { valid: false, tier: 'free' },
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
    expect(config.isPremium).toBe(false);
    expect(config.mcpServerRunning).toBe(false);
    expect(config.enhancedPromptsContent).toBeUndefined();
    expect(config.pluginPaths).toBeUndefined();
    expect(
      h.codeExecutionMcp.ensureRegisteredForSubagents,
    ).not.toHaveBeenCalled();
    expect(h.gateway.completeOutboundTurn).toHaveBeenCalledTimes(1);
  });
});
