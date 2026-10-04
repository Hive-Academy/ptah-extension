/**
 * ChatSessionService — session budget (TASK_2026_597 N7, decision 13).
 *
 * - `chat:continue` gate: a session whose budget refuses sends gets
 *   `SESSION_BUDGET_REACHED` before any resume, slash routing or send. Only
 *   the exact trimmed prompts `/compact` and `/clear` pass. An unknown figure
 *   and a host without the budget registration both send as before.
 * - `chat:resume`: the resume snapshot recomputes the stage and the result
 *   carries `budget`; no stats means no `budget` field.
 */

import 'reflect-metadata';

// `ChatSessionService` imports `@ptah-extension/cli-agent-runtime`, whose barrel
// transitively pulls `@ptah-extension/workspace-intelligence`. That lib's
// TreeSitter module evaluates `import.meta.url` at top level — a construct
// ts-jest's CJS transform cannot parse. Stub it (mirrors the sibling specs).
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
  ChatContinueParams,
  IAgentAdapter,
  SessionBudgetConfig,
  SessionBudgetState,
  SessionId,
  SessionStatsEntry,
} from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { ModelSettings } from '@ptah-extension/settings-core';
import { SessionBudgetService } from '@ptah-extension/agent-sdk';

import { createMockModelSettings } from '../../../test-utils/mock-settings';
import { ChatSessionService } from './chat-session.service';
import { SessionMcpStatusRegistry } from './session-mcp-status.registry';

const OPEN_FOLDER = '/c/projects/qa3elhamor';
const SESSION_ID = 'b5399ba8-e06d-417c-bac4-aba5add0555c' as SessionId;
const TAB_ID = 'f69cb197-0798-40bc-ac0c-6f7591e0a894';
const LIMIT = 50_000_000;

type BudgetFake = Pick<SessionBudgetService, 'canSend' | 'observeLoaded'>;

function budgetState(
  overrides: Partial<SessionBudgetState> = {},
): SessionBudgetState {
  return {
    sessionId: SESSION_ID,
    stage: 'limit',
    unit: 'tokens',
    measure: 'tokens',
    used: LIMIT,
    limit: LIMIT,
    percent: 100,
    lowerBound: false,
    revision: 7,
    compactions: 0,
    extensions: 0,
    blocked: true,
    ...overrides,
  };
}

function statsAt(tokenCount: number, revision?: number): SessionStatsEntry {
  return {
    sessionId: SESSION_ID,
    model: 'claude-test',
    totalCost: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    messageCount: 1,
    status: 'ok',
    tokenCount,
    ...(revision !== undefined ? { revision } : {}),
  };
}

const BUDGET_CONFIG: SessionBudgetConfig = {
  enabled: true,
  unit: 'tokens',
  tokens: LIMIT,
  usd: 30,
  fallbackWeightedTokens: 9_000_000,
  tightenPercent: 50,
  handoffPercent: 80,
  handoffAfterCompactions: 3,
  tightenWindowTokens: null,
  blockAtLimit: true,
};

/** The real stage machine with fakes for its own collaborators. */
function realBudget(): SessionBudgetService {
  return new SessionBudgetService(
    createMockLogger() as unknown as Logger,
    { getConfig: jest.fn(() => BUDGET_CONFIG) } as never,
    { snapshot: jest.fn(() => null) } as never,
    {
      applySessionAutoCompactWindow: jest.fn(async () => undefined),
      getSessionWorkspace: jest.fn(() => OPEN_FOLDER),
    } as never,
    {
      build: jest.fn(async () => ({
        document: {
          content: '# Handoff',
          seed: 'seed',
          chars: 9,
          truncated: false,
          builtAt: 1_700_000_000_000,
        },
      })),
    } as never,
    { write: jest.fn(async () => ({ path: null })) } as never,
  );
}

interface Harness {
  service: ChatSessionService;
  resumeSession: jest.Mock;
  sendMessageToSession: jest.Mock;
  routeFollowUpSlashCommand: jest.Mock;
  handleContinue: jest.Mock;
  readForResume: jest.Mock;
}

