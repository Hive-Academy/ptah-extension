/**
 * Native Codex chat: end-to-end UI contracts (TASK_2026_714 batch 8k-5).
 *
 * Path under test, all real code: App Server notifications and server requests
 * -> CodexEventTranslator / CodexApprovalBridge (codex-runtime) ->
 * CodexChatAdapter, CodexChatEvents projection and turn stream (agent-sdk) ->
 * host ports (createCodexChatHostPorts) -> ChatStreamBroadcaster -> the
 * webview messages. Only the process boundary is faked: a scripted App Server
 * feeds the real translator, and the profile port is replaced the same way the
 * Electron composition replaces it.
 *
 * The Claude reference turn runs recorded-shape SDK messages through the real
 * SdkMessageTransformer and the same broadcaster, so both sides are compared at
 * the webview boundary: event types, order and FlatStreamEventUnion shape, not
 * ids or timestamps.
 */
import 'reflect-metadata';
import { container } from 'tsyringe';
import { Logger } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import {
  CodexChatAdapter,
  CompactionBoundaryGenerationRegistry,
  SdkMessageTransformer,
  SessionTurnStateRegistry,
  SubagentStopNotices,
  isCodexChatAdapterError,
  type CodexChatEventCallbacks,
  type SDKMessage,
} from '@ptah-extension/agent-sdk';
import {
  CODEX_RUNTIME_TOKENS,
  CodexParityGate,
  type ApprovalSink,
  type CodexClock,
  type CodexContext,
  type CodexExecutionProfile,
  type CodexRuntimeEvent,
} from '@ptah-extension/codex-runtime';
import {
  MESSAGE_TYPES,
  SessionId,
  attentionRequestKey,
  findModelPricing,
  parsePermissionRequest,
  type BatchMessagePayload,
  type FlatStreamEventUnion,
  type IAgentAdapter,
  type ProviderInfo,
} from '@ptah-extension/shared';
import {
  createCodexChatHostPorts,
  type CodexChatHostPorts,
} from './codex-chat-host-ports';
import { ChatStreamBroadcaster } from '../streaming/chat-stream-broadcaster.service';

// Only the two leaf modules the host ports use; the full barrel reaches
// workspace-intelligence's ESM-only wasm loader (host-ports spec precedent).
jest.mock('@ptah-extension/cli-agent-runtime', () => ({
  ptahMcpSessionUrl: jest.requireActual<
    typeof import('../../../../../cli-agent-runtime/src/lib/cli-agents/cli-adapters/ptah-mcp-url')
  >('../../../../../cli-agent-runtime/src/lib/cli-agents/cli-adapters/ptah-mcp-url').ptahMcpSessionUrl,
  CODEX_PTAH_TOOL_TIMEOUT_SEC: jest.requireActual<
    typeof import('../../../../../cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-config.builder')
  >('../../../../../cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-config.builder').CODEX_PTAH_TOOL_TIMEOUT_SEC,
}));

// Internal classes the barrels do not export; loaded from source so the spec
// drives the same modules production composes (host-ports spec precedent).
const { CodexEventTranslator } = jest.requireActual<
  typeof import('../../../../../codex-runtime/src/lib/codex-event-translator')
>('../../../../../codex-runtime/src/lib/codex-event-translator');
const { CodexApprovalBridge } = jest.requireActual<
  typeof import('../../../../../codex-runtime/src/lib/codex-approval-bridge')
>('../../../../../codex-runtime/src/lib/codex-approval-bridge');
const { CodexPermissionRuleStore } = jest.requireActual<
  typeof import('../../../../../codex-runtime/src/lib/codex-permission-rule-store')
>('../../../../../codex-runtime/src/lib/codex-permission-rule-store');
const { SessionApprovalRouter } = jest.requireActual<
  typeof import('../../../../../agent-sdk/src/lib/codex-app-server/session-approval-router')
>('../../../../../agent-sdk/src/lib/codex-app-server/session-approval-router');

const THREAD = SessionId.from('11111111-1111-4111-8111-111111111111');
const TAB = SessionId.from('22222222-2222-4222-8222-222222222222');
const CLAUDE_SESSION = SessionId.from('33333333-3333-4333-8333-333333333333');
const TURN = 'turn-1';
const identity = {
  contextId: 'context-1',
  threadId: THREAD,
  processGeneration: 1,
  normalizedHome: '/home',
  workspaceId: '/workspace',
  providerId: 'openai-codex',
  profileFingerprint: 'fingerprint',
};
const profile: CodexExecutionProfile = {
  ...identity,
  consumer: 'chat',
  cwd: '/workspace',
  model: 'gpt-5',
  permissionLevel: 'ask',
  approvalPolicy: 'untrusted',
  sandboxPolicy: {
    mode: 'workspace-write',
    networkAccess: false,
    writableRoots: ['/workspace'],
  },
  instructionSources: [],
  mcpServers: [],
  attachments: [],
};
const info: ProviderInfo = {
  id: 'codex-app-server',
  name: 'Codex App Server',
  vendor: 'OpenAI',
  version: '1',
  description: 'Native Codex chat runtime',
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
};
const usage = {
  inputTokens: 12,
  cachedInputTokens: 0,
  outputTokens: 3,
  reasoningOutputTokens: 0,
  totalTokens: 15,
};
const command = { command: 'npm test', cwd: '/workspace' };

