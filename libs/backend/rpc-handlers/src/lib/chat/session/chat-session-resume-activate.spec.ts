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
import { SessionMcpStatusRegistry } from './session-mcp-status.registry';

const OPEN_FOLDER = '/c/projects/my-repo';
const SESSION_ID = '11111111-1111-4111-8111-111111111111' as SessionId;
const TAB_ID = '22222222-2222-4222-8222-222222222222';

function makeService(params: {
  isSessionActive?: jest.Mock;
  resumeSession?: jest.Mock;
  isStreaming?: jest.Mock;
  mcpServerRunning?: boolean;
  metadata?: Record<string, unknown> | null;
  fileExists?: jest.Mock;
  readSessionHistory?: jest.Mock;
  readHistoryAsMessages?: jest.Mock;
  restoreResumableBySession?: jest.Mock;
  registerFromHistoryEvents?: jest.Mock;
  getResumableBySession?: jest.Mock;
  saveResumeState?: jest.Mock;
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
      jest.fn().mockResolvedValue({ events: [], stats: null }),
    readHistoryAsMessages:
      params.readHistoryAsMessages ?? jest.fn().mockResolvedValue([]),
  };
  const subagentRegistry = {
    restoreResumableBySession:
      params.restoreResumableBySession ?? jest.fn().mockReturnValue(0),
    registerFromHistoryEvents:
      params.registerFromHistoryEvents ?? jest.fn().mockReturnValue(0),
    getResumableBySession:
      params.getResumableBySession ?? jest.fn().mockReturnValue([]),
  } as unknown as SubagentRegistryService;
  const sessionMetadataStore = {
    get: jest.fn().mockResolvedValue(params.metadata ?? null),
    getCliSessionsForRestore: jest.fn().mockResolvedValue([]),
    saveResumeState:
      params.saveResumeState ?? jest.fn().mockResolvedValue(undefined),
  };
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
    historyReader as never,
    subagentRegistry,
    {
      intercept: jest.fn().mockReturnValue({ action: 'passthrough' }),
    } as never,
    sessionMetadataStore as never,
    provider as unknown as IWorkspaceProvider,
    {
      exists: params.fileExists ?? jest.fn().mockResolvedValue(true),
    } as never,
    {
      type: 'cli',
      extensionPath: '/tmp/ptah-app',
      globalStoragePath: '/tmp/ptah-storage',
      workspaceStoragePath: '/tmp/ptah-workspace-storage',
    } as never,
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

  it('restores a persisted worktree cwd before history, registry fallback, and activation', async () => {
    const worktree = `${OPEN_FOLDER}/.claude/worktrees/fix`;
    const calls: string[] = [];
    const readSessionHistory = jest.fn(async (_id, cwd) => {
      calls.push(`history:${cwd}`);
      return { events: [{ id: 'history' }], stats: null };
    });
    const readHistoryAsMessages = jest.fn(async (_id, cwd) => {
      calls.push(`messages:${cwd}`);
      return [];
    });
    const restoreResumableBySession = jest.fn(() => {
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
      readHistoryAsMessages,
      restoreResumableBySession,
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
    expect(restoreResumableBySession).toHaveBeenCalledWith(SESSION_ID, [
      persisted,
    ]);
    expect(calls).toEqual([
      `history:${worktree}`,
      `messages:${worktree}`,
      'restore',
      'fallback',
      `activate:${worktree}`,
    ]);
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
    const getResumableBySession = jest.fn().mockReturnValue([persisted]);
    const saveResumeState = jest.fn().mockResolvedValue(undefined);
    let sessionEndCallback:
      | ((payload: { sessionId: string; workspaceRoot: string }) => unknown)
      | undefined;
    const sessionEndRegister = jest.fn((callback) => {
      sessionEndCallback = callback;
      return () => undefined;
    });

    makeService({
      getResumableBySession,
      saveResumeState,
      sessionEndRegister,
    });

    expect(sessionEndCallback).toBeDefined();
    await sessionEndCallback?.({
      sessionId: SESSION_ID,
      workspaceRoot: worktree,
    });

    expect(getResumableBySession).toHaveBeenCalledWith(SESSION_ID);
    expect(saveResumeState).toHaveBeenCalledWith(SESSION_ID, {
      workingDirectory: worktree,
      resumableSdkSubagents: [persisted],
    });
  });

  it.each([
    ['missing', jest.fn().mockResolvedValue(false)],
    ['unreadable', jest.fn().mockRejectedValue(new Error('stat failed'))],
  ])('falls back when persisted cwd is %s', async (_label, fileExists) => {
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

    expect(result.success).toBe(true);
    expect(readSessionHistory).toHaveBeenCalledWith(SESSION_ID, OPEN_FOLDER);
  });

  it('keeps legacy metadata behavior when continuity fields are absent', async () => {
    const readSessionHistory = jest
      .fn()
      .mockResolvedValue({ events: [], stats: null });
    const restoreResumableBySession = jest.fn().mockReturnValue(0);
    const svc = makeService({
      metadata: { workspaceId: OPEN_FOLDER },
      readSessionHistory,
      restoreResumableBySession,
    });

    await svc.resumeSession({
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      workspacePath: OPEN_FOLDER,
    });

    expect(readSessionHistory).toHaveBeenCalledWith(SESSION_ID, OPEN_FOLDER);
    expect(restoreResumableBySession).toHaveBeenCalledWith(SESSION_ID, []);
  });
});