function makeHarness(budget: BudgetFake | null): Harness {
  const noop = jest.fn();
  const provider = createMockWorkspaceProvider({ folders: [OPEN_FOLDER] });
  const emptyStream = (): AsyncGenerator<never> =>
    (async function* () {
      /* no events */
    })();

  const resumeSession = jest.fn().mockImplementation(async () => emptyStream());
  const sendMessageToSession = jest.fn().mockResolvedValue(undefined);
  const sdkAdapter = {
    startChatSession: jest.fn().mockImplementation(async () => emptyStream()),
    isSessionActive: jest.fn().mockReturnValue(true),
    resumeSession,
    sendMessageToSession,
    endSession: jest.fn().mockResolvedValue(undefined),
    interruptSession: jest.fn().mockResolvedValue(undefined),
    interruptCurrentTurn: jest.fn().mockResolvedValue(true),
  } as unknown as IAgentAdapter;

  const routeFollowUpSlashCommand = jest
    .fn()
    .mockImplementation(async (prompt: string) =>
      prompt.trim().startsWith('/')
        ? { success: true, sessionId: SESSION_ID }
        : null,
    );
  const handleContinue = jest
    .fn()
    .mockResolvedValue({ error: '__NOT_PTAH_CLI__' });
  const readForResume = jest.fn().mockResolvedValue({
    events: [],
    stats: null,
    resolvedWorkspacePath: OPEN_FOLDER,
  });

  const service = new ChatSessionService(
    createMockLogger() as unknown as Logger,
    { broadcastMessage: noop } as never,
    {
      get: noop,
      getWithDefault: jest.fn().mockReturnValue(false),
    } as unknown as ConfigManager,
    sdkAdapter,
    { captureException: jest.fn() } as unknown as SentryService,
    {
      getPort: jest.fn().mockReturnValue(0),
      ensureRegisteredForSubagents: jest
        .fn()
        .mockResolvedValue({ registered: true }),
    } as never,
    { readForResume } as never,
    {
      restoreResumableBySession: jest.fn().mockReturnValue(0),
      registerFromHistoryEvents: jest.fn().mockReturnValue(0),
      getResumableBySession: jest.fn().mockReturnValue([]),
    } as unknown as SubagentRegistryService,
    {
      intercept: jest.fn().mockReturnValue({ action: 'passthrough' }),
    } as never,
    {
      get: jest.fn().mockResolvedValue(null),
      getCliSessionsForRestore: jest.fn().mockResolvedValue([]),
      saveResumeState: jest.fn().mockResolvedValue(undefined),
    } as never,
    provider as unknown as IWorkspaceProvider,
    {
      type: 'cli',
      extensionPath: '/tmp/ptah-app',
      globalStoragePath: '/tmp/ptah-storage',
      workspaceStoragePath: '/tmp/ptah-workspace-storage',
    } as never,
    {
      isMcpServerRunning: jest.fn().mockReturnValue(false),
      resolveEnhancedPromptsContent: jest.fn().mockResolvedValue(undefined),
      resolvePluginPaths: jest.fn().mockReturnValue([]),
    } as never,
    { handleContinue } as never,
    {
      streamEventsToWebview: jest.fn(),
      isStreaming: jest.fn().mockReturnValue(true),
    } as never,
    {
      injectInterruptedAgentsContext: jest
        .fn()
        .mockImplementation(async (prompt: string) => ({ prompt })),
    } as never,
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
    null,
    budget,
  );

  return {
    service,
    resumeSession,
    sendMessageToSession,
    routeFollowUpSlashCommand,
    handleContinue,
    readForResume,
  };
}

function blockedBudget(): BudgetFake & { canSend: jest.Mock } {
  return {
    canSend: jest.fn(() => ({ ok: false as const, state: budgetState() })),
    observeLoaded: jest.fn(() => undefined),
  };
}

function params(prompt: string): ChatContinueParams {
  return {
    prompt,
    sessionId: SESSION_ID,
    tabId: TAB_ID,
    workspacePath: OPEN_FOLDER,
  };
}

const REFUSED = {
  success: false,
  errorCode: 'SESSION_BUDGET_REACHED',
  error: expect.stringContaining('Allow 20% more'),
};

