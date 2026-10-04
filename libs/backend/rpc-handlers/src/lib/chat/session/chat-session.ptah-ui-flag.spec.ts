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
  MonorepoDetectorService: class MonorepoDetectorServiceStub {},
  PatternMatcherService: class PatternMatcherServiceStub {},
  IgnorePatternResolverService: class IgnorePatternResolverServiceStub {},
  ContextSizeOptimizerService: class ContextSizeOptimizerServiceStub {},
  ContextEnrichmentService: class ContextEnrichmentServiceStub {},
}));

import type {
  ConfigManager,
  Logger,
  SentryService,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  ChatContinueParams,
  ChatStartParams,
  IAgentAdapter,
  SessionId,
} from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { ModelSettings } from '@ptah-extension/settings-core';

import { createMockModelSettings } from '../../../test-utils/mock-settings';
import { ChatSessionService } from './chat-session.service';
import { SessionMcpStatusRegistry } from './session-mcp-status.registry';

const WORKSPACE = '/c/projects/ptah-ui-flag';
const SESSION_ID = 'a6f50775-3f79-4f1a-8fa1-7b9f3d374db4' as SessionId;
const TAB_ID = '9e5af5a8-aa32-4dda-b4a8-69350d65d2da';

interface Harness {
  service: ChatSessionService;
  startChatSession: jest.Mock;
  resumeSession: jest.Mock;
}

function makeHarness(): Harness {
  const stream = { [Symbol.asyncIterator]: jest.fn() };
  const startChatSession = jest.fn().mockResolvedValue(stream);
  const resumeSession = jest.fn().mockResolvedValue(stream);
  const stub = { then: undefined } as unknown;
  const service = new ChatSessionService(
    createMockLogger() as unknown as Logger,
    { broadcastMessage: jest.fn().mockResolvedValue(undefined) } as never,
    {
      get: jest.fn(),
      getWithDefault: jest.fn().mockReturnValue(false),
    } as unknown as ConfigManager,
    {
      startChatSession,
      resumeSession,
      isSessionActive: jest.fn().mockReturnValue(false),
      sendMessageToSession: jest.fn().mockResolvedValue(undefined),
    } as unknown as IAgentAdapter,
    { captureException: jest.fn() } as unknown as SentryService,
    { getPort: jest.fn().mockReturnValue(0) } as never,
    {
      readForResume: jest
        .fn()
        .mockResolvedValue({ events: [], resolvedWorkspacePath: WORKSPACE }),
    } as never,
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
    } as never,
    createMockWorkspaceProvider({
      folders: [WORKSPACE],
    }) as unknown as IWorkspaceProvider,
    {
      type: 'cli',
      extensionPath: '/tmp/ptah',
      globalStoragePath: '/tmp/storage',
      workspaceStoragePath: '/tmp/workspace',
    } as never,
    {
      isMcpServerRunning: jest.fn().mockReturnValue(false),
      resolveEnhancedPromptsContent: jest.fn().mockResolvedValue(undefined),
    } as never,
    {
      handleStart: jest.fn().mockResolvedValue({ result: { success: false } }),
      handleContinue: jest
        .fn()
        .mockResolvedValue({ error: '__NOT_PTAH_CLI__' }),
    } as never,
    {
      streamEventsToWebview: jest.fn(),
      isStreaming: jest.fn().mockReturnValue(false),
    } as never,
    {
      injectInterruptedAgentsContext: jest
        .fn()
        .mockImplementation(async (prompt: string) => ({ prompt })),
    } as never,
    { routeFollowUpSlashCommand: jest.fn().mockResolvedValue(null) } as never,
    createMockModelSettings() as unknown as ModelSettings,
    { getProviderKey: jest.fn().mockResolvedValue(undefined) } as never,
    {
      resolveProviderProfileForWorkspace: jest
        .fn()
        .mockResolvedValue(undefined),
    } as never,
    { resolveSessionFields: jest.fn().mockResolvedValue({}) } as never,
    new SessionMcpStatusRegistry(),
    { register: jest.fn().mockReturnValue(() => undefined) } as never,
    { register: jest.fn().mockReturnValue(() => undefined) } as never,
  );

  jest
    .spyOn(
      service as unknown as {
        buildMcpServersOverride: (caller: unknown) => Promise<unknown>;
      },
      'buildMcpServersOverride',
    )
    .mockResolvedValue(undefined);
  return { service, startChatSession, resumeSession };
}

function flagParams<T extends ChatStartParams | ChatContinueParams>(
  params: T,
  ptahUiFence: boolean | undefined,
): T {
  return ptahUiFence === undefined ? params : { ...params, ptahUiFence };
}

function expectFlag(
  config: Record<string, unknown>,
  flag: boolean | undefined,
): void {
  if (flag === undefined) {
    expect('ptahUiFence' in config).toBe(false);
  } else {
    expect(config['ptahUiFence']).toBe(flag);
  }
}

describe('ChatSessionService ptahUiFence forwarding', () => {
  it.each([true, false, undefined])(
    'forwards %p unchanged on chat:start',
    async (ptahUiFence) => {
      const h = makeHarness();
      await h.service.startSession(
        flagParams(
          { tabId: TAB_ID, prompt: 'start', workspacePath: WORKSPACE },
          ptahUiFence,
        ),
      );

      expectFlag(h.startChatSession.mock.calls[0][0], ptahUiFence);
    },
  );

  it.each([true, false, undefined])(
    'forwards %p unchanged on chat:continue resume',
    async (ptahUiFence) => {
      const h = makeHarness();
      await h.service.continueSession(
        flagParams(
          {
            tabId: TAB_ID,
            sessionId: SESSION_ID,
            prompt: 'continue',
            workspacePath: WORKSPACE,
          },
          ptahUiFence,
        ),
      );

      expectFlag(h.resumeSession.mock.calls[0][1], ptahUiFence);
    },
  );
});