/**
 * A double for a wide host type: only the named members exist, so any call the
 * path makes beyond them fails loudly instead of returning a silent default.
 */
function double<T extends object>(members: Partial<T>): T {
  return Object.assign(Object.create(null), members);
}

function mockLogger(): Logger {
  return Object.assign(Object.create(Logger.prototype), createMockLogger());
}

const turnStarted = (turn = TURN) => ({
  method: 'turn/started',
  params: {
    threadId: THREAD,
    turn: { id: turn, items: [], status: 'inProgress' },
  },
});
const item = (value: object, completed = false, turn = TURN) => ({
  method: completed ? 'item/completed' : 'item/started',
  params: {
    threadId: THREAD,
    turnId: turn,
    item: value,
    ...(completed ? { completedAtMs: 2 } : { startedAtMs: 1 }),
  },
});
const agentText = (text: string, turn = TURN, itemId = 'message-1') => [
  item({ type: 'agentMessage', id: itemId, text: '' }, false, turn),
  {
    method: 'item/agentMessage/delta',
    params: {
      threadId: THREAD,
      turnId: turn,
      itemId,
      delta: text,
    },
  },
  item({ type: 'agentMessage', id: itemId, text }, true, turn),
];
/** `requests`: the thread total is cumulative, so turn n reports n requests. */
const tokenUsage = (turn = TURN, requests = 1) => ({
  method: 'thread/tokenUsage/updated',
  params: {
    threadId: THREAD,
    turnId: turn,
    tokenUsage: {
      last: usage,
      total: {
        inputTokens: usage.inputTokens * requests,
        cachedInputTokens: usage.cachedInputTokens * requests,
        outputTokens: usage.outputTokens * requests,
        reasoningOutputTokens: usage.reasoningOutputTokens * requests,
        totalTokens: usage.totalTokens * requests,
      },
      modelContextWindow: 272_000,
    },
  },
});
const turnCompleted = (turn = TURN) => ({
  method: 'turn/completed',
  params: {
    threadId: THREAD,
    turn: { id: turn, items: [], status: 'completed' },
  },
});
const commandItem = (completed: boolean) =>
  item(
    {
      type: 'commandExecution',
      id: 'call-1',
      ...command,
      commandActions: [],
      status: completed ? 'completed' : 'inProgress',
      ...(completed ? { aggregatedOutput: 'ok', exitCode: 0 } : {}),
    },
    completed,
  );
const approvalFrame = () => ({
  id: 7,
  method: 'item/commandExecution/requestApproval',
  params: {
    threadId: THREAD,
    turnId: TURN,
    itemId: 'call-1',
    startedAtMs: 1,
    ...command,
  },
});

/** The process boundary: scripted notifications through the real translator. */
class ScriptedAppServer {
  private readonly translator = new CodexEventTranslator(
    identity.contextId,
    identity.processGeneration,
  );
  private readonly queue: CodexRuntimeEvent[] = [];
  private wake?: () => void;
  /** Notifications the server sends once turn/start is accepted. */
  onTurnStart: () => void = () => undefined;
  /** The native turn id the next turn/start receipt carries. */
  turnId = TURN;
  readonly interrupt = jest.fn(async (_turnId: string) => true);
  readonly close = jest.fn(async () => undefined);

  notify(...notifications: { method: string; params: unknown }[]): void {
    for (const notification of notifications)
      this.queue.push(...this.translator.translate(notification));
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }

  context(): CodexContext {
    const events = this.events.bind(this);
    return {
      identity,
      listModels: async () => [],
      events,
      startTurn: async () => {
        this.onTurnStart();
        return { threadId: THREAD, turnId: this.turnId, revision: 1 };
      },
      steer: async () => ({ threadId: THREAD, turnId: TURN, revision: 2 }),
      interrupt: this.interrupt,
      updateNextTurn: async () => ({ timing: 'nextTurn', revision: 2 }),
      compact: async () => undefined,
      close: this.close,
    };
  }

