/**
 * ChatRpcHandlers — unit specs (TASK_2025_294 W2.B6).
 *
 * Surface under test: the seven RPC methods the chat pipeline exposes to the
 * webview (`chat:start`, `chat:continue`, `chat:resume`, `chat:abort`,
 * `chat:running-agents`, `agent:backgroundList`) plus the
 * `background-agent-completed` event subscription.
 *
 * Behavioural contracts locked in here:
 *
 *   - Registration: `register()` wires all RPC methods onto the mock
 *     RpcHandler and subscribes to `AgentSessionWatcherService`'s
 *     `background-agent-completed` event.
 *
 *   - `ChatRpcHandlers.hasStopIntent` (static): pure regex matcher — all
 *     standalone stop words + polite variants return true, long steering
 *     messages that just *mention* "stop" pass through as false.
 *
 *   - Workspace guards: `chat:start` / `chat:continue` / `chat:resume` all
 *     short-circuit with a structured error when no workspace is open.
 *
 *   - Ptah CLI dispatch: when `params.ptahCliId` is set, `chat:start`
 *     delegates to the registered adapter; when a session is mapped to a
 *     Ptah CLI agent, `chat:continue` / `chat:abort` dispatch accordingly.
 *     Missing adapter → structured error.
 *
 *   - Slash command interception: `chat:start` intercepts the `/clear`
 *     native command and broadcasts `CHAT_COMPLETE` without touching the
 *     SDK adapter.
 *
 *   - Stop-intent autopilot interrupt: `chat:continue` only interrupts the
 *     current turn when (a) session is active (no resume), (b) autopilot is
 *     on, (c) permission level is `yolo` or `auto-edit`, AND (d) the prompt
 *     clears `hasStopIntent`. Otherwise `sendMessageToSession` is called
 *     without interruption.
 *
 *   - Error paths: every RPC method captures exceptions via Sentry and
 *     returns a structured `{ success:false, error }` rather than throwing.
 *
 * Mocking posture: direct constructor injection with narrow
 * `jest.Mocked<Pick<T, ...>>` surfaces. No `as any` casts.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts`
 */

import 'reflect-metadata';

