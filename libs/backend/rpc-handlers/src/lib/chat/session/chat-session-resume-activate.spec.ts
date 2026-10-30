import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/**
 * ChatSessionService — `resumeSession` with `activate: true` activation-failure
 * path (TS-04 fix).
 *
 * Pre-fix: when `autoResumeIfInactive` returned `{ error: ChatContinueResult }`
 * the handler only matched the `'justResumed' in activateResult` branch, so
 * the activation failure was silently swallowed — `activated:false` shipped
 * with no error context. Post-fix: the `else` branch surfaces
 * `activationError` / `activationErrorCode` on the {@link ChatResumeResult}
 * so the resume-and-retry rewind path can recover.
 */

import 'reflect-metadata';

// `ChatSessionService` now imports `@ptah-extension/cli-agent-runtime` (for the
// session-time Smithery override resolver), whose barrel transitively pulls
// `@ptah-extension/workspace-intelligence`. That lib's TreeSitter module
// evaluates `import.meta.url` at top level — a construct ts-jest's CJS
// transform cannot parse. Stub it (mirrors `chat-session-auth.spec`).
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

import type {
  Logger,
  ConfigManager,
  SentryService,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  ChatResumeParams,
  ChatResumeResult,
  IAgentAdapter,
  SessionId,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { ModelSettings } from '@ptah-extension/settings-core';

import { createMockModelSettings } from '../../../test-utils/mock-settings';
import { ChatSessionService } from './chat-session.service';
import { ChatHistoryReadService } from './chat-history-read.service';
import { SessionMcpStatusRegistry } from './session-mcp-status.registry';

const TEST_ROOT = mkdtempSync(join(tmpdir(), 'ptah-session-policy-'));
afterAll(() => rmSync(TEST_ROOT, { recursive: true, force: true }));
for (const part of [
  'my-repo/ancestor',
  'my-repo/child',
  'my-repo/.claude/worktrees/fix',
])
  mkdirSync(join(TEST_ROOT, part), { recursive: true });
const OPEN_FOLDER = `${TEST_ROOT}/my-repo`;
const SESSION_ID = '11111111-1111-4111-8111-111111111111' as SessionId;
const TAB_ID = '22222222-2222-4222-8222-222222222222';

function makeService(params: {
  isSessionActive?: jest.Mock;
  resumeSession?: jest.Mock;
  isStreaming?: jest.Mock;
  mcpServerRunning?: boolean;
  historyReader?: {
    readSessionHistory?: jest.Mock;
  };
  metadata?: Record<string, unknown> | null;
  fileExists?: jest.Mock;
  readSessionHistory?: jest.Mock;
  hydrateResumeState?: jest.Mock;
  isResumeStateHydrated?: jest.Mock;
  metadataGet?: jest.Mock;
  registerFromHistoryEvents?: jest.Mock;
  getResumableBySession?: jest.Mock;
  getInterruptedBySession?: jest.Mock;
  saveResumeState?: jest.Mock;
  upgradeLegacyPluginConfigAncestorRoots?: jest.Mock;
  sessionEndRegister?: jest.Mock;
  restoreAgents?: jest.Mock;
}): ChatSessionService {
  const noop = jest.fn();
  const stub = { then: undefined } as unknown;
  const logger: MockLogger = createMockLogger();
  const provider = createMockWorkspaceProvider({ folders: [OPEN_FOLDER] });

  const sdkAdapter = {
    isSessionActive: params.isSessionActive ?? jest.fn().mockReturnValue(false),
    resumeSession:
      params.resumeSession ??
      jest.fn().mockRejectedValue(new Error('boom: resume rejected')),
    interruptSession: jest.fn(),
  } as unknown as IAgentAdapter;

  const historyReader = {
    readSessionHistory:
      params.readSessionHistory ??
      params.historyReader?.readSessionHistory ??
      jest.fn().mockResolvedValue({ events: [], stats: null }),
  };
  const subagentRegistry = {
    hydrateResumeState:
      params.hydrateResumeState ?? jest.fn().mockReturnValue(0),
    isResumeStateHydrated:
      params.isResumeStateHydrated ?? jest.fn().mockReturnValue(false),
    registerFromHistoryEvents:
      params.registerFromHistoryEvents ?? jest.fn().mockReturnValue(0),
    getResumableBySession:
      params.getResumableBySession ?? jest.fn().mockReturnValue([]),
    getInterruptedBySession:
      params.getInterruptedBySession ?? jest.fn().mockReturnValue([]),
  } as unknown as SubagentRegistryService;
  const sessionMetadataStore = {
    // Real records always carry `workspaceId`; the session's folder falls back
    // to it when the saved cwd is gone.
    get:
      params.metadataGet ??
      jest
        .fn()
        .mockResolvedValue(
          params.metadata === null
            ? null
            : { workspaceId: OPEN_FOLDER, ...params.metadata },
        ),
    getCliSessionsForRestore: jest.fn().mockResolvedValue([]),
    saveResumeState:
      params.saveResumeState ?? jest.fn().mockResolvedValue(undefined),
    upgradeLegacyPluginConfigAncestorRoots:
      params.upgradeLegacyPluginConfigAncestorRoots ??
      jest.fn().mockResolvedValue({ status: 'valid', roots: [] }),
  };
  const platformInfo = {
    type: 'cli',
    extensionPath: '/tmp/ptah-app',
    globalStoragePath: '/tmp/ptah-storage',
    workspaceStoragePath: '/tmp/ptah-workspace-storage',
  };
  const historyRead = new ChatHistoryReadService(
    logger as unknown as Logger,
    historyReader as never,
    sessionMetadataStore as never,
    subagentRegistry,
    provider as unknown as IWorkspaceProvider,
    platformInfo as never,
  );
  const sdkContext = {
    isMcpServerRunning: jest
      .fn()
      .mockReturnValue(params.mcpServerRunning ?? false),
    resolveEnhancedPromptsContent: jest.fn().mockResolvedValue(undefined),
    resolvePluginPaths: jest.fn().mockReturnValue([]),
  };
  const codeExecutionMcp = {
    getPort: jest.fn().mockReturnValue(0),
  };
  // `isStreaming` is load-bearing, not filler: `hasLiveSessionStream` treats a
  // session as live only when the adapter reports it active AND the broadcaster
  // reports an attached stream (5cff0927a). Omitting it makes the call
  // `undefined` and the resulting TypeError surfaces as `success:false` from the
  // outer catch — which is exactly how this spec broke.
  const streamBroadcaster = {
    streamEventsToWebview: jest.fn(),
    isStreaming: params.isStreaming ?? jest.fn().mockReturnValue(false),
  };

  return new ChatSessionService(
    logger as unknown as Logger,
    { broadcastMessage: noop } as never,
    {
      get: noop,
      getWithDefault: jest.fn().mockReturnValue(false),
    } as unknown as ConfigManager,
    sdkAdapter,
    { captureException: jest.fn() } as unknown as SentryService,
    codeExecutionMcp as never,
    historyRead,
    subagentRegistry,
    {
      intercept: jest.fn().mockReturnValue({ action: 'passthrough' }),
    } as never,
    sessionMetadataStore as never,
    provider as unknown as IWorkspaceProvider,
    platformInfo as never,
    sdkContext as never,
    {
      handleStart: jest.fn().mockResolvedValue({ result: { success: false } }),
      registerResumedSession: jest.fn(),
    } as never,
    streamBroadcaster as never,
    stub as never,
    stub as never,
    createMockModelSettings() as unknown as ModelSettings,
    {
      getProviderKey: jest.fn().mockResolvedValue(null),
      setProviderKey: jest.fn().mockResolvedValue(undefined),
      deleteProviderKey: jest.fn().mockResolvedValue(undefined),
    } as never,
    {
      resolveStoredModel: jest.fn(
        (_path: string, model: string) => model || 'default',
      ),
      resolveProviderProfileForWorkspace: jest
        .fn()
        .mockResolvedValue(undefined),
    } as never,
    // OutputStyleSessionActivationService — no style selected in these specs.
    { resolveSessionFields: jest.fn().mockResolvedValue({}) } as never,
    // SessionMcpStatusRegistry + its agent-sdk fan-out (TASK_2026_375 B4.3).
    // The constructor subscribes to the fan-out, so `register` must exist; a
    // real registry is cheap and keeps the stub honest.
    new SessionMcpStatusRegistry(),
    { register: jest.fn().mockReturnValue(() => undefined) } as never,
    {
      register:
        params.sessionEndRegister ?? jest.fn().mockReturnValue(() => undefined),
    } as never,
    params.restoreAgents
      ? ({ restoreAgents: params.restoreAgents } as never)
      : null,
  );
}

describe('ChatSessionService — resumeSession activate:true (TS-04)', () => {
  it.each([
    {
      roots: [`${TEST_ROOT}/my-repo/ancestor`],
      expected: [`${TEST_ROOT}/my-repo/ancestor`],
    },
    { roots: [], expected: [] },
  ])(
    'passes stored lineage $roots to activation',
    async ({ roots, expected }) => {
      const resumeSession = jest
        .fn()
        .mockResolvedValue((async function* () {})());
      const svc = makeService({
        metadata: { pluginConfigAncestorRoots: roots },
        resumeSession,
      });
      const result = await svc.resumeSession({
        sessionId: SESSION_ID,
        tabId: TAB_ID,
        activate: true,
      });
      expect(result.activated).toBe(true);
      expect(resumeSession).toHaveBeenCalledWith(
        SESSION_ID,
        expect.objectContaining({ pluginConfigAncestorRoots: expected }),
      );
    },
  );

  it('refuses malformed stored lineage before SDK activation', async () => {
    const resumeSession = jest.fn();
    const svc = makeService({
      metadata: { pluginConfigAncestorRoots: [''] },
      resumeSession,
    });
    const result = await svc.resumeSession({
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      activate: true,
    });
    expect(result.activated).toBe(false);
    expect(result.activationError).toMatch(/malformed/);
    expect(resumeSession).not.toHaveBeenCalled();
  });

  it('refuses a removed stored ancestor before SDK activation', async () => {
    const resumeSession = jest.fn();
    const svc = makeService({
      metadata: {
        pluginConfigAncestorRoots: [join(OPEN_FOLDER, 'removed-ancestor')],
      },
      resumeSession,
    });
    const result = await svc.resumeSession({
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      activate: true,
    });
    expect(result.activated).toBe(false);
    expect(result.activationErrorCode).toBe('SESSION_FOLDER_UNAVAILABLE');
    expect(resumeSession).not.toHaveBeenCalled();
  });

  it('recovers one provable legacy parent and upgrades only after activation', async () => {
    const resumeSession = jest
      .fn()
      .mockResolvedValue((async function* () {})());
    const upgrade = jest
      .fn()
      .mockResolvedValue({ status: 'valid', roots: [OPEN_FOLDER] });
    const svc = makeService({
      metadata: {
        workspaceId: OPEN_FOLDER,
        workingDirectory: `${OPEN_FOLDER}/child`,
      },
      resumeSession,
      upgradeLegacyPluginConfigAncestorRoots: upgrade,
    });
    const result = await svc.resumeSession({
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      activate: true,
    });
    expect(result.activated).toBe(true);
    expect(resumeSession).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ pluginConfigAncestorRoots: [OPEN_FOLDER] }),
    );
    expect(upgrade).toHaveBeenCalledWith(SESSION_ID, [OPEN_FOLDER]);
  });
  it('surfaces activationError + activationErrorCode when auto-resume fails (success:true preserved)', async () => {
    const sdkResumeError = Object.assign(
      new Error('Auth required: please log in to your provider.'),
      {},
    );
    const svc = makeService({
      isSessionActive: jest.fn().mockReturnValue(false),
      resumeSession: jest.fn().mockRejectedValue(sdkResumeError),
    });

    const params: ChatResumeParams = {
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      workspacePath: OPEN_FOLDER,
      activate: true,
    };

    const result = (await svc.resumeSession(params)) as ChatResumeResult;
    expect(result.success).toBe(true);
    expect(result.activated).toBe(false);
    expect(result.activationError).toBe(
      'Auth required: please log in to your provider.',
    );
    // Non-AuthRequiredError → no errorCode is mapped by autoResume; the field
    // is omitted from the result object (kept narrow per `RpcUserErrorCode`).
    expect(result.activationErrorCode).toBeUndefined();
  });

  it('reports activated:true when the session is already live (no autoResume needed)', async () => {
    // "Already live" means registered AND streaming. Active-but-not-streaming is
    // a different case with its own behaviour — the record is treated as a
    // corpse, torn down, and resumed for real — so both mocks are set here.
    const svc = makeService({
      isSessionActive: jest.fn().mockReturnValue(true),
      isStreaming: jest.fn().mockReturnValue(true),
    });

    const params: ChatResumeParams = {
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      workspacePath: OPEN_FOLDER,
      activate: true,
    };

    const result = (await svc.resumeSession(params)) as ChatResumeResult;
    expect(result.success).toBe(true);
    expect(result.activated).toBe(true);
    expect(result.activationError).toBeUndefined();
    expect(result.activationErrorCode).toBeUndefined();
  });

  /**
   * TASK_2026_332. `autoResumeIfInactive` gained an
   * `mcpRegisteredForSubagents` parameter so the `chat:continue` path can pass
   * down what `ensureRegisteredForSubagents` actually reported. It DEFAULTS to
   * `true`, and that default is load-bearing: this caller and
   * `ensureSessionActiveForRewind` never register at all, so they have nothing
   * to report and must not be silently downgraded into starting every resumed
   * session without MCP.
   */
  it('does not downgrade mcpServerRunning on the activate path, which never registers', async () => {
    const resumeSession = jest.fn().mockResolvedValue(
      (async function* () {
        /* no events */
      })(),
    );
    const svc = makeService({
      isSessionActive: jest.fn().mockReturnValue(false),
      resumeSession,
      mcpServerRunning: true,
    });

    await svc.resumeSession({
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      workspacePath: OPEN_FOLDER,
      activate: true,
    });

    expect(resumeSession).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ mcpServerRunning: true }),
    );
  });

  it('omits activation fields when activate:true is not requested', async () => {
    const svc = makeService({
      isSessionActive: jest.fn().mockReturnValue(false),
    });

    const params: ChatResumeParams = {
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      workspacePath: OPEN_FOLDER,
    };

    const result = (await svc.resumeSession(params)) as ChatResumeResult;
    expect(result.success).toBe(true);
    expect(result.activated).toBe(false);
    expect(result.activationError).toBeUndefined();
    expect(result.activationErrorCode).toBeUndefined();
  });

  it('forwards staleSnapshot:true from the immutable resume read onto ChatResumeResult', async () => {
    const svc = makeService({
      isSessionActive: jest.fn().mockReturnValue(false),
      historyReader: {
        readSessionHistory: jest.fn().mockResolvedValue({
          events: [],
          stats: null,
          staleSnapshot: true,
        }),
      },
    });

    const params: ChatResumeParams = {
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      workspacePath: OPEN_FOLDER,
    };

    const result = (await svc.resumeSession(params)) as ChatResumeResult;
    expect(result.success).toBe(true);
    expect(result.staleSnapshot).toBe(true);
  });

  // TASK_2026_437 C15 / INV-9: the reply replays `events` and carries no
  // duplicate `messages` transcript beside them.
  it('uses a single readSessionHistory parse and returns no messages transcript', async () => {
    const readSessionHistory = jest.fn().mockResolvedValue({
      events: [{ id: 'ev1', eventType: 'message_start' } as never],
      stats: null,
    });
    const svc = makeService({
      isSessionActive: jest.fn().mockReturnValue(false),
      historyReader: {
        readSessionHistory,
      },
    });

    const params: ChatResumeParams = {
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      workspacePath: OPEN_FOLDER,
    };

    const result = (await svc.resumeSession(params)) as ChatResumeResult;
    expect(result.success).toBe(true);
    expect(readSessionHistory).toHaveBeenCalledTimes(1);
    expect(readSessionHistory).toHaveBeenCalledWith(SESSION_ID, OPEN_FOLDER, {
      checkCompactionBoundary: true,
    });
    expect(result).not.toHaveProperty('messages');
    expect(result.events).toEqual([{ id: 'ev1', eventType: 'message_start' }]);
  });

  it('restores a persisted worktree cwd before history, registry fallback, and activation', async () => {
    const worktree = `${OPEN_FOLDER}/.claude/worktrees/fix`;
    const calls: string[] = [];
    // The resume path reads history once: events and stats come from the same
    // readSessionHistory result.
    const readSessionHistory = jest.fn(async (_id, cwd) => {
      calls.push(`history:${cwd}`);
      return { events: [{ id: 'history' }], stats: null };
    });
    const hydrateResumeState = jest.fn(() => {
      calls.push('restore');
      return 1;
    });
    const registerFromHistoryEvents = jest.fn(() => {
      calls.push('fallback');
      return 0;
    });
    const resumeSession = jest.fn(async (_id, options) => {
      calls.push(`activate:${options.projectPath}`);
      return (async function* () {
        /* no events */
      })();
    });
    const persisted = {
      toolCallId: 'tool-1',
      agentType: 'backend',
      status: 'interrupted',
      startedAt: Date.now(),
      interruptedAt: Date.now(),
      parentSessionId: SESSION_ID,
      agentId: 'agent-1',
    };
    const svc = makeService({
      metadata: {
        workingDirectory: worktree,
        resumableSdkSubagents: [persisted],
      },
      fileExists: jest.fn().mockResolvedValue(true),
      readSessionHistory,
      hydrateResumeState,
      registerFromHistoryEvents,
      resumeSession,
      getResumableBySession: jest.fn().mockReturnValue([persisted]),
      isSessionActive: jest.fn().mockReturnValue(false),
    });

    const result = await svc.resumeSession({
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      workspacePath: OPEN_FOLDER,
      activate: true,
    });

    expect(result.success).toBe(true);
    expect(hydrateResumeState).toHaveBeenCalledWith(SESSION_ID, {
      retiredToolCallIds: undefined,
      resumableSdkSubagents: [persisted],
    });
    expect(calls).toEqual([
      `history:${worktree}`,
      'restore',
      'fallback',
      `activate:${worktree}`,
    ]);
  });

  it('auto-resume (chat:continue path) runs a worktree child in its worktree, not the workspace root', async () => {
    const worktree = `${OPEN_FOLDER}/.claude/worktrees/fix`;
    const resumeSession = jest.fn(async () =>
      (async function* () {
        /* no events */
      })(),
    );
    const svc = makeService({
      metadata: { workingDirectory: worktree },
      fileExists: jest.fn().mockResolvedValue(true),
      resumeSession,
    });

    await expect(
      svc.ensureSessionActiveForRewind(SESSION_ID, TAB_ID, OPEN_FOLDER),
    ).resolves.toEqual({ resumed: true });
    expect(resumeSession).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ projectPath: worktree }),
    );
  });

  it('auto-resume refuses a missing worktree without calling SDK resume', async () => {
    const resumeSession = jest.fn(async () =>
      (async function* () {
        /* no events */
      })(),
    );
    const svc = makeService({
      metadata: { workingDirectory: `${OPEN_FOLDER}/.claude/worktrees/gone` },
      fileExists: jest.fn(async (path: string) => path === OPEN_FOLDER),
      resumeSession,
    });

    await expect(
      svc.ensureSessionActiveForRewind(SESSION_ID, TAB_ID, OPEN_FOLDER),
    ).resolves.toMatchObject({ resumed: false });
    expect(resumeSession).not.toHaveBeenCalled();
  });

  it('persists cwd and interrupted SDK records from the session-end lifecycle', async () => {
    const worktree = `${OPEN_FOLDER}/.claude/worktrees/fix`;
    const persisted = {
      toolCallId: 'tool-1',
      agentType: 'backend',
      status: 'interrupted',
      startedAt: Date.now(),
      interruptedAt: Date.now(),
      parentSessionId: SESSION_ID,
      agentId: 'agent-1',
    };
    const dismissed = { ...persisted, toolCallId: 'tool-2', dismissed: true };
    const getInterruptedBySession = jest
      .fn()
      .mockReturnValue([persisted, dismissed]);
    const saveResumeState = jest.fn().mockResolvedValue(undefined);
    let sessionEndCallback:
      | ((payload: { sessionId: string; workspaceRoot: string }) => unknown)
      | undefined;
    const sessionEndRegister = jest.fn((callback) => {
      sessionEndCallback = callback;
      return () => undefined;
    });

    makeService({
      getInterruptedBySession,
      saveResumeState,
      sessionEndRegister,
    });

    expect(sessionEndCallback).toBeDefined();
    await sessionEndCallback?.({
      sessionId: SESSION_ID,
      workspaceRoot: worktree,
    });

    // Dismissed records stay durable: they are still owed one injection.
    expect(getInterruptedBySession).toHaveBeenCalledWith(SESSION_ID);
    expect(saveResumeState).toHaveBeenCalledWith(SESSION_ID, {
      workingDirectory: worktree,
      resumableSdkSubagents: [persisted, dismissed],
    });
  });

  it('session end loads the durable state into a cold registry before replacing the list', async () => {
    const stored = {
      toolCallId: 'tool-stored',
      agentType: 'backend',
      status: 'interrupted',
      startedAt: Date.now(),
      parentSessionId: SESSION_ID,
      agentId: 'agent-stored',
    };
    const calls: string[] = [];
    const hydrateResumeState = jest.fn(() => {
      calls.push('hydrate');
      return 1;
    });
    const saveResumeState = jest.fn(async () => {
      calls.push('save');
    });
    let sessionEndCallback:
      | ((payload: { sessionId: string; workspaceRoot: string }) => unknown)
      | undefined;
    makeService({
      metadata: { resumableSdkSubagents: [stored] },
      hydrateResumeState,
      saveResumeState,
      sessionEndRegister: jest.fn((callback) => {
        sessionEndCallback = callback;
        return () => undefined;
      }),
    });

    await sessionEndCallback?.({
      sessionId: SESSION_ID,
      workspaceRoot: OPEN_FOLDER,
    });

    expect(hydrateResumeState).toHaveBeenCalledWith(SESSION_ID, {
      retiredToolCallIds: undefined,
      resumableSdkSubagents: [stored],
    });
    expect(calls).toEqual(['hydrate', 'save']);
  });

  it('session end of a hydrated session queues the write synchronously', () => {
    const saveResumeState = jest.fn().mockResolvedValue(undefined);
    const metadataGet = jest.fn().mockResolvedValue(null);
    let sessionEndCallback:
      | ((payload: { sessionId: string; workspaceRoot: string }) => unknown)
      | undefined;
    makeService({
      isResumeStateHydrated: jest.fn().mockReturnValue(true),
      metadataGet,
      saveResumeState,
      sessionEndRegister: jest.fn((callback) => {
        sessionEndCallback = callback;
        return () => undefined;
      }),
    });

    // No await: shutdown flushes the write queue right after notifyAll.
    void sessionEndCallback?.({
      sessionId: SESSION_ID,
      workspaceRoot: OPEN_FOLDER,
    });

    expect(saveResumeState).toHaveBeenCalledTimes(1);
    expect(metadataGet).not.toHaveBeenCalled();
  });

  it('session end leaves the durable list alone when it cannot be loaded', async () => {
    const saveResumeState = jest.fn().mockResolvedValue(undefined);
    let sessionEndCallback:
      | ((payload: { sessionId: string; workspaceRoot: string }) => unknown)
      | undefined;
    makeService({
      metadataGet: jest.fn().mockRejectedValue(new Error('storage offline')),
      saveResumeState,
      sessionEndRegister: jest.fn((callback) => {
        sessionEndCallback = callback;
        return () => undefined;
      }),
    });

    await sessionEndCallback?.({
      sessionId: SESSION_ID,
      workspaceRoot: OPEN_FOLDER,
    });

    expect(saveResumeState).not.toHaveBeenCalled();
  });

  it('returns the resumable list as it stands after activation, not before', async () => {
    const interrupted = {
      toolCallId: 'tool-1',
      agentType: 'backend',
      status: 'interrupted',
      startedAt: Date.now(),
      parentSessionId: SESSION_ID,
      agentId: 'agent-1',
    };
    let dismissedDuringResume = false;
    const resumeSession = jest.fn(async () => {
      // A chat:dismiss-resumable-subagents lands while activation runs.
      dismissedDuringResume = true;
      return (async function* () {
        /* no events */
      })();
    });
    const svc = makeService({
      resumeSession,
      getResumableBySession: jest.fn(() =>
        dismissedDuringResume ? [] : [interrupted],
      ),
    });

    const result = (await svc.resumeSession({
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      workspacePath: OPEN_FOLDER,
      activate: true,
    })) as ChatResumeResult;

    expect(result.success).toBe(true);
    expect(resumeSession).toHaveBeenCalled();
    expect(result.resumableSubagents).toEqual([]);
  });

  it('hydrates retired ids and the snapshot before replaying history', async () => {
    const calls: string[] = [];
    const hydrateResumeState = jest.fn(() => {
      calls.push('hydrate');
      return 0;
    });
    const registerFromHistoryEvents = jest.fn(() => {
      calls.push('fallback');
      return 0;
    });
    const svc = makeService({
      metadata: {
        workspaceId: OPEN_FOLDER,
        retiredSubagentToolCallIds: ['tool-old'],
      },
      hydrateResumeState,
      registerFromHistoryEvents,
    });

    await svc.resumeSession({
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      workspacePath: OPEN_FOLDER,
    });

    expect(hydrateResumeState).toHaveBeenCalledWith(SESSION_ID, {
      retiredToolCallIds: ['tool-old'],
      resumableSdkSubagents: undefined,
    });
    expect(calls).toEqual(['hydrate', 'fallback']);
  });

  it.each([
    ['missing', jest.fn(async (path: string) => path === OPEN_FOLDER)],
    [
      'unreadable',
      jest.fn(async (path: string) => {
        if (path !== OPEN_FOLDER) throw new Error('stat failed');
        return true;
      }),
    ],
  ])('refuses when persisted cwd is %s', async (_label, fileExists) => {
    const readSessionHistory = jest
      .fn()
      .mockResolvedValue({ events: [], stats: null });
    const svc = makeService({
      metadata: {
        workingDirectory: `${OPEN_FOLDER}/.claude/worktrees/deleted`,
      },
      fileExists,
      readSessionHistory,
    });

    const result = await svc.resumeSession({
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      workspacePath: OPEN_FOLDER,
    });

    expect(result).toMatchObject({
      success: false,
      errorCode: 'SESSION_FOLDER_UNAVAILABLE',
    });
    expect(readSessionHistory).not.toHaveBeenCalled();
  });

  it('keeps legacy metadata behavior when continuity fields are absent', async () => {
    const readSessionHistory = jest
      .fn()
      .mockResolvedValue({ events: [], stats: null });
    const hydrateResumeState = jest.fn().mockReturnValue(0);
    const svc = makeService({
      metadata: { workspaceId: OPEN_FOLDER },
      readSessionHistory,
      hydrateResumeState,
    });

    await svc.resumeSession({
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      workspacePath: OPEN_FOLDER,
    });

    expect(readSessionHistory).toHaveBeenCalledWith(SESSION_ID, OPEN_FOLDER, {
      checkCompactionBoundary: true,
    });
    expect(hydrateResumeState).toHaveBeenCalledWith(SESSION_ID, {
      retiredToolCallIds: undefined,
      resumableSdkSubagents: undefined,
    });
  });
});