describe('chat:continue — session budget gate', () => {
  it('refuses a plain prompt with SESSION_BUDGET_REACHED before any send', async () => {
    const budget = blockedBudget();
    const h = makeHarness(budget);

    const result = await h.service.continueSession(params('keep going'));

    expect(result).toEqual(REFUSED);
    expect(budget.canSend).toHaveBeenCalledWith(SESSION_ID);
    expect(h.sendMessageToSession).not.toHaveBeenCalled();
    expect(h.resumeSession).not.toHaveBeenCalled();
    expect(h.routeFollowUpSlashCommand).not.toHaveBeenCalled();
  });

  it.each(['/compact', '/clear', '  /compact  ', '\n/clear\t'])(
    'lets %j through at the limit',
    async (prompt) => {
      const budget = blockedBudget();
      const h = makeHarness(budget);

      const result = await h.service.continueSession(params(prompt));

      expect(result).toEqual({ success: true, sessionId: SESSION_ID });
      expect(h.routeFollowUpSlashCommand).toHaveBeenCalledTimes(1);
      expect(budget.canSend).not.toHaveBeenCalled();
    },
  );

  it.each(['/orchestrate asset-audit', '/compact keep the plan', '/clearall'])(
    'blocks the slash command %j (only exact /compact and /clear pass)',
    async (prompt) => {
      const h = makeHarness(blockedBudget());

      const result = await h.service.continueSession(params(prompt));

      expect(result).toEqual(REFUSED);
      expect(h.routeFollowUpSlashCommand).not.toHaveBeenCalled();
    },
  );

  it('sends when the budget is unknown (no figure: fail-open)', async () => {
    const h = makeHarness(realBudget());

    const result = await h.service.continueSession(params('keep going'));

    expect(result).toEqual({ success: true, sessionId: SESSION_ID });
    expect(h.sendMessageToSession).toHaveBeenCalledTimes(1);
  });

  it('sends when the host has no budget registration', async () => {
    const h = makeHarness(null);

    const result = await h.service.continueSession(params('keep going'));

    expect(result).toEqual({ success: true, sessionId: SESSION_ID });
    expect(h.sendMessageToSession).toHaveBeenCalledTimes(1);
  });

  it('pauses after the turn that crossed 100% (real stage machine)', async () => {
    const budget = realBudget();
    const h = makeHarness(budget);

    expect(budget.observe(statsAt(LIMIT * 0.99, 1))?.blocked).toBe(false);
    expect((await h.service.continueSession(params('next step'))).success).toBe(
      true,
    );

    expect(budget.observe(statsAt(LIMIT, 2))?.blocked).toBe(true);
    expect(await h.service.continueSession(params('next step'))).toEqual(
      REFUSED,
    );
    expect(h.sendMessageToSession).toHaveBeenCalledTimes(1);
  });

  it('leaves Ptah CLI sessions ungated', async () => {
    const budget = blockedBudget();
    const h = makeHarness(budget);
    h.handleContinue.mockResolvedValue({
      success: true,
      sessionId: SESSION_ID,
    });

    const result = await h.service.continueSession(params('keep going'));

    expect(result).toEqual({ success: true, sessionId: SESSION_ID });
    expect(budget.canSend).not.toHaveBeenCalled();
  });
});

describe('chat:resume — session budget', () => {
  it('attaches the budget computed from the resume snapshot (used === stats.tokenCount)', async () => {
    const h = makeHarness(realBudget());
    const stats = statsAt(41_000_000, 12);
    h.readForResume.mockResolvedValue({
      events: [],
      stats,
      resolvedWorkspacePath: OPEN_FOLDER,
    });

    const result = await h.service.resumeSession({
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      workspacePath: OPEN_FOLDER,
    });

    expect(result.success).toBe(true);
    expect(result.stats).toBe(stats);
    expect(result.budget).toEqual(
      expect.objectContaining({
        sessionId: SESSION_ID,
        stage: 'handoff',
        used: stats.tokenCount,
        limit: LIMIT,
        revision: 12,
        blocked: false,
      }),
    );
  });

  it('has no budget field when the resume has no stats', async () => {
    const budget = blockedBudget();
    const h = makeHarness(budget);

    const result = await h.service.resumeSession({
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      workspacePath: OPEN_FOLDER,
    });

    expect(result.success).toBe(true);
    expect(budget.observeLoaded).toHaveBeenCalledWith(null);
    expect(result).not.toHaveProperty('budget');
  });

  it('has no budget field when the host has no budget registration', async () => {
    const h = makeHarness(null);
    h.readForResume.mockResolvedValue({
      events: [],
      stats: statsAt(10, 1),
      resolvedWorkspacePath: OPEN_FOLDER,
    });

    const result = await h.service.resumeSession({
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      workspacePath: OPEN_FOLDER,
    });

    expect(result.success).toBe(true);
    expect(result).not.toHaveProperty('budget');
  });
});