import type {
  AgentSessionWatcherService,
  ConfigManager,
  LicenseService,
  Logger,
  RpcHandler,
  SentryService,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import {
  createMockConfigManager,
  createMockRpcHandler,
  createMockSentryService,
  type MockConfigManager,
  type MockRpcHandler,
  type MockSentryService,
} from '@ptah-extension/vscode-core/testing';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  createMockWorkspaceProvider,
  type MockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import type {
  EnhancedPromptsService,
  PluginLoaderService,
  PtahCliRegistry,
  SessionHistoryReaderService,
  SessionMetadataStore,
  SlashCommandInterceptor,
} from '@ptah-extension/agent-sdk';
import type { CodeExecutionMCP } from '@ptah-extension/vscode-lm-tools';
import type {
  IAgentAdapter,
  ChatAbortParams,
  ChatContinueParams,
  ChatResumeParams,
  ChatStartParams,
  SessionId,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { ChatRpcHandlers } from './chat-rpc.handlers';

// ---------------------------------------------------------------------------
// Narrow mock surfaces — minimal `Pick<T, ...>` on each collaborator so
// we don't import the full class (many pull in VS Code / tsyringe wiring).
// ---------------------------------------------------------------------------

interface WebviewManagerLike {
  sendMessage(viewType: string, type: string, payload: unknown): Promise<void>;
  broadcastMessage(type: string, payload: unknown): Promise<void>;
}

type MockWebviewManager = jest.Mocked<WebviewManagerLike>;

function createMockWebviewManager(): MockWebviewManager {
  return {
    sendMessage: jest.fn().mockResolvedValue(undefined),
    broadcastMessage: jest.fn().mockResolvedValue(undefined),
  };
}

type MockSdkAdapter = jest.Mocked<
  Pick<
    IAgentAdapter,
    | 'startChatSession'
    | 'sendMessageToSession'
    | 'resumeSession'
    | 'interruptSession'
    | 'interruptCurrentTurn'
    | 'isSessionActive'
    | 'endSession'
    | 'executeSlashCommand'
  >
>;

function createMockSdkAdapter(): MockSdkAdapter {
  // The chat handler drives the async iterable in a detached promise —
  // tests don't assert what lands on the webview from it, only that the
  // adapter was called. An empty iterable is enough.
  const emptyStream = (async function* () {
    /* no events */
  })();
  return {
    startChatSession: jest.fn().mockResolvedValue(emptyStream),
    sendMessageToSession: jest.fn().mockResolvedValue(undefined),
    resumeSession: jest.fn().mockResolvedValue(emptyStream),
    interruptSession: jest.fn().mockResolvedValue(undefined),
    interruptCurrentTurn: jest.fn().mockResolvedValue(undefined),
    isSessionActive: jest.fn().mockReturnValue(true),
    endSession: jest.fn().mockResolvedValue(undefined),
    executeSlashCommand: jest.fn().mockResolvedValue(emptyStream),
  };
}

type MockHistoryReader = jest.Mocked<
  Pick<
    SessionHistoryReaderService,
    'readSessionHistory' | 'readHistoryAsMessages'
  >
>;

function createMockHistoryReader(): MockHistoryReader {
  return {
    readSessionHistory: jest.fn().mockResolvedValue({
      events: [],
      stats: {
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        messageCount: 0,
      },
    }),
    readHistoryAsMessages: jest.fn().mockResolvedValue([]),
  };
}

type MockSubagentRegistry = jest.Mocked<
  Pick<
    SubagentRegistryService,
    | 'getResumableBySession'
    | 'getRunningBySession'
    | 'getBackgroundAgents'
    | 'registerFromHistoryEvents'
    | 'remove'
    | 'markAsInjected'
    | 'update'
  >
> & { size: number };

function createMockSubagentRegistry(): MockSubagentRegistry {
  return {
    size: 0,
    getResumableBySession: jest.fn().mockReturnValue([]),
    getRunningBySession: jest.fn().mockReturnValue([]),
    getBackgroundAgents: jest.fn().mockReturnValue([]),
    registerFromHistoryEvents: jest.fn().mockReturnValue(0),
    remove: jest.fn(),
    markAsInjected: jest.fn(),
    update: jest.fn(),
  };
}

type MockLicenseService = jest.Mocked<Pick<LicenseService, 'verifyLicense'>>;

function createMockLicenseService(premium = false): MockLicenseService {
  return {
    verifyLicense: jest.fn().mockResolvedValue({
      valid: true,
      tier: premium ? 'pro' : 'free',
      plan: { isPremium: premium },
    }),
  } as unknown as MockLicenseService;
}

type MockCodeExecutionMcp = jest.Mocked<
  Pick<CodeExecutionMCP, 'getPort' | 'ensureRegisteredForSubagents'>
>;

function createMockCodeExecutionMcp(
  port: number | null = null,
): MockCodeExecutionMcp {
  return {
    getPort: jest.fn().mockReturnValue(port),
    ensureRegisteredForSubagents: jest.fn(),
  } as unknown as MockCodeExecutionMcp;
}

type MockEnhancedPrompts = jest.Mocked<
  Pick<EnhancedPromptsService, 'getEnhancedPromptContent'>
>;

function createMockEnhancedPrompts(): MockEnhancedPrompts {
  return {
    getEnhancedPromptContent: jest.fn().mockResolvedValue(null),
  } as unknown as MockEnhancedPrompts;
}

type MockPluginLoader = jest.Mocked<
  Pick<PluginLoaderService, 'getWorkspacePluginConfig' | 'resolvePluginPaths'>
>;

function createMockPluginLoader(): MockPluginLoader {
  return {
    getWorkspacePluginConfig: jest.fn().mockReturnValue({
      enabledPluginIds: [],
      disabledSkillIds: [],
    }),
    resolvePluginPaths: jest.fn().mockReturnValue([]),
  } as unknown as MockPluginLoader;
}

/**
 * AgentSessionWatcher mock must expose `.on(...)` so the constructor's
 * subscribe call lands on a jest.fn — we later introspect it to simulate
 * the `background-agent-completed` event.
 *
 * The handler only calls these 4 methods; everything else stays off the
 * mock surface.
 */
interface MockAgentWatcher {
  on: jest.Mock;
  stopAllForSession: jest.Mock;
  startWatching: jest.Mock;
  markAsBackground: jest.Mock;
}

function createMockAgentWatcher(): MockAgentWatcher {
  return {
    on: jest.fn(),
    stopAllForSession: jest.fn(),
    startWatching: jest.fn().mockResolvedValue(undefined),
    markAsBackground: jest.fn(),
  };
}

type MockPtahCliRegistry = jest.Mocked<Pick<PtahCliRegistry, 'getAdapter'>>;

function createMockPtahCliRegistry(
  adapter: unknown = null,
): MockPtahCliRegistry {
  return {
    getAdapter: jest.fn().mockResolvedValue(adapter),
  } as unknown as MockPtahCliRegistry;
}

type MockSlashInterceptor = jest.Mocked<
  Pick<SlashCommandInterceptor, 'intercept'>
>;

function createMockSlashInterceptor(
  action: 'passthrough' | 'native' | 'new-query' = 'passthrough',
  extras: Partial<{ commandName: string; rawCommand: string }> = {},
): MockSlashInterceptor {
  return {
    intercept: jest.fn().mockReturnValue({
      action,
      ...extras,
    }),
  } as unknown as MockSlashInterceptor;
}

type MockSessionMetadataStore = jest.Mocked<
  Pick<SessionMetadataStore, 'get' | 'createChild'>
>;

function createMockSessionMetadataStore(): MockSessionMetadataStore {
  return {
    get: jest.fn().mockResolvedValue(null),
    createChild: jest.fn().mockResolvedValue(undefined),
  } as unknown as MockSessionMetadataStore;
}

// ---------------------------------------------------------------------------
// Harness — threads all 15 collaborators into `new ChatRpcHandlers(...)` in
// the exact constructor order so the spec can exercise each method directly
// through `rpcHandler.handleMessage`.
// ---------------------------------------------------------------------------

interface Harness {
  handlers: ChatRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  webviewManager: MockWebviewManager;
  configManager: MockConfigManager;
  sdkAdapter: MockSdkAdapter;
  historyReader: MockHistoryReader;
  subagentRegistry: MockSubagentRegistry;
  licenseService: MockLicenseService;
  codeExecutionMcp: MockCodeExecutionMcp;
  enhancedPrompts: MockEnhancedPrompts;
  pluginLoader: MockPluginLoader;
  agentSessionWatcher: MockAgentWatcher;
  ptahCliRegistry: MockPtahCliRegistry;
  slashCommandInterceptor: MockSlashInterceptor;
  sessionMetadataStore: MockSessionMetadataStore;
  workspaceProvider: MockWorkspaceProvider;
  sentry: MockSentryService;
}

interface HarnessOptions {
  premium?: boolean;
  workspaceRoot?: string | null;
  configSeed?: Record<string, unknown>;
  slashAction?: 'passthrough' | 'native' | 'new-query';
  slashExtras?: Partial<{ commandName: string; rawCommand: string }>;
  ptahCliAdapter?: unknown;
}

function makeHarness(opts: HarnessOptions = {}): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const webviewManager = createMockWebviewManager();
  const configManager = createMockConfigManager({
    values: opts.configSeed,
  });
  const sdkAdapter = createMockSdkAdapter();
  const historyReader = createMockHistoryReader();
  const subagentRegistry = createMockSubagentRegistry();
  const licenseService = createMockLicenseService(opts.premium);
  const codeExecutionMcp = createMockCodeExecutionMcp();
  const enhancedPrompts = createMockEnhancedPrompts();
  const pluginLoader = createMockPluginLoader();
  const agentSessionWatcher = createMockAgentWatcher();
  const ptahCliRegistry = createMockPtahCliRegistry(
    opts.ptahCliAdapter ?? null,
  );
  const slashCommandInterceptor = createMockSlashInterceptor(
    opts.slashAction,
    opts.slashExtras,
  );
  const sessionMetadataStore = createMockSessionMetadataStore();
  const workspaceProvider = createMockWorkspaceProvider({
    folders:
      opts.workspaceRoot === null ? [] : [opts.workspaceRoot ?? 'D:/workspace'],
  });
  const sentry = createMockSentryService();

  const handlers = new ChatRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as RpcHandler,
    webviewManager as unknown as WebviewManagerLike,
    configManager as unknown as ConfigManager,
    sdkAdapter as unknown as IAgentAdapter,
    historyReader as unknown as SessionHistoryReaderService,
    subagentRegistry as unknown as SubagentRegistryService,
    licenseService as unknown as LicenseService,
    codeExecutionMcp as unknown as CodeExecutionMCP,
    enhancedPrompts as unknown as EnhancedPromptsService,
    pluginLoader as unknown as PluginLoaderService,
    agentSessionWatcher as unknown as AgentSessionWatcherService,
    ptahCliRegistry as unknown as PtahCliRegistry,
    slashCommandInterceptor as unknown as SlashCommandInterceptor,
    sessionMetadataStore as unknown as SessionMetadataStore,
    workspaceProvider as unknown as IWorkspaceProvider,
    sentry as unknown as SentryService,
  );

  return {
    handlers,
    logger,
    rpcHandler,
    webviewManager,
    configManager,
    sdkAdapter,
    historyReader,
    subagentRegistry,
    licenseService,
    codeExecutionMcp,
    enhancedPrompts,
    pluginLoader,
    agentSessionWatcher,
    ptahCliRegistry,
    slashCommandInterceptor,
    sessionMetadataStore,
    workspaceProvider,
    sentry,
  };
}

