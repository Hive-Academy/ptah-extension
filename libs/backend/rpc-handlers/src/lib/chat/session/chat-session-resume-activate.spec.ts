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
  LicenseService,
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

const OPEN_FOLDER = '/c/projects/my-repo';
const SESSION_ID = '11111111-1111-4111-8111-111111111111' as SessionId;
const TAB_ID = '22222222-2222-4222-8222-222222222222';

function makeService(params: {
  isSessionActive?: jest.Mock;
  resumeSession?: jest.Mock;
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
    readSessionHistory: jest
      .fn()
      .mockResolvedValue({ events: [], stats: null }),
    readHistoryAsMessages: jest.fn().mockResolvedValue([]),
  };
  const subagentRegistry = {
    registerFromHistoryEvents: jest.fn().mockReturnValue(0),
    getResumableBySession: jest.fn().mockReturnValue([]),
  } as unknown as SubagentRegistryService;
  const sessionMetadataStore = {
    get: jest.fn().mockResolvedValue(null),
  };
  const licenseService = {
    verifyLicense: jest.fn().mockResolvedValue({ valid: false, tier: 'free' }),
  } as unknown as LicenseService;
  const premiumContext = {
    isMcpServerRunning: jest.fn().mockReturnValue(false),
    resolveEnhancedPromptsContent: jest.fn().mockResolvedValue(undefined),
    resolvePluginPaths: jest.fn().mockReturnValue([]),
  };
  const codeExecutionMcp = {
    getPort: jest.fn().mockReturnValue(0),
  };
  const streamBroadcaster = {
    streamEventsToWebview: jest.fn(),
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
    licenseService,
    {
      intercept: jest.fn().mockReturnValue({ action: 'passthrough' }),
    } as never,
    sessionMetadataStore as never,
    provider as unknown as IWorkspaceProvider,
    {
      type: 'cli',
      extensionPath: '/tmp/ptah-app',
      globalStoragePath: '/tmp/ptah-storage',
      workspaceStoragePath: '/tmp/ptah-workspace-storage',
    } as never,
    premiumContext as never,
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
    const svc = makeService({
      isSessionActive: jest.fn().mockReturnValue(true),
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
});
