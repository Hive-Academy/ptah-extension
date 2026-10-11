/**
 * ChatSessionService acts in the session's own folder (PTAH-37, MP-3).
 *
 * Two projects are open; the active one is PROJECT_A and the session belongs
 * to PROJECT_B. Before MP-3, chat:continue and chat:resume used the caller's
 * path or the active root, so a resumed session ran its tools in PROJECT_A.
 */

import 'reflect-metadata';

// Same stub as chat-session-resume-activate.spec: the barrel pulls a module
// that ts-jest's CJS transform cannot parse.
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
import type { IAgentAdapter, SessionId } from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { ModelSettings } from '@ptah-extension/settings-core';

import { createMockModelSettings } from '../../../test-utils/mock-settings';
import { ChatSessionService } from './chat-session.service';
import { ChatHistoryReadService } from './chat-history-read.service';
import { SessionMcpStatusRegistry } from './session-mcp-status.registry';

const PROJECT_A = '/c/projects/a';
const PROJECT_B = '/c/projects/b';
const SESSION_ID = '11111111-1111-4111-8111-111111111111' as SessionId;
const TAB_ID = '22222222-2222-4222-8222-222222222222';

function makeHarness(
  opts: {
    folders?: string[];
    metadata?: Record<string, unknown> | null;
    ptahCli?: boolean;
  } = {},
) {
  const noop = jest.fn();
  const logger = createMockLogger();
  const provider = createMockWorkspaceProvider({
    folders: opts.folders ?? [PROJECT_A, PROJECT_B],
  });
  (provider.getWorkspaceRoot as jest.Mock).mockReturnValue(PROJECT_A);

  const resumeSession = jest.fn().mockResolvedValue(
    (async function* () {
      /* no events */
    })(),
  );
  const sendMessageToSession = jest.fn().mockResolvedValue(undefined);
  const sdkAdapter = {
    isSessionActive: jest.fn().mockReturnValue(false),
    resumeSession,
    sendMessageToSession,
    interruptSession: jest.fn().mockResolvedValue(undefined),
  } as unknown as IAgentAdapter;
  const readSessionHistory = jest
    .fn()
    .mockResolvedValue({ events: [], stats: null });
  const subagentRegistry = {
    restoreResumableBySession: jest.fn().mockReturnValue(0),
    registerFromHistoryEvents: jest.fn().mockReturnValue(0),
    getResumableBySession: jest.fn().mockReturnValue([]),
  } as unknown as SubagentRegistryService;
  const sessionMetadataStore = {
    get: jest
      .fn()
      .mockResolvedValue(
        opts.metadata === undefined
          ? { workspaceId: PROJECT_B }
          : opts.metadata,
      ),
    getCliSessionsForRestore: jest
      .fn()
      .mockResolvedValue([{ agentId: 'agent-1' }]),
    saveResumeState: jest.fn().mockResolvedValue(undefined),
  };
  const platformInfo = {
    type: 'cli',
    extensionPath: '/tmp/ptah-app',
    globalStoragePath: '/tmp/ptah-storage',
    workspaceStoragePath: '/tmp/ptah-workspace-storage',
  };
  const historyRead = new ChatHistoryReadService(
    logger as unknown as Logger,
    { readSessionHistory } as never,
    sessionMetadataStore as never,
    subagentRegistry,
    provider as unknown as IWorkspaceProvider,
    { exists: jest.fn().mockResolvedValue(true) } as never,
    platformInfo as never,
  );
  const routeFollowUpSlashCommand = jest.fn().mockResolvedValue(null);
  const injectInterruptedAgentsContext = jest
    .fn()
    .mockImplementation(async (prompt: string) => ({ prompt }));
  const handleContinue = jest
    .fn()
    .mockResolvedValue(
      opts.ptahCli
        ? { success: true, sessionId: SESSION_ID }
        : { error: '__NOT_PTAH_CLI__' },
    );
  const restoreAgents = jest.fn();
  const captureException = jest.fn();

  const service = new ChatSessionService(
    logger as unknown as Logger,
    { broadcastMessage: noop } as never,
    {
      get: noop,
      getWithDefault: jest.fn().mockReturnValue(false),
    } as unknown as ConfigManager,
    sdkAdapter,
    { captureException } as unknown as SentryService,
    {
      getPort: jest.fn().mockReturnValue(0),
      ensureRegisteredForSubagents: jest
        .fn()
        .mockResolvedValue({ registered: true }),
    } as never,
    historyRead,
    subagentRegistry,
    {
      intercept: jest.fn().mockReturnValue({ action: 'passthrough' }),
    } as never,
    sessionMetadataStore as never,
    provider as unknown as IWorkspaceProvider,
    platformInfo as never,
    {
      isMcpServerRunning: jest.fn().mockReturnValue(false),
      resolveEnhancedPromptsContent: jest.fn().mockResolvedValue(undefined),
      resolvePluginPaths: jest.fn().mockReturnValue([]),
    } as never,
    { handleContinue, registerResumedSession: jest.fn() } as never,
    {
      streamEventsToWebview: jest.fn(),
      isStreaming: jest.fn().mockReturnValue(false),
    } as never,
    { injectInterruptedAgentsContext } as never,
    { routeFollowUpSlashCommand } as never,
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
    { resolveSessionFields: jest.fn().mockResolvedValue({}) } as never,
    new SessionMcpStatusRegistry(),
    { register: jest.fn().mockReturnValue(() => undefined) } as never,
    { register: jest.fn().mockReturnValue(() => undefined) } as never,
    { restoreAgents } as never,
  );

  return {
    service,
    resumeSession,
    sendMessageToSession,
    readSessionHistory,
    routeFollowUpSlashCommand,
    injectInterruptedAgentsContext,
    restoreAgents,
    captureException,
  };
}