  private async *events(
    signal: AbortSignal,
  ): AsyncGenerator<CodexRuntimeEvent> {
    while (!signal.aborted) {
      const next = this.queue.shift();
      if (next) {
        yield next;
        continue;
      }
      await new Promise<void>((resolve) => {
        this.wake = resolve;
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    }
  }
}

type BroadcasterDeps = ConstructorParameters<typeof ChatStreamBroadcaster>;

function webview() {
  const broadcastMessage = jest.fn<Promise<void>, [string, unknown]>(
    async () => undefined,
  );
  return {
    manager: { sendMessage: jest.fn(async () => undefined), broadcastMessage },
    /** Every webview message in delivery order, with batches unwrapped. */
    messages(): { type: string; payload: unknown }[] {
      return broadcastMessage.mock.calls.flatMap(([type, payload]) =>
        type === MESSAGE_TYPES.BATCH && isBatch(payload)
          ? payload.events.map((entry) => ({
              type: entry.type,
              payload: entry.payload,
            }))
          : [{ type, payload }],
      );
    },
    chunks(): FlatStreamEventUnion[] {
      return this.messages().flatMap(({ type, payload }) =>
        type === MESSAGE_TYPES.CHAT_CHUNK && isChunk(payload)
          ? [payload.event]
          : [],
      );
    },
  };
}

function isBatch(payload: unknown): payload is BatchMessagePayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'events' in payload &&
    Array.isArray(payload.events)
  );
}

function isChunk(payload: unknown): payload is { event: FlatStreamEventUnion } {
  return typeof payload === 'object' && payload !== null && 'event' in payload;
}

function broadcasterFor(
  turnState: SessionTurnStateRegistry,
  adapter: IAgentAdapter,
  view: ReturnType<typeof webview>,
) {
  const logger = mockLogger();
  const sentry = double<BroadcasterDeps[4]>({ captureException: jest.fn() });
  const broadcaster = new ChatStreamBroadcaster(
    logger,
    view.manager,
    adapter,
    double<BroadcasterDeps[3]>({ update: jest.fn() }),
    sentry,
    // Child metadata is only written for Ptah CLI sessions, which these are not.
    double<BroadcasterDeps[5]>({}),
    double<BroadcasterDeps[6]>({
      hasSession: () => false,
      deleteSession: jest.fn(),
    }),
    turnState,
  );
  return { broadcaster, logger, sentry };
}

