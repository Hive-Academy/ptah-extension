import 'reflect-metadata';

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

jest.mock('node:fs/promises', () => {
  const actual =
    jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    access: jest.fn(async () => undefined),
  };
});

import { EventEmitter } from 'node:events';
import { GatewayChatBridge } from './gateway-chat-bridge';
import {
  BindingId,
  ConversationKey,
  ConversationTurnTracker,
  type GatewayBinding,
  type GatewayConversation,
  type GatewayConversationId,
  type GatewayInboundEvent,
  type GatewayTurnState,
  type InterruptedInboundConversation,
  type OutboundRoute,
} from '@ptah-extension/messaging-gateway';
import {
  SessionId,
  type AgentSessionResumeConfig,
  type AgentSessionStartConfig,
  type FlatStreamEventUnion,
  type ProviderProfile,
  type RuntimeHostCapabilities,
  type SessionRuntimeIdentity,
} from '@ptah-extension/shared';
import type {
  ExecutionProfileRequest,
  ResolvedExecutionProfile,
} from '@ptah-extension/auth-providers';
import {
  type PermissionPromptLifecycleEvent,
  type SessionRuntimeIdentityLookup,
} from '@ptah-extension/agent-sdk';
import {
  CodexResumeProfileChangedError,
  CODEX_RESUME_PROFILE_CHANGED_MESSAGE,
} from '@ptah-extension/codex-runtime';

const SDK_UUID = '11111111-2222-4333-8444-555555555555';
const GENERIC_FAILURE = 'Ptah could not complete this request. Please try again.';
const PROFILE: ProviderProfile = {
  providerId: 'openrouter',
  authEnv: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:4000' },
  model: 'claude-sonnet-4',
};

type BridgeDeps = ConstructorParameters<typeof GatewayChatBridge>;

type AssertAssignable<T extends U, U> = T;

type ConsumedLogger = Pick<BridgeDeps[0], 'debug' | 'info' | 'warn' | 'error'>;

type ConsumedModelSettings = {
  readonly selectedModel: { get(): string };
};

type _LoggerCoversConsumed = AssertAssignable<BridgeDeps[0], ConsumedLogger>;
type _ModelCoversConsumed = AssertAssignable<
  BridgeDeps[5],
  ConsumedModelSettings
>;

/**
 * Constructor parameters that are classes stay nominal because of private
 * fields, so a structural double is not assignable to them. Callers check the
 * consumed surface first. This only confirms those methods exist, then brands
 * the same object.
 */
function hasConsumedMethods<B extends object>(
  value: object,
  methods: readonly string[],
): value is B {
  return methods.every(
    (method) => typeof Reflect.get(value, method) === 'function',
  );
}

function requireConsumed<B extends object>(value: object, methods: readonly string[]): B {
  if (!hasConsumedMethods<B>(value, methods)) {
    throw new Error(
      `gateway bridge double is missing a consumed method: ${methods.join(', ')}`,
    );
  }
  return value;
}

function createLogger(): BridgeDeps[0] {
  const logger: ConsumedLogger = {
    debug(_message: string, ..._args: unknown[]): void {
      void _message;
      void _args;
    },
    info(_message: string, ..._args: unknown[]): void {
      void _message;
      void _args;
    },
    warn(_message: string, ..._args: unknown[]): void {
      void _message;
      void _args;
    },
    error(
      _message: string | Error,
      _errorOrContext?: Error | Record<string, unknown>,
    ): void {
      void _message;
      void _errorOrContext;
    },
  };
  return requireConsumed<BridgeDeps[0]>(logger, [
    'debug',
    'info',
    'warn',
    'error',
  ]);
}

function createWorkspace(): BridgeDeps[4] {
  return {
    getWorkspaceRoot: () => '/ws/global',
    getWorkspaceFolders: () => [],
    getConfiguration: <T>(
      _section: string,
      _key: string,
      defaultValue?: T,
    ): T | undefined => defaultValue,
    setConfiguration: () => Promise.resolve(),
    onDidChangeConfiguration: () => ({ dispose: () => undefined }),
    onDidChangeWorkspaceFolders: () => ({ dispose: () => undefined }),
  };
}

function hasModelSettings(
  value: ConsumedModelSettings,
): value is BridgeDeps[5] {
  return typeof value.selectedModel.get === 'function';
}

function createModelSettings(): BridgeDeps[5] {
  const get = jest.fn<string, []>().mockReturnValue('opus');
  const settings: ConsumedModelSettings = {
    selectedModel: { get: () => get() },
  };
  if (!hasModelSettings(settings)) {
    throw new Error('model settings double is missing get');
  }
  return settings;
}