describe("ChatSessionService — the session's own folder (MP-3)", () => {
  describe('chat:continue', () => {
    it('resumes an inactive session in its own project, not the active one', async () => {
      const h = makeHarness();

      const result = await h.service.continueSession({
        prompt: 'run the tests',
        sessionId: SESSION_ID,
        tabId: TAB_ID,
      });

      expect(result).toEqual({ success: true, sessionId: SESSION_ID });
      expect(h.resumeSession).toHaveBeenCalledWith(
        SESSION_ID,
        expect.objectContaining({ projectPath: PROJECT_B }),
      );
    });

    it("ignores a caller path that is not the session's folder", async () => {
      const h = makeHarness();

      await h.service.continueSession({
        prompt: 'run the tests',
        sessionId: SESSION_ID,
        tabId: TAB_ID,
        workspacePath: PROJECT_A,
      });

      expect(h.resumeSession).toHaveBeenCalledWith(
        SESSION_ID,
        expect.objectContaining({ projectPath: PROJECT_B }),
      );
      expect(h.routeFollowUpSlashCommand).toHaveBeenCalledWith(
        'run the tests',
        SESSION_ID,
        TAB_ID,
        PROJECT_B,
        expect.anything(),
      );
      expect(h.injectInterruptedAgentsContext).toHaveBeenCalledWith(
        'run the tests',
        SESSION_ID,
        PROJECT_B,
      );
    });

    it('refuses to send when the session folder is not open', async () => {
      const h = makeHarness({ folders: [PROJECT_A] });

      const result = await h.service.continueSession({
        prompt: 'run the tests',
        sessionId: SESSION_ID,
        tabId: TAB_ID,
      });

      expect(result).toMatchObject({
        success: false,
        errorCode: 'SESSION_FOLDER_UNAVAILABLE',
      });
      expect(h.resumeSession).not.toHaveBeenCalled();
      expect(h.sendMessageToSession).not.toHaveBeenCalled();
      expect(h.captureException).not.toHaveBeenCalled();
    });

    it('refuses an unknown session id', async () => {
      const h = makeHarness({ metadata: null });

      const result = await h.service.continueSession({
        prompt: 'run the tests',
        sessionId: SESSION_ID,
        tabId: TAB_ID,
      });

      expect(result).toMatchObject({
        success: false,
        errorCode: 'SESSION_NOT_FOUND',
      });
      expect(h.sendMessageToSession).not.toHaveBeenCalled();
    });

    it('still dispatches a Ptah CLI session, which needs no folder', async () => {
      const h = makeHarness({ metadata: null, ptahCli: true });

      await expect(
        h.service.continueSession({
          prompt: 'hello',
          sessionId: SESSION_ID,
          tabId: TAB_ID,
        }),
      ).resolves.toEqual({ success: true, sessionId: SESSION_ID });
    });
  });

  describe('chat:resume', () => {
    it("reads history and restores agents in the session's own project", async () => {
      const h = makeHarness();

      const result = await h.service.resumeSession({
        sessionId: SESSION_ID,
        tabId: TAB_ID,
        workspacePath: PROJECT_A,
      });

      expect(result.success).toBe(true);
      expect(h.readSessionHistory).toHaveBeenCalledWith(SESSION_ID, PROJECT_B, {
        checkCompactionBoundary: true,
      });
      expect(h.restoreAgents).toHaveBeenCalledWith(
        [{ agentId: 'agent-1' }],
        PROJECT_B,
      );
    });

    it('activates in the session project', async () => {
      const h = makeHarness();

      await h.service.resumeSession({
        sessionId: SESSION_ID,
        tabId: TAB_ID,
        activate: true,
      });

      expect(h.resumeSession).toHaveBeenCalledWith(
        SESSION_ID,
        expect.objectContaining({ projectPath: PROJECT_B }),
      );
    });

    it('refuses to resume when the session folder is not open', async () => {
      const h = makeHarness({ folders: [PROJECT_A] });

      const result = await h.service.resumeSession({
        sessionId: SESSION_ID,
        tabId: TAB_ID,
      });

      expect(result).toMatchObject({
        success: false,
        errorCode: 'SESSION_FOLDER_UNAVAILABLE',
      });
      expect(h.readSessionHistory).not.toHaveBeenCalled();
      expect(h.captureException).not.toHaveBeenCalled();
    });
  });
});