function codexHarness() {
  const server = new ScriptedAppServer();
  const turnState = new SessionTurnStateRegistry();
  const view = webview();
  const logger = mockLogger();
  const resolveAttention = jest.fn<void, [string, number]>();
  const callbacks: CodexChatEventCallbacks = {
    result: jest.fn(),
    content: jest.fn(),
    live: jest.fn(),
    compaction: jest.fn(),
    error: jest.fn(),
  };
  const scope = container.createChildContainer();
  // Every runtime open (fresh or resumed) is one App Server context.
  const open = jest.fn(async () => server.context());
  scope.register(CODEX_RUNTIME_TOKENS.ParityGate, {
    useValue: new CodexParityGate(),
  });
  scope.register(CODEX_RUNTIME_TOKENS.DevRouteOverride, {
    useFactory: () => ({ consumer: 'chat' }),
  });
  scope.register(CODEX_RUNTIME_TOKENS.Logger, {
    useValue: { warn: jest.fn() },
  });
  scope.register(CODEX_RUNTIME_TOKENS.Runtime, {
    useValue: { open },
  });
  let sink: ApprovalSink | undefined;
  // Production wiring: the router's cancellation goes to the host presentation.
  const approvals = new SessionApprovalRouter(
    { handleResponse: jest.fn() },
    (payload) => host.presentation.cancelPrompt(payload),
  );
  let broadcast: ChatStreamBroadcaster['streamEventsToWebview'] = () => {
    throw new Error('Broadcaster not composed');
  };
  const host = createCodexChatHostPorts({
    resolver: { resolveExecutionProfile: jest.fn() },
    workspaceProvider: createMockWorkspaceProvider({ folders: ['/workspace'] }),
    platformInfo: {
      extensionPath: '/extension',
      globalStoragePath: '/storage',
    },
    hostCapabilities: { nativeCodex: true },
    webviewManager: view.manager,
    hostAttention: { resolve: resolveAttention },
    logger,
    platform: { platform: 'win32', arch: 'x64' },
    info,
    createScope: (value) => {
      sink = value;
      return { container: scope, dispose: async () => scope.dispose() };
    },
    metadata: { save: jest.fn(async () => undefined) },
    approvals,
    callbacks: () => callbacks,
    readResumeIdentity: async () => undefined,
    broadcaster: { streamEventsToWebview: (...args) => broadcast(...args) },
    tabId: () => TAB,
  });
  // As the Electron composition does: the profile comes from the host session.
  const ports: CodexChatHostPorts = {
    ...host,
    profile: async (_config, sessionId) => ({
      profile,
      // A resume carries the stored native identity of the thread it reopens.
      ...(sessionId ? { resume: identity } : {}),
    }),
  };
  const adapter = new CodexChatAdapter(ports, turnState);
  const {
    broadcaster,
    logger: streamLogger,
    sentry,
  } = broadcasterFor(turnState, adapter, view);
  broadcast = (...args) => broadcaster.streamEventsToWebview(...args);
  const clock: CodexClock = {
    now: () => Date.now(),
    setTimeout: (callback, ms) => {
      const timer = setTimeout(callback, ms);
      return { dispose: () => clearTimeout(timer) };
    },
  };
  let bridge: InstanceType<typeof CodexApprovalBridge> | undefined;
  return {
    server,
    open,
    adapter,
    ports: host,
    view,
    logger,
    streamLogger,
    sentry,
    callbacks,
    resolveAttention,
    /** The bridge the runtime binds to the scope's approval sink. */
    bridge() {
      if (!sink) throw new Error('Expected an approval sink after opening');
      bridge ??= new CodexApprovalBridge({
        identity,
        sink,
        rules: new CodexPermissionRuleStore(),
        clock,
        permissionLevel: () => 'ask',
        isCurrent: () => true,
        isWritable: () => true,
        close: jest.fn(),
        timeoutMs: 60_000,
      });
      return bridge;
    },
    /** chat:start: the broadcaster consumes the start stream under the tab id. */
    async start(observed: { error?: unknown } = {}) {
      const stream = await adapter.startChatSession({
        tabId: TAB,
        prompt: 'hi',
      });
      return broadcaster.streamEventsToWebview(
        TAB,
        (async function* () {
          try {
            yield* stream;
          } catch (error) {
            observed.error = error;
            throw error;
          }
        })(),
        TAB,
      );
    },
    /** chat:continue on a live session: the turn is published under its id. */
    followUp(text: string) {
      return adapter.sendMessageToSession(THREAD, text);
    },
    /** chat:continue auto-resume: the broadcaster consumes under the session id. */
    async resume(prompt: string) {
      const stream = await adapter.resumeSession(THREAD, {
        tabId: TAB,
        prompt,
      });
      return broadcaster.streamEventsToWebview(THREAD, stream, TAB);
    },
    /** Script the next native turn: one text answer with usage and a terminal. */
    scriptTurn(turn: string, text: string, requests = 1) {
      server.turnId = turn;
      server.onTurnStart = () =>
        server.notify(
          turnStarted(turn),
          ...agentText(text, turn, `message-${turn}`),
          tokenUsage(turn, requests),
          turnCompleted(turn),
        );
    },
    dispose() {
      bridge?.dispose();
      adapter.dispose();
    },
  };
}

/** Recorded-shape Claude SDK messages for one text turn with usage. */
const CLAUDE_TURN: readonly SDKMessage[] = JSON.parse(
  JSON.stringify([
    {
      type: 'stream_event',
      uuid: 'stream-1',
      session_id: CLAUDE_SESSION,
      parent_tool_use_id: null,
      event: {
        type: 'message_start',
        message: {
          id: 'msg_claude_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 12, output_tokens: 0 },
        },
      },
    },
    {
      type: 'stream_event',
      uuid: 'stream-2',
      session_id: CLAUDE_SESSION,
      parent_tool_use_id: null,
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
    },
    {
      type: 'stream_event',
      uuid: 'stream-3',
      session_id: CLAUDE_SESSION,
      parent_tool_use_id: null,
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' },
      },
    },
    {
      type: 'stream_event',
      uuid: 'stream-4',
      session_id: CLAUDE_SESSION,
      parent_tool_use_id: null,
      event: { type: 'content_block_stop', index: 0 },
    },
    {
      type: 'stream_event',
      uuid: 'stream-5',
      session_id: CLAUDE_SESSION,
      parent_tool_use_id: null,
      event: {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { input_tokens: 12, output_tokens: 3 },
      },
    },
    {
      type: 'stream_event',
      uuid: 'stream-6',
      session_id: CLAUDE_SESSION,
      parent_tool_use_id: null,
      event: { type: 'message_stop' },
    },
    {
      type: 'assistant',
      uuid: 'assistant-1',
      session_id: CLAUDE_SESSION,
      parent_tool_use_id: null,
      message: {
        id: 'msg_claude_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'Hello' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 3 },
      },
    },
    {
      type: 'result',
      subtype: 'success',
      uuid: 'result-1',
      session_id: CLAUDE_SESSION,
      is_error: false,
      duration_ms: 10,
      duration_api_ms: 8,
      num_turns: 1,
      result: 'Hello',
      total_cost_usd: 0,
      usage: { input_tokens: 12, output_tokens: 3 },
      terminal_reason: 'completed',
    },
  ]),
);