class FakeGateway extends EventEmitter {
  appendOutboundChunk = jest.fn<void, [OutboundRoute, string]>();
  drainOutbound = jest.fn<Promise<void>, [ConversationKey]>(async () => undefined);
  completeOutboundTurn = jest.fn<Promise<void>, [ConversationKey]>(
    async () => undefined,
  );
  sendNotice = jest.fn<Promise<void>, [OutboundRoute, string]>(
    async () => undefined,
  );
  sendTyping = jest.fn<Promise<void>, [OutboundRoute]>(async () => undefined);
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

class FakePermissionHandler {
  listener: ((event: PermissionPromptLifecycleEvent) => void) | null = null;
  onPromptLifecycle = jest.fn(
    (listener: (event: PermissionPromptLifecycleEvent) => void): (() => void) => {
      this.listener = listener;
      return () => {
        this.listener = null;
      };
    },
  );
  /** Same channel `publishPromptLifecycle` delivers to bridge subscribers. */
  publish(event: PermissionPromptLifecycleEvent): void {
    this.listener?.(event);
  }
}

function makeBinding(): GatewayBinding {
  return {
    id: BindingId.create('binding-1'),
    platform: 'telegram',
    externalChatId: 'chat-1',
    allowListId: null,
    displayName: null,
    approvalStatus: 'approved',
    ptahSessionId: null,
    workspaceRoot: '/ws/proj',
    pairingCode: null,
    createdAt: 1,
    approvedAt: 1,
    lastActiveAt: 1,
  };
}

function makeConversation(
  binding: GatewayBinding,
  ptahSessionId: string | null,
): GatewayConversation {
  return {
    id: 'conv-42' as GatewayConversationId,
    bindingId: binding.id,
    externalConversationId: 'default',
    ptahSessionId,
    workspaceRoot: null,
    createdAt: 1,
    lastActiveAt: 1,
  };
}

function makeEvent(
  binding: GatewayBinding,
  conversation: GatewayConversation,
  body: string,
): GatewayInboundEvent {
  return {
    binding,
    conversation,
    messageId: 'gwmsg-1',
    message: {
      platform: binding.platform,
      externalChatId: binding.externalChatId,
      externalMsgId: 'm-1',
      body,
      conversationKey: ConversationKey.for(
        binding.platform,
        binding.externalChatId,
      ),
    },
  } as GatewayInboundEvent;
}

function textDelta(
  sessionId: string,
  delta: string,
  extra: {
    source?: 'stream' | 'complete' | 'history';
    messageId?: string;
    blockIndex?: number;
  } = {},
): FlatStreamEventUnion {
  const messageId = extra.messageId ?? 'msg-1';
  const blockIndex = extra.blockIndex ?? 0;
  return {
    id: `t-${messageId}-${blockIndex}-${delta}`,
    eventType: 'text_delta',
    timestamp: 1,
    sessionId,
    ...(extra.source !== undefined ? { source: extra.source } : {}),
    messageId,
    delta,
    blockIndex,
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

function scriptedStream(
  events: FlatStreamEventUnion[],
): AsyncIterable<FlatStreamEventUnion> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
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
      for (const event of events) {
        yield event;
      }
    },
  };
}

async function flushUntil(predicate: () => boolean, attempts = 50): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return;
    await Promise.resolve();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

function nativeIdentity(sessionId: SessionId): SessionRuntimeIdentity {
  return {
    version: 1,
    sessionId,
    providerId: 'openai-codex',
    workspaceId: '/ws/proj',
    runtime: 'codex-app-server',
    codex: { normalizedHome: 'c:\\codex-home' },
  };
}

function nativeLookup(sessionId: string): SessionRuntimeIdentityLookup {
  const id = SessionId.from(sessionId);
  return {
    lookup: (requested) =>
      requested === id ? { persisted: nativeIdentity(id) } : undefined,
  };
}

function legacyClaudeIdentity(sessionId: string): SessionRuntimeIdentity {
  return {
    version: 1,
    sessionId: SessionId.from(sessionId),
    runtime: 'claude-sdk',
    providerId: 'claude-cli',
    workspaceId: '/ws/proj',
  };
}

/** Lookup is present and the session has no runtime metadata. */
function undefinedMetadataLookup(): SessionRuntimeIdentityLookup {
  return {
    lookup: () => undefined,
  };
}

/**
 * Binding exists but carries no identity, so
 * `resolveSessionRuntimeIdentity` throws `SessionRuntimeRoutingError`.
 */
function throwingIdentityLookup(): SessionRuntimeIdentityLookup {
  return {
    lookup: () => ({}),
  };
}

