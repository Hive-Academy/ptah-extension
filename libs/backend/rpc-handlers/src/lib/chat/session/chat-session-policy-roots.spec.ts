import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const TEST_ROOT = mkdtempSync(join(tmpdir(), 'ptah-session-policy-'));
afterAll(() => rmSync(TEST_ROOT, { recursive: true, force: true }));
for (const part of ['a', 'b', 'b/child', 'b/.claude/worktrees/task'])
  mkdirSync(join(TEST_ROOT, part), { recursive: true });
const PROJECT_A = `${TEST_ROOT}/a`;
const PROJECT_B = `${TEST_ROOT}/b`;
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
    upgradePluginConfigAncestorRoots: jest.fn(),
    upgradeLegacyPluginConfigAncestorRoots: jest
      .fn()
      .mockResolvedValue({ status: 'valid', roots: [] }),
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
    platformInfo as never,
  );
  const routeFollowUpSlashCommand = jest.fn().mockResolvedValue(null);
  const injectInterruptedAgentsContext = jest
    .fn()
    .mockImplementation(async (prompt: string) => ({ prompt }));
  const registerResumedSession = jest.fn();
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
    { handleContinue, registerResumedSession } as never,
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
      resolveStoredModel: jest.fn(
        (_path: string, model: string) => model || 'default',
      ),
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
    sessionMetadataStore,
    resumeSession,
    sendMessageToSession,
    readSessionHistory,
    routeFollowUpSlashCommand,
    injectInterruptedAgentsContext,
    restoreAgents,
    captureException,
    registerResumedSession,
  };
}

describe('readSessionPolicyRoots', () => {
  const assertReadOnly = (h: ReturnType<typeof makeHarness>) => {
    expect(h.sessionMetadataStore.saveResumeState).not.toHaveBeenCalled();
    expect(
      h.sessionMetadataStore.upgradePluginConfigAncestorRoots,
    ).not.toHaveBeenCalled();
    expect(
      h.sessionMetadataStore.upgradeLegacyPluginConfigAncestorRoots,
    ).not.toHaveBeenCalled();
  };

  it('returns physical folder and validated stored ancestors', async () => {
    const folder = `${PROJECT_B}/child`;
    const h = makeHarness({
      metadata: {
        workspaceId: PROJECT_B,
        workingDirectory: folder,
        pluginConfigAncestorRoots: [PROJECT_B],
      },
    });
    expect(await h.service.readSessionPolicyRoots(SESSION_ID)).toEqual({
      folder,
      ancestorRoots: [PROJECT_B],
    });
    assertReadOnly(h);
  });

  it('restores the immediate root for legacy distinct cwd', async () => {
    const folder = `${PROJECT_B}/child`;
    const h = makeHarness({
      metadata: { workspaceId: PROJECT_B, workingDirectory: folder },
    });
    expect(await h.service.readSessionPolicyRoots(SESSION_ID)).toEqual({
      folder,
      ancestorRoots: [PROJECT_B],
    });
    assertReadOnly(h);
  });

  it('returns no ancestors when lineage is missing', async () => {
    const h = makeHarness({ metadata: { workspaceId: PROJECT_B } });
    expect(await h.service.readSessionPolicyRoots(SESSION_ID)).toEqual({
      folder: PROJECT_B,
      ancestorRoots: [],
    });
    assertReadOnly(h);
  });

  it('rejects malformed lineage without writing metadata', async () => {
    const h = makeHarness({
      metadata: {
        workspaceId: PROJECT_B,
        pluginConfigAncestorRoots: [''],
      },
    });
    await expect(
      h.service.readSessionPolicyRoots(SESSION_ID),
    ).rejects.toMatchObject({
      errorCode: 'SESSION_FOLDER_UNAVAILABLE',
    });
    assertReadOnly(h);
  });

  it('rejects an unknown session without writing metadata', async () => {
    const h = makeHarness({ metadata: null });
    await expect(
      h.service.readSessionPolicyRoots(SESSION_ID),
    ).rejects.toMatchObject({
      errorCode: 'SESSION_NOT_FOUND',
    });
    assertReadOnly(h);
  });
});