type TransformerDeps = ConstructorParameters<typeof SdkMessageTransformer>;

async function claudeReferenceTurn() {
  const turnState = new SessionTurnStateRegistry();
  const transformer = new SdkMessageTransformer(
    mockLogger(),
    {},
    double<TransformerDeps[2]>({
      pruneSession: jest.fn(),
      markPendingBackground: jest.fn(),
      setTaskId: jest.fn(),
      hasHeldUnboundStarts: () => false,
    }),
    double<TransformerDeps[3]>({
      resolveForPricing: (model: string) => model,
      resolveForCost: (model: string) => ({
        modelId: model,
        pricing: findModelPricing(model),
        subscriptionCovered: false,
      }),
      isSubscriptionCovered: () => false,
    }),
    double<TransformerDeps[4]>({ getActiveSessionIds: () => [CLAUDE_SESSION] }),
    double<TransformerDeps[5]>({
      recordSessionUsage: jest.fn(),
      getCumulativeTokens: () => 0,
      clearSessionTokenSnapshot: jest.fn(),
    }),
    turnState,
    new CompactionBoundaryGenerationRegistry(),
    new SubagentStopNotices(),
  );
  const view = webview();
  const { broadcaster } = broadcasterFor(
    turnState,
    double<IAgentAdapter>({
      getSessionToken: () => null,
      endSession: async () => undefined,
      endSessionIfTokenMatches: async () => false,
    }),
    view,
  );
  await broadcaster.streamEventsToWebview(
    TAB,
    (async function* () {
      for (const message of CLAUDE_TURN)
        yield* transformer.transform(message, CLAUDE_SESSION);
    })(),
    TAB,
  );
  return view;
}

/**
 * The root lifecycle the webview sees: live stream chunks, turn states and
 * chat:complete. Claude also mirrors the finished message as source
 * `complete` chunks (and a second chat:complete for that mirror); those are
 * the SDK's completed-message echo, not lifecycle, so they are left out and
 * repeated chat:complete entries are folded.
 */
function lifecycle(view: ReturnType<typeof webview>, from = 0): string[] {
  const entries = view
    .messages()
    .slice(from)
    .flatMap(({ type, payload }) => {
      if (type === MESSAGE_TYPES.CHAT_COMPLETE) return ['chat:complete'];
      if (type !== MESSAGE_TYPES.CHAT_CHUNK || !isChunk(payload)) return [];
      const event = payload.event;
      return event.eventType === 'turn_state' || event.source === 'stream'
        ? [event.eventType]
        : [];
    });
  return entries.filter(
    (entry, index) => entry !== 'chat:complete' || entries[index - 1] !== entry,
  );
}

function rootEvents(
  view: ReturnType<typeof webview>,
  from = 0,
): FlatStreamEventUnion[] {
  return view
    .messages()
    .slice(from)
    .flatMap(({ type, payload }) =>
      type === MESSAGE_TYPES.CHAT_CHUNK && isChunk(payload)
        ? [payload.event]
        : [],
    )
    .filter(
      (event) => event.eventType === 'turn_state' || event.source === 'stream',
    );
}

/** Contract fields every root chunk carries, with their wire types. */
function shape(event: FlatStreamEventUnion) {
  const base = {
    eventType: event.eventType,
    id: typeof event.id,
    timestamp: typeof event.timestamp,
    sessionId: typeof event.sessionId,
    messageId: typeof event.messageId,
    source: event.source,
  };
  switch (event.eventType) {
    case 'turn_state':
      return {
        ...base,
        phase: event.phase,
        terminalReason: event.terminalReason,
        revision: typeof event.revision,
        keys: Object.keys(event).sort(),
      };
    case 'message_start':
      return { ...base, role: event.role };
    case 'text_delta':
      return {
        ...base,
        delta: event.delta,
        blockIndex: typeof event.blockIndex,
      };
    case 'message_delta':
      return {
        ...base,
        input: event.tokenUsage.input,
        output: event.tokenUsage.output,
      };
    default:
      return base;
  }
}