interface NativeHarness {
  bridge: GatewayChatBridge;
  gateway: FakeGateway;
  conversations: { setPtahSessionId: jest.Mock<void, [GatewayConversationId, string]> };
  startChatSession: jest.Mock<
    Promise<AsyncIterable<FlatStreamEventUnion>>,
    [AgentSessionStartConfig]
  >;
  resumeSession: jest.Mock<
    Promise<AsyncIterable<FlatStreamEventUnion>>,
    [SessionId, AgentSessionResumeConfig?]
  >;
  isSessionActive: jest.Mock<boolean, [SessionId]>;
  permissionHandler: FakePermissionHandler;
  resolveExecutionProfile: jest.Mock<
    Promise<ResolvedExecutionProfile>,
    [ExecutionProfileRequest]
  >;
  resolveProviderProfileForWorkspace: jest.Mock<
    Promise<ProviderProfile | undefined>,
    [string, string]
  >;
}

function setup(options: {
  hostCapabilities: RuntimeHostCapabilities;
  identities?: SessionRuntimeIdentityLookup;
}): NativeHarness {
  const gateway = new FakeGateway();
  const conversations = {
    setPtahSessionId: jest.fn<void, [GatewayConversationId, string]>(),
  };
  const startChatSession = jest.fn<
    Promise<AsyncIterable<FlatStreamEventUnion>>,
    [AgentSessionStartConfig]
  >();
  const resumeSession = jest.fn<
    Promise<AsyncIterable<FlatStreamEventUnion>>,
    [SessionId, AgentSessionResumeConfig?]
  >();
  const isSessionActive = jest.fn<boolean, [SessionId]>().mockReturnValue(false);
  const permissionHandler = new FakePermissionHandler();
  const resolveProviderProfileForWorkspace = jest.fn<
    Promise<ProviderProfile | undefined>,
    [string, string]
  >(async () => {
    throw new Error('native turn must not build a provider profile');
  });
  const resolveExecutionProfile = jest.fn<
    Promise<ResolvedExecutionProfile>,
    [ExecutionProfileRequest]
  >(async (input) => {
    // Same branch order as WorkspaceProviderProfileResolver: a stored native
    // identity resumes native; a fresh turn starts native only when the
    // gateway capability is on; any Claude identity stays on Claude.
    const resumeNative = input.existingIdentity?.runtime === 'codex-app-server';
    const startNative =
      input.existingIdentity === undefined &&
      input.hostCapabilities.nativeCodexGateway === true;
    if (resumeNative || startNative) {
      return {
        runtime: 'codex-app-server',
        seed: {
          providerId: 'openai-codex',
          consumer: input.consumer,
          workspacePath: input.workspacePath,
          home: 'C:\\codex-home',
          normalizedHome: 'c:\\codex-home',
          model: 'gpt-5.4',
        },
      };
    }
    return {
      runtime: 'claude-sdk',
      model: input.requestedModel,
      providerProfile: PROFILE,
    };
  });
  const agentDouble: Pick<
    BridgeDeps[3],
    | 'startChatSession'
    | 'resumeSession'
    | 'isSessionActive'
    | 'setSessionPermissionLevel'
    | 'endSession'
  > = {
    startChatSession: (config) => startChatSession(config),
    resumeSession: (sessionId, config) => resumeSession(sessionId, config),
    isSessionActive: (sessionId) => isSessionActive(sessionId),
    setSessionPermissionLevel: () => Promise.resolve(),
    endSession: () => undefined,
  };
  const conversationsDouble: Pick<BridgeDeps[2], 'setPtahSessionId'> = {
    setPtahSessionId: (id, sessionId) => {
      conversations.setPtahSessionId(id, sessionId);
      return {
        id,
        bindingId: BindingId.create('binding-1'),
        externalConversationId: 'default',
        ptahSessionId: sessionId,
        workspaceRoot: null,
        createdAt: 0,
        lastActiveAt: 0,
      };
    },
  };
  const getPort = jest.fn<number | null, []>().mockReturnValue(4319);
  const ensureRegisteredForSubagents = jest
    .fn<Promise<{ registered: boolean }>, []>()
    .mockResolvedValue({ registered: true });
  const mcpDouble: Pick<
    BridgeDeps[6],
    'getPort' | 'ensureRegisteredForSubagents'
  > = {
    getPort: () => getPort(),
    ensureRegisteredForSubagents: () => ensureRegisteredForSubagents(),
  };
  const getEnhancedPromptContent = jest
    .fn<Promise<string | null>, [string]>()
    .mockResolvedValue(null);
  const promptsDouble: Pick<BridgeDeps[7], 'getEnhancedPromptContent'> = {
    getEnhancedPromptContent: (workspacePath) =>
      getEnhancedPromptContent(workspacePath),
  };
  const resolveStoredModel = jest.fn<string, [string, string]>(
    (_path, model) => model || 'default',
  );
  const resolverDouble: Pick<
    BridgeDeps[10],
    | 'resolveStoredModel'
    | 'resolveProviderProfileForWorkspace'
    | 'resolveExecutionProfile'
  > = {
    resolveStoredModel: (workspacePath, storedModel) =>
      resolveStoredModel(workspacePath, storedModel),
    resolveProviderProfileForWorkspace: (workspacePath, requestedModel) =>
      resolveProviderProfileForWorkspace(workspacePath, requestedModel),
    resolveExecutionProfile: (input) => resolveExecutionProfile(input),
  };
  const gatewayDouble: Pick<
    BridgeDeps[1],
    | 'appendOutboundChunk'
    | 'drainOutbound'
    | 'completeOutboundTurn'
    | 'sendNotice'
    | 'sendTyping'
    | 'discardOutbound'
    | 'recordTurnOutcome'
    | 'markInboundTurnState'
    | 'claimInterruptedInboundTurns'
  > = {
    appendOutboundChunk: (route, chunk) => {
      gateway.appendOutboundChunk(route, chunk);
    },
    drainOutbound: (key) => gateway.drainOutbound(key),
    completeOutboundTurn: (key) => gateway.completeOutboundTurn(key),
    sendNotice: (route, text) => gateway.sendNotice(route, text),
    sendTyping: (route) => gateway.sendTyping(route),
    discardOutbound: (key) => gateway.discardOutbound(key),
    recordTurnOutcome: (platform, outcome) => {
      gateway.recordTurnOutcome(platform, outcome);
    },
    markInboundTurnState: (messageId, state) => {
      gateway.markInboundTurnState(messageId, state);
    },
    claimInterruptedInboundTurns: () => gateway.claimInterruptedInboundTurns(),
  };
  const gatewayForBridge = {
    on(event: string | symbol, listener: (...args: unknown[]) => void): void {
      gateway.on(event, listener);
    },
    off(event: string | symbol, listener: (...args: unknown[]) => void): void {
      gateway.off(event, listener);
    },
    appendOutboundChunk: gatewayDouble.appendOutboundChunk,
    drainOutbound: gatewayDouble.drainOutbound,
    completeOutboundTurn: gatewayDouble.completeOutboundTurn,
    sendNotice: gatewayDouble.sendNotice,
    sendTyping: gatewayDouble.sendTyping,
    discardOutbound: gatewayDouble.discardOutbound,
    recordTurnOutcome: gatewayDouble.recordTurnOutcome,
    markInboundTurnState: gatewayDouble.markInboundTurnState,
    claimInterruptedInboundTurns: gatewayDouble.claimInterruptedInboundTurns,
  };
  const permissionDouble: Pick<BridgeDeps[9], 'onPromptLifecycle'> = {
    onPromptLifecycle: (listener) => permissionHandler.onPromptLifecycle(listener),
  };
  const deps = [
    createLogger(),
    requireConsumed<BridgeDeps[1]>(gatewayForBridge, [
      'on',
      'off',
      'appendOutboundChunk',
      'drainOutbound',
      'completeOutboundTurn',
      'sendNotice',
      'sendTyping',
      'discardOutbound',
      'recordTurnOutcome',
      'markInboundTurnState',
      'claimInterruptedInboundTurns',
    ]),
    requireConsumed<BridgeDeps[2]>(conversationsDouble, ['setPtahSessionId']),
    requireConsumed<BridgeDeps[3]>(agentDouble, [
      'startChatSession',
      'resumeSession',
      'isSessionActive',
      'setSessionPermissionLevel',
      'endSession',
    ]),
    createWorkspace(),
    createModelSettings(),
    requireConsumed<BridgeDeps[6]>(mcpDouble, [
      'getPort',
      'ensureRegisteredForSubagents',
    ]),
    requireConsumed<BridgeDeps[7]>(promptsDouble, ['getEnhancedPromptContent']),
    new ConversationTurnTracker(),
    requireConsumed<BridgeDeps[9]>(permissionDouble, ['onPromptLifecycle']),
    requireConsumed<BridgeDeps[10]>(resolverDouble, [
      'resolveStoredModel',
      'resolveProviderProfileForWorkspace',
      'resolveExecutionProfile',
    ]),
    options.hostCapabilities,
    options.identities,
  ] satisfies BridgeDeps;
  return {
    bridge: new GatewayChatBridge(...deps),
    gateway,
    conversations,
    startChatSession,
    resumeSession,
    isSessionActive,
    permissionHandler,
    resolveExecutionProfile,
    resolveProviderProfileForWorkspace,
  };
}