interface RpcEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function callRaw<TResult>(
  h: Harness,
  method: string,
  params: unknown = {},
): Promise<RpcEnvelope<TResult>> {
  const response = await h.rpcHandler.handleMessage({
    method,
    params: params as Record<string, unknown>,
    correlationId: `corr-${method}`,
  });
  return response as RpcEnvelope<TResult>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatRpcHandlers', () => {
  describe('hasStopIntent (static)', () => {
    it.each([
      'stop',
      'STOP',
      'stop.',
      'stop!!!',
      'cancel',
      'abort',
      'halt',
      'quit',
      'nvm',
      'please stop',
      'stop now',
      'stop it',
      'stop please',
      'cancel it',
      "don't continue",
      'stop the execution',
      "stop what you're doing",
    ])('returns true for clear stop phrase %p', (msg) => {
      expect(ChatRpcHandlers.hasStopIntent(msg)).toBe(true);
    });

    it.each([
      'stop using semicolons and switch to the new API pattern',
      'also update tests',
      'cancel the old approach and try X instead with a longer body',
      'keep going',
      'continue please',
      '',
    ])('returns false for steering/benign message %p', (msg) => {
      expect(ChatRpcHandlers.hasStopIntent(msg)).toBe(false);
    });
  });

  describe('register()', () => {
    it('wires every chat RPC method onto the RpcHandler', () => {
      const h = makeHarness();
      h.handlers.register();

      // registerMethod is called once per RPC — chat:start, chat:continue,
      // chat:resume, chat:abort, chat:running-agents, agent:backgroundList.
      const methods = h.rpcHandler.registerMethod.mock.calls.map(
        (args) => args[0] as string,
      );
      expect(methods).toEqual(
        expect.arrayContaining([
          'chat:start',
          'chat:continue',
          'chat:resume',
          'chat:abort',
          'chat:running-agents',
          'agent:backgroundList',
        ]),
      );
    });

    it('subscribes to the background-agent-completed watcher event', () => {
      const h = makeHarness();
      h.handlers.register();

      expect(h.agentSessionWatcher.on).toHaveBeenCalledWith(
        'background-agent-completed',
        expect.any(Function),
      );
    });

    it('broadcasts CHAT_CHUNK when the watcher fires background-agent-completed', async () => {
      const h = makeHarness();
      h.handlers.register();

      const firstCall = h.agentSessionWatcher.on.mock.calls[0];
      const callback = firstCall[1] as (data: {
        agentId: string;
        toolCallId: string;
        agentType: string;
        duration?: number;
        summaryContent?: string;
        sessionId?: string;
      }) => void;
      callback({
        agentId: 'agent-abc',
        toolCallId: 'tool-1',
        agentType: 'researcher',
        duration: 1234,
        summaryContent: 'done',
        sessionId: 'sess-xyz',
      });

      // broadcast is fire-and-forget; flush microtasks so we can assert.
      await Promise.resolve();

      expect(h.webviewManager.broadcastMessage).toHaveBeenCalledWith(
        'chat:chunk',
        expect.objectContaining({
          event: expect.objectContaining({
            eventType: 'background_agent_completed',
            agentId: 'agent-abc',
            toolCallId: 'tool-1',
            agentType: 'researcher',
            sessionId: 'sess-xyz',
            duration: 1234,
            result: 'done',
          }),
        }),
      );
    });
  });

  describe('chat:start', () => {
    const baseParams: ChatStartParams = {
      prompt: 'hello',
      tabId: 'tab-1',
      workspacePath: 'D:/workspace',
      name: 'Test Session',
      options: {},
    };

    it('returns an error when no workspace is open', async () => {
      const h = makeHarness({ workspaceRoot: null });
      h.handlers.register();

      const res = await callRaw<{ success: boolean; error?: string }>(
        h,
        'chat:start',
        {
          ...baseParams,
          workspacePath: undefined,
        },
      );

      expect(res.success).toBe(true); // RPC envelope itself succeeded
      expect(res.data).toEqual({
        success: false,
        error: expect.stringContaining('No workspace folder open'),
      });
      expect(h.sdkAdapter.startChatSession).not.toHaveBeenCalled();
    });

    it('starts an SDK session on the happy path and forwards the prompt', async () => {
      const h = makeHarness();
      h.handlers.register();

      const res = await callRaw<{ success: boolean }>(
        h,
        'chat:start',
        baseParams,
      );

      expect(res.success).toBe(true);
      expect(res.data).toEqual({ success: true });
      expect(h.sdkAdapter.startChatSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tabId: 'tab-1',
          workspaceId: 'D:/workspace',
          projectPath: 'D:/workspace',
          prompt: 'hello',
          name: 'Test Session',
        }),
      );
    });

    it('short-circuits on the native /clear slash command and never touches the SDK', async () => {
      const h = makeHarness({
        slashAction: 'native',
        slashExtras: { commandName: 'clear' },
      });
      h.handlers.register();

      const res = await callRaw<{ success: boolean }>(
        h,
        'chat:start',
        baseParams,
      );

      expect(res.success).toBe(true);
      expect(res.data).toEqual({ success: true });
      expect(h.sdkAdapter.startChatSession).not.toHaveBeenCalled();
      expect(h.webviewManager.broadcastMessage).toHaveBeenCalledWith(
        'chat:complete',
        expect.objectContaining({ tabId: 'tab-1', command: 'clear' }),
      );
    });

    it('dispatches to a Ptah CLI adapter when ptahCliId is present', async () => {
      const adapter = {
        info: { name: 'my-cli' },
        startChatSession: jest.fn().mockResolvedValue(
          (async function* () {
            /* empty stream */
          })(),
        ),
      };
      const h = makeHarness({ ptahCliAdapter: adapter });
      h.handlers.register();

      const res = await callRaw<{ success: boolean }>(h, 'chat:start', {
        ...baseParams,
        ptahCliId: 'cli-agent-1',
      });

      expect(res.success).toBe(true);
      expect(h.ptahCliRegistry.getAdapter).toHaveBeenCalledWith('cli-agent-1');
      expect(adapter.startChatSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tabId: 'tab-1',
          workspaceId: 'D:/workspace',
          prompt: 'hello',
        }),
      );
      // Main SDK adapter MUST NOT be invoked on the Ptah CLI path.
      expect(h.sdkAdapter.startChatSession).not.toHaveBeenCalled();
    });

    it('returns a structured error when the Ptah CLI adapter is missing', async () => {
      const h = makeHarness({ ptahCliAdapter: null });
      h.handlers.register();

      const res = await callRaw<{ success: boolean; error: string }>(
        h,
        'chat:start',
        { ...baseParams, ptahCliId: 'missing-cli' },
      );

      expect(res.data).toEqual({
        success: false,
        error: expect.stringContaining('missing-cli'),
      });
    });

    it('captures unexpected errors via Sentry and returns structured failure', async () => {
      const h = makeHarness();
      h.sdkAdapter.startChatSession.mockRejectedValueOnce(new Error('boom'));
      h.handlers.register();

      const res = await callRaw<{ success: boolean; error: string }>(
        h,
        'chat:start',
        baseParams,
      );

      expect(res.data).toEqual({ success: false, error: 'boom' });
      expect(h.sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          errorSource: 'ChatRpcHandlers.registerChatStart',
        }),
      );
    });
  });

  describe('chat:continue', () => {
    const baseParams: ChatContinueParams = {
      prompt: 'follow up',
      sessionId: 'sess-1' as SessionId,
      tabId: 'tab-1',
      workspacePath: 'D:/workspace',
    };

    it('returns an error when no workspace is open', async () => {
      const h = makeHarness({ workspaceRoot: null });
      h.handlers.register();

      const res = await callRaw<{ success: boolean; error?: string }>(
        h,
        'chat:continue',
        { ...baseParams, workspacePath: undefined },
      );

      expect(res.data).toEqual({
        success: false,
        error: expect.stringContaining('No workspace folder open'),
      });
      expect(h.sdkAdapter.sendMessageToSession).not.toHaveBeenCalled();
    });

    it('sends a message to the active session on the happy path', async () => {
      const h = makeHarness();
      h.sdkAdapter.isSessionActive.mockReturnValue(true);
      h.handlers.register();

      const res = await callRaw<{ success: boolean; sessionId: string }>(
        h,
        'chat:continue',
        baseParams,
      );

      expect(res.data).toEqual({ success: true, sessionId: 'sess-1' });
      expect(h.sdkAdapter.sendMessageToSession).toHaveBeenCalledWith(
        'sess-1',
        'follow up',
        expect.objectContaining({ files: [], images: [] }),
      );
      // No resume — session was already active.
      expect(h.sdkAdapter.resumeSession).not.toHaveBeenCalled();
    });

    it('resumes the session when inactive, then continues', async () => {
      const h = makeHarness();
      h.sdkAdapter.isSessionActive.mockReturnValue(false);
      h.handlers.register();

      const res = await callRaw<{ success: boolean }>(
        h,
        'chat:continue',
        baseParams,
      );

      expect(res.data?.success).toBe(true);
      expect(h.sdkAdapter.resumeSession).toHaveBeenCalledWith(
        'sess-1',
        expect.objectContaining({
          projectPath: 'D:/workspace',
          tabId: 'tab-1',
        }),
      );
      // After resume succeeds we still send the message so the agent sees it.
      expect(h.sdkAdapter.sendMessageToSession).toHaveBeenCalled();
    });

    it('surfaces resume failures without sending a message', async () => {
      const h = makeHarness();
      h.sdkAdapter.isSessionActive.mockReturnValue(false);
      h.sdkAdapter.resumeSession.mockRejectedValueOnce(
        new Error('resume failed'),
      );
      h.handlers.register();

      const res = await callRaw<{
        success: boolean;
        sessionId: string;
        error: string;
      }>(h, 'chat:continue', baseParams);

      expect(res.data).toEqual({
        success: false,
        sessionId: 'sess-1',
        error: 'resume failed',
      });
      expect(h.sdkAdapter.sendMessageToSession).not.toHaveBeenCalled();
    });

    it('interrupts the current turn when stop intent is detected in yolo autopilot', async () => {
      const h = makeHarness({
        configSeed: {
          'autopilot.enabled': true,
          'autopilot.permissionLevel': 'yolo',
        },
      });
      h.sdkAdapter.isSessionActive.mockReturnValue(true);
      h.handlers.register();

      const res = await callRaw<{ success: boolean }>(h, 'chat:continue', {
        ...baseParams,
        prompt: 'stop',
      });

      expect(res.data?.success).toBe(true);
      expect(h.sdkAdapter.interruptCurrentTurn).toHaveBeenCalledWith('sess-1');
      // Message is STILL sent so the agent acknowledges the stop.
      expect(h.sdkAdapter.sendMessageToSession).toHaveBeenCalled();
    });

    it('does not interrupt when autopilot is in ask mode', async () => {
      const h = makeHarness({
        configSeed: {
          'autopilot.enabled': true,
          'autopilot.permissionLevel': 'ask',
        },
      });
      h.sdkAdapter.isSessionActive.mockReturnValue(true);
      h.handlers.register();

      await callRaw<{ success: boolean }>(h, 'chat:continue', {
        ...baseParams,
        prompt: 'stop',
      });

      expect(h.sdkAdapter.interruptCurrentTurn).not.toHaveBeenCalled();
      expect(h.sdkAdapter.sendMessageToSession).toHaveBeenCalled();
    });

    it('dispatches chat:continue to Ptah CLI adapter when session is mapped', async () => {
      // Seed the Ptah CLI session map via `chat:resume` — it registers the
      // mapping WITHOUT starting a stream (unlike chat:start, whose
      // streamExecutionNodesToWebview finally-block clears the map on
      // stream completion for empty-iterable mocks).
      const cliAdapter = {
        info: { name: 'cli' },
        sendMessageToSession: jest.fn().mockResolvedValue(undefined),
        getHealth: jest.fn().mockReturnValue({ status: 'available' }),
        endSession: jest.fn(),
      };
      const h = makeHarness({ ptahCliAdapter: cliAdapter });
      h.handlers.register();

      const resumeRes = await callRaw<{ success: boolean; error?: string }>(
        h,
        'chat:resume',
        {
          sessionId: 'sess-cli-1' as SessionId,
          tabId: 'tab-cli',
          workspacePath: 'D:/workspace',
          ptahCliId: 'cli-1',
        },
      );
      expect(resumeRes.data?.success).toBe(true);

      // Now chat:continue should dispatch to Ptah CLI adapter.
      const res = await callRaw<{ success: boolean; sessionId: string }>(
        h,
        'chat:continue',
        {
          prompt: 'next',
          sessionId: 'sess-cli-1' as SessionId,
          tabId: 'tab-cli',
          workspacePath: 'D:/workspace',
        },
      );

      expect(res.data?.success).toBe(true);
      expect(cliAdapter.sendMessageToSession).toHaveBeenCalledWith(
        'sess-cli-1',
        'next',
        expect.objectContaining({ files: [] }),
      );
      // Main SDK adapter must NOT be invoked for a Ptah CLI session.
      expect(h.sdkAdapter.sendMessageToSession).not.toHaveBeenCalled();
    });

    it('intercepts the native /clear slash command and broadcasts CHAT_COMPLETE', async () => {
      const h = makeHarness({
        slashAction: 'native',
        slashExtras: { commandName: 'clear' },
      });
      h.sdkAdapter.isSessionActive.mockReturnValue(true);
      h.handlers.register();

      const res = await callRaw<{ success: boolean; sessionId: string }>(
        h,
        'chat:continue',
        baseParams,
      );

      expect(res.data?.success).toBe(true);
      expect(h.sdkAdapter.interruptSession).toHaveBeenCalledWith('sess-1');
      expect(h.agentSessionWatcher.stopAllForSession).toHaveBeenCalledWith(
        'sess-1',
      );
      expect(h.webviewManager.broadcastMessage).toHaveBeenCalledWith(
        'chat:complete',
        expect.objectContaining({ command: 'clear' }),
      );
      // /clear handled — regular sendMessage must NOT run.
      expect(h.sdkAdapter.sendMessageToSession).not.toHaveBeenCalled();
    });

    it('captures unexpected errors via Sentry', async () => {
      const h = makeHarness();
      h.sdkAdapter.isSessionActive.mockImplementation(() => {
        throw new Error('kaboom');
      });
      h.handlers.register();

      const res = await callRaw<{ success: boolean; error: string }>(
        h,
        'chat:continue',
        baseParams,
      );

      expect(res.data).toMatchObject({ success: false, error: 'kaboom' });
      expect(h.sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          errorSource: 'ChatRpcHandlers.registerChatContinue',
        }),
      );
    });
  });

  describe('chat:resume', () => {
    const baseParams: ChatResumeParams = {
      sessionId: 'sess-1' as SessionId,
      tabId: 'tab-1',
      workspacePath: 'D:/workspace',
    };

    it('returns an error when no workspace is open', async () => {
      const h = makeHarness({ workspaceRoot: null });
      h.handlers.register();

      const res = await callRaw<{ success: boolean; error?: string }>(
        h,
        'chat:resume',
        { sessionId: 'sess-1' as SessionId, tabId: 'tab-1' },
      );

      expect(res.data).toEqual({
        success: false,
        error: expect.stringContaining('No workspace folder open'),
      });
      expect(h.historyReader.readSessionHistory).not.toHaveBeenCalled();
    });

    it('loads messages + events from the history reader on the happy path', async () => {
      const h = makeHarness();
      h.historyReader.readSessionHistory.mockResolvedValueOnce({
        events: [{ eventType: 'message_start' }],
        stats: {
          totalCost: 1.5,
          totalInputTokens: 100,
          totalOutputTokens: 50,
          messageCount: 2,
        },
      } as unknown as Awaited<
        ReturnType<typeof h.historyReader.readSessionHistory>
      >);
      h.historyReader.readHistoryAsMessages.mockResolvedValueOnce([
        { role: 'user', content: 'hi' },
      ] as unknown as Awaited<
        ReturnType<typeof h.historyReader.readHistoryAsMessages>
      >);
      h.handlers.register();

      const res = await callRaw<{
        success: boolean;
        messages: unknown[];
        events: unknown[];
        stats: { totalCost: number };
      }>(h, 'chat:resume', baseParams);

      expect(res.data?.success).toBe(true);
      expect(res.data?.events).toHaveLength(1);
      expect(res.data?.messages).toHaveLength(1);
      expect(res.data?.stats?.totalCost).toBe(1.5);
      expect(h.historyReader.readSessionHistory).toHaveBeenCalledWith(
        'sess-1',
        'D:/workspace',
      );
    });

    it('registers interrupted agents from history via subagentRegistry', async () => {
      const h = makeHarness();
      h.subagentRegistry.registerFromHistoryEvents.mockReturnValue(3);
      h.handlers.register();

      await callRaw<{ success: boolean }>(h, 'chat:resume', baseParams);

      expect(h.subagentRegistry.registerFromHistoryEvents).toHaveBeenCalledWith(
        expect.any(Array),
        'sess-1',
      );
    });

    it('captures unexpected errors via Sentry', async () => {
      const h = makeHarness();
      h.historyReader.readSessionHistory.mockRejectedValueOnce(
        new Error('disk read failed'),
      );
      h.handlers.register();

      const res = await callRaw<{ success: boolean; error: string }>(
        h,
        'chat:resume',
        baseParams,
      );

      expect(res.data).toEqual({
        success: false,
        error: 'disk read failed',
      });
      expect(h.sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          errorSource: 'ChatRpcHandlers.registerChatResume',
        }),
      );
    });
  });

  describe('chat:abort', () => {
    const baseParams: ChatAbortParams = {
      sessionId: 'sess-1' as SessionId,
    };

    it('interrupts the SDK session and stops watchers on the happy path', async () => {
      const h = makeHarness();
      h.handlers.register();

      const res = await callRaw<{ success: boolean }>(
        h,
        'chat:abort',
        baseParams,
      );

      expect(res.data?.success).toBe(true);
      expect(h.sdkAdapter.interruptSession).toHaveBeenCalledWith('sess-1');
      expect(h.agentSessionWatcher.stopAllForSession).toHaveBeenCalledWith(
        'sess-1',
      );
    });

    it('dispatches abort to the Ptah CLI adapter when the session was CLI-started', async () => {
      const cliAdapter = {
        info: { name: 'cli' },
        sendMessageToSession: jest.fn(),
        getHealth: jest.fn().mockReturnValue({ status: 'available' }),
        endSession: jest.fn(),
      };
      const h = makeHarness({ ptahCliAdapter: cliAdapter });
      h.handlers.register();

      // Seed the Ptah CLI session map via chat:resume (no stream cleanup races).
      await callRaw<{ success: boolean }>(h, 'chat:resume', {
        sessionId: 'cli-session-id' as SessionId,
        tabId: 'cli-session-tab',
        workspacePath: 'D:/workspace',
        ptahCliId: 'cli-1',
      });

      const res = await callRaw<{ success: boolean }>(h, 'chat:abort', {
        sessionId: 'cli-session-id' as SessionId,
      });

      expect(res.data?.success).toBe(true);
      expect(cliAdapter.endSession).toHaveBeenCalledWith('cli-session-id');
      // Main SDK adapter's interruptSession must NOT be invoked.
      expect(h.sdkAdapter.interruptSession).not.toHaveBeenCalled();
    });

    it('captures unexpected errors via Sentry', async () => {
      const h = makeHarness();
      h.sdkAdapter.interruptSession.mockRejectedValueOnce(new Error('fail'));
      h.handlers.register();

      const res = await callRaw<{ success: boolean; error: string }>(
        h,
        'chat:abort',
        baseParams,
      );

      expect(res.data).toEqual({ success: false, error: 'fail' });
      expect(h.sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          errorSource: 'ChatRpcHandlers.registerChatAbort',
        }),
      );
    });
  });

  describe('chat:running-agents', () => {
    it('returns the running subagents for the session', async () => {
      const h = makeHarness();
      h.subagentRegistry.getRunningBySession.mockReturnValueOnce([
        { agentId: 'agent-1', agentType: 'researcher' },
        { agentId: 'agent-2', agentType: 'coder' },
      ] as ReturnType<typeof h.subagentRegistry.getRunningBySession>);
      h.handlers.register();

      const res = await callRaw<{ agents: Array<{ agentId: string }> }>(
        h,
        'chat:running-agents',
        { sessionId: 'sess-1' },
      );

      expect(res.data?.agents).toEqual([
        { agentId: 'agent-1', agentType: 'researcher' },
        { agentId: 'agent-2', agentType: 'coder' },
      ]);
      expect(h.subagentRegistry.getRunningBySession).toHaveBeenCalledWith(
        'sess-1',
      );
    });

    it('returns an empty list and captures Sentry when the registry throws', async () => {
      const h = makeHarness();
      h.subagentRegistry.getRunningBySession.mockImplementation(() => {
        throw new Error('registry down');
      });
      h.handlers.register();

      const res = await callRaw<{ agents: unknown[] }>(
        h,
        'chat:running-agents',
        {
          sessionId: 'sess-1',
        },
      );

      expect(res.data).toEqual({ agents: [] });
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  describe('agent:backgroundList', () => {
    it('returns a normalized projection of background agents', async () => {
      const h = makeHarness();
      h.subagentRegistry.getBackgroundAgents.mockReturnValueOnce([
        {
          toolCallId: 'tc-1',
          agentId: 'ag-1',
          agentType: 'researcher',
          status: 'background',
          startedAt: 10,
          extraIgnored: 'should not leak',
        },
      ] as unknown as ReturnType<
        typeof h.subagentRegistry.getBackgroundAgents
      >);
      h.handlers.register();

      const res = await callRaw<{ agents: Array<Record<string, unknown>> }>(
        h,
        'agent:backgroundList',
        { sessionId: 'sess-1' },
      );

      expect(res.data?.agents).toEqual([
        {
          toolCallId: 'tc-1',
          agentId: 'ag-1',
          agentType: 'researcher',
          status: 'background',
          startedAt: 10,
        },
      ]);
      expect(h.subagentRegistry.getBackgroundAgents).toHaveBeenCalledWith(
        'sess-1',
      );
    });

    it('returns empty list on registry errors and reports to Sentry', async () => {
      const h = makeHarness();
      h.subagentRegistry.getBackgroundAgents.mockImplementation(() => {
        throw new Error('boom');
      });
      h.handlers.register();

      const res = await callRaw<{ agents: unknown[] }>(
        h,
        'agent:backgroundList',
        {
          sessionId: 'sess-1',
        },
      );

      expect(res.data).toEqual({ agents: [] });
      expect(h.sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          errorSource: 'ChatRpcHandlers.registerBackgroundAgentHandlers',
        }),
      );
    });
  });
});