async function eventually(check: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

describe('Native Codex chat contracts end to end', () => {
  it('delivers a completed turn with the same root lifecycle as a Claude turn', async () => {
    const h = codexHarness();
    h.server.onTurnStart = () =>
      h.server.notify(
        turnStarted(),
        ...agentText('Hello'),
        tokenUsage(),
        turnCompleted(),
      );
    try {
      await h.start();
      const claude = await claudeReferenceTurn();

      expect(lifecycle(h.view)).toEqual([
        'turn_state',
        'message_start',
        'text_delta',
        'message_delta',
        'message_complete',
        'chat:complete',
        'turn_state',
      ]);
      expect(lifecycle(h.view)).toEqual(lifecycle(claude));
      expect(rootEvents(h.view).map(shape)).toEqual(
        rootEvents(claude).map(shape),
      );
      const states = rootEvents(h.view).filter(
        (event) => event.eventType === 'turn_state',
      );
      expect(states).toMatchObject([
        { phase: 'generating', terminalReason: null, sessionId: THREAD },
        { phase: 'idle', terminalReason: 'completed', sessionId: THREAD },
      ]);
      // One root message: every content chunk carries the message_start id.
      const message = rootEvents(h.view).filter(
        (event) => event.eventType !== 'turn_state',
      );
      expect(new Set(message.map((event) => event.messageId)).size).toBe(1);
      expect(
        h.view.messages().some(({ type }) => type === MESSAGE_TYPES.CHAT_ERROR),
      ).toBe(false);
      expect(h.callbacks.error).not.toHaveBeenCalled();
      expect(h.streamLogger.error).not.toHaveBeenCalled();
    } finally {
      h.dispose();
    }
  });

  it.each([
    ['fileChange', 'allow'],
    ['fileChange', 'deny'],
    ['commandExecution', 'allow'],
    ['commandExecution', 'deny'],
  ] as const)(
    'presents exactly one pre-start %s approval and honors %s',
    async (kind, decision) => {
      const h = codexHarness();
      // Pre-start: the approval arrives before any item, so nothing is
      // projected yet (message_start is synthesized with the first mapped
      // item event). The turn is live once startTurn is accepted.
      let turnBegun = false;
      h.server.onTurnStart = () => {
        h.server.notify(turnStarted());
        turnBegun = true;
      };
      const tool = kind === 'commandExecution'
        ? {
            type: kind,
            id: 'call-1',
            ...command,
            commandActions: [],
          }
        : {
            type: kind,
            id: 'call-1',
            changes: [{
              path: '/workspace/example.txt',
              diff: '+approved edit',
              kind: { type: 'add' },
            }],
          };
      try {
        const streaming = h.start();
        await eventually(() => turnBegun, 'turn started before approval');
        const reply = h.bridge().handle({
          id: 7,
          method: `item/${kind}/requestApproval`,
          params: {
            threadId: THREAD,
            turnId: TURN,
            itemId: 'call-1',
            startedAtMs: 1,
            ...(kind === 'commandExecution' ? command : { grantRoot: '/workspace' }),
          },
        }, TURN, new AbortController().signal);
        const permissions = () => h.view.messages().filter(
          ({ type }) => type === MESSAGE_TYPES.PERMISSION_REQUEST,
        );
        await eventually(() => permissions().length > 0, 'pre-start approval');
        expect(permissions()).toHaveLength(1);
        expect(h.view.chunks().filter((event) => event.eventType === 'tool_start'))
          .toHaveLength(0);
        const parsed = parsePermissionRequest(permissions()[0].payload);
        expect(parsed).not.toBeNull();
        expect(parsed).toMatchObject({
          sessionId: THREAD,
          tabId: TAB,
          toolUseId: 'call-1',
        });
        expect(h.ports.handlePermissionResponse({
          id: parsed?.id ?? '',
          // Plain deny cancels the Codex turn; the refusal flow below (the
          // server reports the item declined and the turn continues) is
          // deny_with_message, which the host maps to the decline decision.
          decision: decision === 'allow' ? 'allow' : 'deny_with_message',
        })).toBe(true);
        await expect(reply).resolves.toMatchObject({
          response: { decision: decision === 'allow' ? 'accept' : 'decline' },
        });
        if (decision === 'allow') {
          h.server.notify(item({ ...tool, status: 'inProgress' }));
          h.server.notify(item({ ...tool, status: 'completed' }, true));
        } else {
          // The server reports refusal without ever executing the item.
          h.server.notify(item({ ...tool, status: 'declined' }, true));
        }
        h.server.notify(turnCompleted());
        await streaming;
        expect(permissions()).toHaveLength(1);
        const starts = h.view.chunks().filter((event) => event.eventType === 'tool_start');
        const results = h.view.chunks().filter((event) => event.eventType === 'tool_result');
        expect(starts).toHaveLength(decision === 'allow' ? 1 : 0);
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
          toolCallId: parsed?.toolUseId,
          isError: decision === 'deny',
        });
        expect(results.filter((event) => !event.isError))
          .toHaveLength(decision === 'allow' ? 1 : 0);
      } finally {
        h.dispose();
      }
    },
  );

  it('presents an approval that the renderer parser accepts, keyed to its tool_start', async () => {
    const h = codexHarness();
    h.server.onTurnStart = () =>
      h.server.notify(turnStarted(), commandItem(false));
    try {
      const streaming = h.start();
      await eventually(
        () => h.view.chunks().some((event) => event.eventType === 'tool_start'),
        'tool_start',
      );
      const reply = h
        .bridge()
        .handle(approvalFrame(), TURN, new AbortController().signal);
      await eventually(
        () =>
          h.view
            .messages()
            .some(({ type }) => type === MESSAGE_TYPES.PERMISSION_REQUEST),
        'permission request',
      );

      const toolStart = h.view
        .chunks()
        .find((event) => event.eventType === 'tool_start');
      const wire = h.view
        .messages()
        .find(({ type }) => type === MESSAGE_TYPES.PERMISSION_REQUEST);
      const parsed = parsePermissionRequest(wire?.payload);
      expect(parsed).not.toBeNull();
      expect(
        toolStart?.eventType === 'tool_start' && toolStart.toolCallId,
      ).toBe('call-1');
      expect(parsed?.toolUseId).toBe(
        toolStart?.eventType === 'tool_start'
          ? toolStart.toolCallId
          : undefined,
      );
      expect(parsed).toMatchObject({
        sessionId: THREAD,
        tabId: TAB,
        toolName:
          toolStart?.eventType === 'tool_start'
            ? toolStart.toolName
            : undefined,
        toolInput: { command: 'npm test' },
        description: 'Run: npm test',
      });

      // The renderer answers with the Claude decision vocabulary.
      expect(
        h.ports.handlePermissionResponse({
          id: parsed?.id ?? '',
          decision: 'allow',
        }),
      ).toBe(true);
      await expect(reply).resolves.toMatchObject({
        response: { decision: 'accept' },
      });
      h.server.notify(commandItem(true), ...agentText('Done'), turnCompleted());
      await streaming;
      expect(lifecycle(h.view)).toEqual([
        'turn_state',
        'message_start',
        'tool_start',
        'tool_result',
        'text_delta',
        'message_complete',
        'chat:complete',
        'turn_state',
      ]);
      expect(rootEvents(h.view).at(-1)).toMatchObject({
        eventType: 'turn_state',
        phase: 'idle',
        terminalReason: 'completed',
      });
    } finally {
      h.dispose();
    }
  });

  it('settles a stop during approval as a user abort and releases the prompt by wire id', async () => {
    const h = codexHarness();
    h.server.onTurnStart = () =>
      h.server.notify(turnStarted(), commandItem(false));
    const observed: { error?: unknown } = {};
    try {
      const streaming = h.start(observed);
      await eventually(
        () => h.view.chunks().some((event) => event.eventType === 'tool_start'),
        'tool_start',
      );
      const reply = h
        .bridge()
        .handle(approvalFrame(), TURN, new AbortController().signal);
      await eventually(
        () =>
          h.view
            .messages()
            .some(({ type }) => type === MESSAGE_TYPES.PERMISSION_REQUEST),
        'permission request',
      );
      const request = parsePermissionRequest(
        h.view
          .messages()
          .find(({ type }) => type === MESSAGE_TYPES.PERMISSION_REQUEST)
          ?.payload,
      );
      if (!request) throw new Error('Expected a parsed permission request');

      await h.adapter.interruptSession(THREAD);
      await streaming;

      // The turn stream ends with a cancellation, which the broadcaster
      // classifies as a user abort: no chat:error, no Sentry report.
      expect(isCodexChatAdapterError(observed.error)).toBe(true);
      expect(observed.error).toMatchObject({ code: 'cancelled' });
      expect(h.streamLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('aborted by user'),
      );
      expect(h.streamLogger.error).not.toHaveBeenCalled();
      expect(h.sentry.captureException).not.toHaveBeenCalled();
      expect(
        h.view.messages().some(({ type }) => type === MESSAGE_TYPES.CHAT_ERROR),
      ).toBe(false);
      expect(rootEvents(h.view).at(-1)).toMatchObject({
        eventType: 'turn_state',
        phase: 'idle',
        terminalReason: 'aborted_streaming',
        sessionId: THREAD,
      });

      // The prompt is cancelled under the renderer's wire id, and the host
      // notice it raised is released under the same id and generation.
      expect(
        h.view
          .messages()
          .filter(
            ({ type }) => type === MESSAGE_TYPES.PERMISSION_PROMPT_CANCELLED,
          )
          .map(({ payload }) => payload),
      ).toEqual([
        { sessionId: THREAD, requestId: request.id, reason: 'turn-ended' },
      ]);
      expect(h.resolveAttention).toHaveBeenCalledWith(
        attentionRequestKey('permission', request.id),
        request.timestamp,
      );
      await expect(reply).resolves.toMatchObject({
        response: { decision: 'cancel' },
      });
      expect(h.server.close).toHaveBeenCalledTimes(1);
    } finally {
      h.dispose();
    }
  });
});