async function runTurn(
  h: NativeHarness,
  body: string,
  ptahSessionId: string | null,
): Promise<{ binding: GatewayBinding; conversation: GatewayConversation }> {
  const binding = makeBinding();
  const conversation = makeConversation(binding, ptahSessionId);
  h.bridge.start();
  h.gateway.emit('inbound', makeEvent(binding, conversation, body));
  await flushUntil(() => h.gateway.completeOutboundTurn.mock.calls.length > 0);
  return { binding, conversation };
}

describe('GatewayChatBridge native consumer', () => {
  const legacyCapabilities: RuntimeHostCapabilities = {
    nativeCodex: true,
    nativeCodexGateway: false,
  };
  const nativeCapabilities: RuntimeHostCapabilities = {
    nativeCodex: false,
    nativeCodexGateway: true,
  };

  it('keeps a legacy start with a provider profile when the gateway capability is off', async () => {
    const h = setup({ hostCapabilities: legacyCapabilities });
    h.startChatSession.mockResolvedValue(
      scriptedStream([textDelta(SDK_UUID, 'hi'), messageComplete(SDK_UUID)]),
    );

    await runTurn(h, 'hello agent', null);

    expect(h.resolveExecutionProfile).toHaveBeenCalledWith({
      workspacePath: '/ws/proj',
      requestedModel: 'opus',
      consumer: 'gateway',
      hostCapabilities: legacyCapabilities,
    });
    expect(h.resolveProviderProfileForWorkspace).not.toHaveBeenCalled();
    expect(h.startChatSession).toHaveBeenCalledTimes(1);
    expect(h.startChatSession.mock.calls[0][0]).toEqual({
      tabId: 'gw-conv-42',
      prompt: 'hello agent',
      projectPath: '/ws/proj',
      workspaceId: '/ws/proj',
      model: 'opus',
      includePartialMessages: true,
      permissionLevel: 'ask',
      mcpServerRunning: true,
      enhancedPromptsContent: undefined,
      providerProfile: PROFILE,
      consumer: 'gateway',
      runtime: 'claude-sdk',
    });
  });

  it('starts native Codex with no provider profile when the gateway capability is on', async () => {
    const h = setup({ hostCapabilities: nativeCapabilities });
    h.startChatSession.mockResolvedValue(
      scriptedStream([textDelta(SDK_UUID, 'hi'), messageComplete(SDK_UUID)]),
    );

    await runTurn(h, 'hello agent', null);

    expect(h.resolveExecutionProfile).toHaveBeenCalledWith({
      workspacePath: '/ws/proj',
      requestedModel: 'opus',
      consumer: 'gateway',
      hostCapabilities: nativeCapabilities,
    });
    expect(h.resolveProviderProfileForWorkspace).not.toHaveBeenCalled();
    expect(h.resumeSession).not.toHaveBeenCalled();
    expect(h.startChatSession.mock.calls[0][0]).toEqual({
      tabId: 'gw-conv-42',
      prompt: 'hello agent',
      projectPath: '/ws/proj',
      workspaceId: '/ws/proj',
      model: 'gpt-5.4',
      includePartialMessages: true,
      permissionLevel: 'ask',
      mcpServerRunning: true,
      enhancedPromptsContent: undefined,
      providerProfile: undefined,
      consumer: 'gateway',
      runtime: 'codex-app-server',
    });
  });

  it('replies once and keeps the binding when a native resume fails', async () => {
    const h = setup({
      hostCapabilities: nativeCapabilities,
      identities: nativeLookup(SDK_UUID),
    });
    h.resumeSession.mockRejectedValue(new Error('thread gone'));

    const { conversation } = await runTurn(h, 'again', SDK_UUID);

    expect(h.resumeSession).toHaveBeenCalledTimes(1);
    expect(h.resumeSession.mock.calls[0][1]?.consumer).toBe('gateway');
    expect(h.startChatSession).not.toHaveBeenCalled();
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledTimes(1);
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'telegram' }),
      GENERIC_FAILURE,
    );
    expect(h.conversations.setPtahSessionId).not.toHaveBeenCalled();
    expect(conversation.ptahSessionId).toBe(SDK_UUID);
  });

  it('replies with the Codex profile-changed message and does not start a new session', async () => {
    const h = setup({
      hostCapabilities: nativeCapabilities,
      identities: nativeLookup(SDK_UUID),
    });
    h.resumeSession.mockRejectedValue(new CodexResumeProfileChangedError());

    await runTurn(h, 'again', SDK_UUID);

    expect(h.startChatSession).not.toHaveBeenCalled();
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledTimes(1);
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'telegram' }),
      CODEX_RESUME_PROFILE_CHANGED_MESSAGE,
    );
    expect(h.conversations.setPtahSessionId).not.toHaveBeenCalled();
  });

  it('does not fall back when a native stream produces zero events', async () => {
    const h = setup({
      hostCapabilities: nativeCapabilities,
      identities: nativeLookup(SDK_UUID),
    });
    h.isSessionActive.mockReturnValue(true);
    h.resumeSession.mockResolvedValue(scriptedStream([]));

    await runTurn(h, 'again', SDK_UUID);

    expect(h.resumeSession).toHaveBeenCalledTimes(1);
    expect(h.startChatSession).not.toHaveBeenCalled();
    expect(h.conversations.setPtahSessionId).not.toHaveBeenCalled();
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledTimes(1);
  });

  it('relays a published permission lifecycle event addressed to the gw- tab', async () => {
    const h = setup({ hostCapabilities: nativeCapabilities });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      const done: () => void = () => {
        resolve();
      };
      release = done;
    });
    h.startChatSession.mockResolvedValue(
      gatedStream(gate, [textDelta(SDK_UUID, 'ok'), messageComplete(SDK_UUID)]),
    );
    const binding = makeBinding();
    const conversation = makeConversation(binding, null);
    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, conversation, 'write it'));
    await flushUntil(() => h.startChatSession.mock.calls.length > 0);

    try {
      h.permissionHandler.publish({
        phase: 'requested',
        requestId: 'req-1',
        routingHint: 'not-a-gateway-tab',
        toolName: 'Bash',
        description: 'run a command',
        routable: false,
        timeoutMs: 60_000,
      });
      expect(h.gateway.sendNotice).not.toHaveBeenCalled();

      h.permissionHandler.publish({
        phase: 'requested',
        requestId: 'req-1',
        routingHint: 'gw-conv-42',
        toolName: 'Bash',
        description: 'run a command',
        routable: false,
        timeoutMs: 60_000,
      });
      expect(h.gateway.sendNotice).toHaveBeenCalledTimes(1);
      expect(h.gateway.sendNotice.mock.calls[0][1]).toContain('`Bash`');
      expect(h.gateway.sendNotice.mock.calls[0][1]).toContain('60s');

      h.permissionHandler.publish({
        phase: 'resolved',
        requestId: 'req-1',
        routingHint: 'gw-conv-42',
        toolName: 'Bash',
        outcome: 'timed-out',
      });
      expect(h.gateway.sendNotice).toHaveBeenCalledTimes(2);
      expect(h.gateway.sendNotice.mock.calls[1][1]).toContain('`Bash`');
    } finally {
      release();
      await flushUntil(
        () => h.gateway.completeOutboundTurn.mock.calls.length > 0,
      );
    }
  });

  it('resumes a bound legacy Claude session on the Claude path when the gateway would start native', async () => {
    const h = setup({
      hostCapabilities: nativeCapabilities,
      identities: undefinedMetadataLookup(),
    });
    h.resumeSession.mockResolvedValue(
      scriptedStream([textDelta(SDK_UUID, 'kept'), messageComplete(SDK_UUID)]),
    );

    await runTurn(h, 'again', SDK_UUID);

    expect(h.resolveExecutionProfile).toHaveBeenCalledWith({
      workspacePath: '/ws/proj',
      requestedModel: 'opus',
      consumer: 'gateway',
      hostCapabilities: nativeCapabilities,
      existingIdentity: legacyClaudeIdentity(SDK_UUID),
    });
    expect(h.resumeSession).toHaveBeenCalledTimes(1);
    expect(h.resumeSession.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        model: 'opus',
        providerProfile: PROFILE,
        consumer: 'gateway',
      }),
    );
    expect(h.startChatSession).not.toHaveBeenCalled();
  });

  it('passes the stored native identity when the workspace no longer starts Codex', async () => {
    const h = setup({
      hostCapabilities: legacyCapabilities,
      identities: nativeLookup(SDK_UUID),
    });
    h.resumeSession.mockResolvedValue(
      scriptedStream([textDelta(SDK_UUID, 'kept'), messageComplete(SDK_UUID)]),
    );

    await runTurn(h, 'again', SDK_UUID);

    expect(h.resolveExecutionProfile).toHaveBeenCalledWith({
      workspacePath: '/ws/proj',
      requestedModel: 'opus',
      consumer: 'gateway',
      hostCapabilities: legacyCapabilities,
      existingIdentity: nativeIdentity(SessionId.from(SDK_UUID)),
    });
    expect(h.resumeSession).toHaveBeenCalledTimes(1);
    expect(h.resumeSession.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        model: 'gpt-5.4',
        providerProfile: undefined,
        consumer: 'gateway',
      }),
    );
    expect(h.startChatSession).not.toHaveBeenCalled();
    expect(h.resolveProviderProfileForWorkspace).not.toHaveBeenCalled();
  });

  it('fails closed when the bound session identity lookup throws', async () => {
    const h = setup({
      hostCapabilities: nativeCapabilities,
      identities: throwingIdentityLookup(),
    });
    h.resumeSession.mockResolvedValue(
      scriptedStream([textDelta(SDK_UUID, 'nope'), messageComplete(SDK_UUID)]),
    );
    h.startChatSession.mockResolvedValue(
      scriptedStream([textDelta(SDK_UUID, 'new'), messageComplete(SDK_UUID)]),
    );

    const binding = makeBinding();
    const conversation = makeConversation(binding, SDK_UUID);
    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, conversation, 'again'));
    await flushUntil(
      () => h.gateway.appendOutboundChunk.mock.calls.length > 0,
    );

    expect(h.resolveExecutionProfile).not.toHaveBeenCalled();
    expect(h.resumeSession).not.toHaveBeenCalled();
    expect(h.startChatSession).not.toHaveBeenCalled();
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledTimes(1);
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'telegram' }),
      GENERIC_FAILURE,
    );
    expect(h.conversations.setPtahSessionId).not.toHaveBeenCalled();
    expect(conversation.ptahSessionId).toBe(SDK_UUID);
  });

  it('fails closed when a non-empty bound session id is not a valid session id', async () => {
    const malformed = 'not-a-session-id';
    const h = setup({
      hostCapabilities: nativeCapabilities,
      identities: nativeLookup(SDK_UUID),
    });
    h.resumeSession.mockResolvedValue(
      scriptedStream([textDelta(SDK_UUID, 'nope'), messageComplete(SDK_UUID)]),
    );
    h.startChatSession.mockResolvedValue(
      scriptedStream([textDelta(SDK_UUID, 'new'), messageComplete(SDK_UUID)]),
    );

    const binding = makeBinding();
    const conversation = makeConversation(binding, malformed);
    h.bridge.start();
    h.gateway.emit('inbound', makeEvent(binding, conversation, 'again'));
    await flushUntil(
      () => h.gateway.appendOutboundChunk.mock.calls.length > 0,
    );

    expect(h.resolveExecutionProfile).not.toHaveBeenCalled();
    expect(h.resumeSession).not.toHaveBeenCalled();
    expect(h.startChatSession).not.toHaveBeenCalled();
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledTimes(1);
    expect(h.gateway.appendOutboundChunk).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'telegram' }),
      GENERIC_FAILURE,
    );
    expect(h.conversations.setPtahSessionId).not.toHaveBeenCalled();
    expect(conversation.ptahSessionId).toBe(malformed);
  });

  it('keeps the legacy new-session fallback when the identity lookup service is absent', async () => {
    const h = setup({ hostCapabilities: nativeCapabilities });
    h.resumeSession.mockRejectedValue(new Error('no such session'));
    h.startChatSession.mockResolvedValue(
      scriptedStream([textDelta(SDK_UUID, 'fresh'), messageComplete(SDK_UUID)]),
    );

    const { conversation } = await runTurn(h, 'again', SDK_UUID);

    expect(h.resolveExecutionProfile).toHaveBeenCalledWith({
      workspacePath: '/ws/proj',
      requestedModel: 'opus',
      consumer: 'gateway',
      hostCapabilities: nativeCapabilities,
      existingIdentity: legacyClaudeIdentity(SDK_UUID),
    });
    expect(h.resumeSession).toHaveBeenCalledTimes(1);
    expect(h.startChatSession).toHaveBeenCalledTimes(1);
    expect(h.startChatSession.mock.calls[0][0].runtime).toBe('claude-sdk');
    expect(h.startChatSession.mock.calls[0][0].providerProfile).toEqual(PROFILE);
    expect(conversation.ptahSessionId).toBe(SDK_UUID);
  });

  it('does not pass existingIdentity when the conversation has no bound session', async () => {
    const h = setup({ hostCapabilities: nativeCapabilities });
    h.startChatSession.mockResolvedValue(
      scriptedStream([textDelta(SDK_UUID, 'hi'), messageComplete(SDK_UUID)]),
    );

    await runTurn(h, 'hello agent', null);

    expect(h.resolveExecutionProfile).toHaveBeenCalledTimes(1);
    expect(h.resolveExecutionProfile).toHaveBeenCalledWith({
      workspacePath: '/ws/proj',
      requestedModel: 'opus',
      consumer: 'gateway',
      hostCapabilities: nativeCapabilities,
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        h.resolveExecutionProfile.mock.calls[0][0],
        'existingIdentity',
      ),
    ).toBe(false);
    expect(h.resumeSession).not.toHaveBeenCalled();
  });

  it('keeps only the complete-source text when a native stream corrects the same block', async () => {
    const h = setup({ hostCapabilities: nativeCapabilities });
    h.startChatSession.mockResolvedValue(
      scriptedStream([
        textDelta(SDK_UUID, 'old', { source: 'stream' }),
        textDelta(SDK_UUID, 'corrected answer', { source: 'complete' }),
        messageComplete(SDK_UUID),
      ]),
    );

    await runTurn(h, 'go', null);

    expect(h.gateway.appendOutboundChunk.mock.calls.map(([, text]) => text)).toEqual([
      'corrected answer',
    ]);
  });

  it('seals a shorter native final instead of the streamed prefix', async () => {
    const h = setup({ hostCapabilities: nativeCapabilities });
    h.startChatSession.mockResolvedValue(
      scriptedStream([
        textDelta(SDK_UUID, 'hello world', { source: 'stream' }),
        textDelta(SDK_UUID, 'hi', { source: 'complete' }),
        messageComplete(SDK_UUID),
      ]),
    );

    await runTurn(h, 'go', null);

    expect(h.gateway.appendOutboundChunk.mock.calls.map(([, text]) => text)).toEqual([
      'hi',
    ]);
  });

  it('contributes nothing for a block a native complete delta replaces with empty text', async () => {
    const h = setup({ hostCapabilities: nativeCapabilities });
    h.startChatSession.mockResolvedValue(
      scriptedStream([
        textDelta(SDK_UUID, 'hello', { source: 'stream', blockIndex: 0 }),
        textDelta(SDK_UUID, 'tail', { source: 'stream', blockIndex: 1 }),
        textDelta(SDK_UUID, '', { source: 'complete', blockIndex: 0 }),
        messageComplete(SDK_UUID),
      ]),
    );

    await runTurn(h, 'go', null);

    expect(h.gateway.appendOutboundChunk.mock.calls.map(([, text]) => text)).toEqual([
      'tail',
    ]);
  });

  it('joins native messages in arrival order and blocks by blockIndex', async () => {
    const h = setup({ hostCapabilities: nativeCapabilities });
    h.startChatSession.mockResolvedValue(
      scriptedStream([
        textDelta(SDK_UUID, 'B', {
          source: 'stream',
          messageId: 'm1',
          blockIndex: 1,
        }),
        textDelta(SDK_UUID, 'C', {
          source: 'stream',
          messageId: 'm2',
          blockIndex: 0,
        }),
        textDelta(SDK_UUID, 'A', {
          source: 'complete',
          messageId: 'm1',
          blockIndex: 0,
        }),
        messageComplete(SDK_UUID),
      ]),
    );

    await runTurn(h, 'go', null);

    expect(h.gateway.appendOutboundChunk.mock.calls.map(([, text]) => text)).toEqual([
      'ABC',
    ]);
  });

  it('drains a partial native body once and sends the failure reply when the stream throws', async () => {
    const h = setup({ hostCapabilities: nativeCapabilities });
    h.startChatSession.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield textDelta(SDK_UUID, 'partial', { source: 'stream' });
        throw new Error('mid-stream boom');
      },
    } as AsyncIterable<FlatStreamEventUnion>);

    await runTurn(h, 'go', null);

    const chunks = h.gateway.appendOutboundChunk.mock.calls.map(([, text]) => text);
    expect(chunks.filter((text) => text === 'partial')).toEqual(['partial']);
    expect(chunks).toContain(GENERIC_FAILURE);
    expect(h.gateway.drainOutbound).toHaveBeenCalled();
  });

  it('does not append streamed native text after the watchdog cancels the turn', async () => {
    jest.useFakeTimers();
    try {
      const h = setup({ hostCapabilities: nativeCapabilities });
      h.startChatSession.mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          yield textDelta(SDK_UUID, 'stale prefix', { source: 'stream' });
          await new Promise<void>(() => {
            /* never resolves */
          });
        },
      } as AsyncIterable<FlatStreamEventUnion>);

      const binding = makeBinding();
      const conversation = makeConversation(binding, null);
      h.bridge.start();
      h.gateway.emit('inbound', makeEvent(binding, conversation, 'hangs'));
      await jest.advanceTimersByTimeAsync(0);
      expect(h.startChatSession).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(10 * 60_000);

      const chunks = h.gateway.appendOutboundChunk.mock.calls.map(
        ([, text]) => text,
      );
      expect(chunks).not.toContain('stale prefix');
      expect(chunks).toContain(
        'This request took too long and was stopped. Please try again.',
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