/**
 * 8k-5 finding 3 (batch 8l-3). Claude keeps one stream per session, so the
 * broadcaster ends the record when that stream exits. A native Codex session
 * streams every turn separately; a follow-up (`ports.publish`), a resume and
 * /compact are streamed under the session id, where the broadcaster's exit
 * teardown (`endSessionIfTokenMatches`) finds the adapter's live token. The
 * thread must outlive each of those turns exactly as it outlives the first.
 */
describe('Native Codex chat sessions across turns', () => {
  const FIRST_LIFECYCLE = [
    'turn_state',
    'message_start',
    'text_delta',
    'message_delta',
    'message_complete',
    'chat:complete',
    'turn_state',
  ];

  it('keeps the live thread through follow-ups published under the session id', async () => {
    const h = codexHarness();
    h.scriptTurn(TURN, 'Hello');
    try {
      await h.start();
      const firstLifecycle = lifecycle(h.view);
      const firstShapes = rootEvents(h.view).map(shape);
      expect(firstLifecycle).toEqual(FIRST_LIFECYCLE);

      const followUpFrom = h.view.messages().length;
      h.scriptTurn('turn-2', 'Hello', 2);
      await h.followUp('again');

      // The follow-up turn reaches the webview with the first turn's contract.
      expect(lifecycle(h.view, followUpFrom)).toEqual(firstLifecycle);
      expect(rootEvents(h.view, followUpFrom).map(shape)).toEqual(firstShapes);
      expect(
        rootEvents(h.view, followUpFrom).filter(
          (event) => event.eventType === 'turn_state',
        ),
      ).toMatchObject([
        { phase: 'generating', terminalReason: null, sessionId: THREAD },
        { phase: 'idle', terminalReason: 'completed', sessionId: THREAD },
      ]);

      // The broadcaster's stream-exit teardown left the native thread open.
      expect(h.adapter.isSessionActive(THREAD)).toBe(true);
      expect(h.adapter.canSendFollowUp(THREAD)).toBe(true);
      expect(h.server.close).not.toHaveBeenCalled();

      // A third turn runs on the same thread and App Server context.
      const thirdFrom = h.view.messages().length;
      h.scriptTurn('turn-3', 'Hello', 3);
      await h.followUp('third');
      expect(lifecycle(h.view, thirdFrom)).toEqual(firstLifecycle);
      expect(
        rootEvents(h.view, thirdFrom).every(
          (event) => event.sessionId === THREAD,
        ),
      ).toBe(true);
      expect(h.open).toHaveBeenCalledTimes(1);
      expect(h.server.close).not.toHaveBeenCalled();
      expect(h.adapter.isSessionActive(THREAD)).toBe(true);
      expect(
        h.view.messages().some(({ type }) => type === MESSAGE_TYPES.CHAT_ERROR),
      ).toBe(false);
      expect(h.callbacks.error).not.toHaveBeenCalled();
    } finally {
      h.dispose();
    }
  });

  it('keeps a resumed thread live after its turn streamed under the session id', async () => {
    const h = codexHarness();
    h.scriptTurn(TURN, 'Hello');
    try {
      await h.resume('hi');
      expect(lifecycle(h.view)).toEqual(FIRST_LIFECYCLE);
      expect(h.adapter.isSessionActive(THREAD)).toBe(true);
      expect(h.adapter.canSendFollowUp(THREAD)).toBe(true);
      expect(h.server.close).not.toHaveBeenCalled();

      const followUpFrom = h.view.messages().length;
      h.scriptTurn('turn-2', 'Hello', 2);
      await h.followUp('again');
      expect(lifecycle(h.view, followUpFrom)).toEqual(FIRST_LIFECYCLE);
      expect(h.open).toHaveBeenCalledTimes(1);
      expect(h.server.close).not.toHaveBeenCalled();
    } finally {
      h.dispose();
    }
  });

  it('still closes the thread when the session is ended explicitly', async () => {
    const h = codexHarness();
    h.scriptTurn(TURN, 'Hello');
    try {
      await h.start();
      h.scriptTurn('turn-2', 'Hello', 2);
      await h.followUp('again');
      await h.adapter.interruptSession(THREAD);
      expect(h.adapter.isSessionActive(THREAD)).toBe(false);
      expect(h.server.close).toHaveBeenCalledTimes(1);
    } finally {
      h.dispose();
    }
  });
});
