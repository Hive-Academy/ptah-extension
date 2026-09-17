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

import type {
  ChatResumeParams,
  FlatStreamEventUnion,
  SessionId,
} from '@ptah-extension/shared';
import {
  HistoryCursorInvalidError,
  HistoryCursorStaleError,
} from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { ModelSettings } from '@ptah-extension/settings-core';
import {
  RpcUserError,
  type Logger,
  type RpcHandler,
  type SentryService,
  type SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  createMockSentryService,
} from '@ptah-extension/vscode-core/testing';

import { createMockModelSettings } from '../../../test-utils/mock-settings';
import { ChatRpcHandlers } from '../../handlers/chat-rpc.handlers';
import { ChatHistoryPageParamsSchema } from '../../handlers/chat-rpc.schema';
import { ChatSessionService } from './chat-session.service';
import { SessionMcpStatusRegistry } from './session-mcp-status.registry';

const SESSION_ID = '11111111-1111-4111-8111-111111111111' as SessionId;
const TAB_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE = '/c/projects/repo';

function historyEvents(): FlatStreamEventUnion[] {
  return [
    { eventType: 'message_start', messageId: 'u1', role: 'user' },
    { eventType: 'message_stop', messageId: 'u1' },
    { eventType: 'message_start', messageId: 'u2', role: 'user' },
    { eventType: 'message_stop', messageId: 'u2' },
  ] as FlatStreamEventUnion[];
}

function makeSessionService() {
  const noop = jest.fn();
  const events = historyEvents();
  const stats = {
    totalCost: null,
    tokens: { input: 1, output: 2, cacheRead: 0, cacheCreation: 0 },
    messageCount: 2,
  };
  const historyRead = {
    readForResume: jest.fn().mockResolvedValue({
      events,
      stats,
      resolvedWorkspacePath: WORKSPACE,
    }),
  };
  const subagentRegistry = {
    restoreResumableBySession: jest.fn().mockReturnValue(0),
    registerFromHistoryEvents: jest.fn().mockReturnValue(0),
    getResumableBySession: jest.fn().mockReturnValue([]),
  } as unknown as SubagentRegistryService;
  const metadataStore = {
    get: jest.fn().mockResolvedValue(null),
    getCliSessionsForRestore: jest.fn().mockResolvedValue([]),
  };
  const stub = { then: undefined } as unknown;
  const service = new ChatSessionService(
    createMockLogger() as unknown as Logger,
    { broadcastMessage: noop } as never,
    { get: noop, getWithDefault: jest.fn().mockReturnValue(false) } as never,
    { isSessionActive: jest.fn().mockReturnValue(false) } as never,
    { captureException: jest.fn() } as unknown as SentryService,
    stub as never,
    historyRead as never,
    subagentRegistry,
    {
      intercept: jest.fn().mockReturnValue({ action: 'passthrough' }),
    } as never,
    metadataStore as never,
    createMockWorkspaceProvider({
      folders: [WORKSPACE],
    }) as unknown as IWorkspaceProvider,
    {
      type: 'cli',
      extensionPath: '/tmp/ptah-app',
      globalStoragePath: '/tmp/ptah-storage',
      workspaceStoragePath: '/tmp/ptah-workspace-storage',
    } as never,
    stub as never,
    { registerResumedSession: jest.fn() } as never,
    { isStreaming: jest.fn().mockReturnValue(false) } as never,
    stub as never,
    stub as never,
    createMockModelSettings() as unknown as ModelSettings,
    stub as never,
    stub as never,
    { resolveSessionFields: jest.fn().mockResolvedValue({}) } as never,
    new SessionMcpStatusRegistry(),
    { register: jest.fn().mockReturnValue(() => undefined) } as never,
    { register: jest.fn().mockReturnValue(() => undefined) } as never,
  );
  return { service, historyRead, subagentRegistry, events, stats };
}

describe('ChatSessionService history paging', () => {
  it('keeps the legacy full-history response when paging is omitted', async () => {
    const harness = makeSessionService();
    const result = await harness.service.resumeSession({
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      workspacePath: WORKSPACE,
    });

    expect(result).toMatchObject({
      success: true,
      events: harness.events,
      stats: harness.stats,
    });
    expect(result).not.toHaveProperty('historyPage');
    expect(
      harness.subagentRegistry.registerFromHistoryEvents,
    ).toHaveBeenCalledWith(harness.events, SESSION_ID);
  });

  it('returns a tail page while preserving full-history registration and stats', async () => {
    const harness = makeSessionService();
    const params: ChatResumeParams = {
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      workspacePath: WORKSPACE,
      historyPage: { maxEvents: 2 },
    };
    const result = await harness.service.resumeSession(params);

    expect(result).toMatchObject({
      success: true,
      events: harness.events.slice(2),
      stats: harness.stats,
      historyPage: { olderCursor: 'h1:u2' },
    });
    expect(
      harness.subagentRegistry.registerFromHistoryEvents,
    ).toHaveBeenCalledWith(harness.events, SESSION_ID);
  });
});

describe('chat:history-page boundary', () => {
  function registeredPageHandler(readPage: jest.Mock) {
    const rpc = createMockRpcHandler();
    const attachmentGuard = { isAttached: jest.fn().mockReturnValue(false) };
    const handlers = new ChatRpcHandlers(
      createMockLogger() as unknown as Logger,
      rpc as unknown as RpcHandler,
      createMockSentryService() as unknown as SentryService,
      {} as never,
      {} as never,
      {} as never,
      { readPage } as never,
      attachmentGuard as never,
      { listPendingQuestions: jest.fn().mockReturnValue([]) } as never,
    );
    handlers.register();
    const pageHandler = (rpc.registerMethod as jest.Mock).mock.calls.find(
      ([method]) => method === 'chat:history-page',
    )?.[1] as (params: unknown) => Promise<unknown>;
    return { pageHandler, attachmentGuard };
  }

  it.each([
    [
      new HistoryCursorStaleError(),
      'HISTORY_CURSOR_STALE',
      'Session history changed',
    ],
    [
      new HistoryCursorInvalidError(),
      'INVALID_PARAMS',
      'Invalid history cursor',
    ],
  ])(
    'maps cursor failures without exposing their raw message',
    async (error, code, message) => {
      const { pageHandler } = registeredPageHandler(
        jest.fn().mockRejectedValue(error),
      );
      const rejection = pageHandler({ sessionId: SESSION_ID, cursor: 'h1:u2' });
      await expect(rejection).rejects.toEqual(expect.any(RpcUserError));
      await expect(rejection).rejects.toMatchObject({
        errorCode: code,
        message,
      });
    },
  );

  it('does not apply the session attachment guard to a page read', async () => {
    const readPage = jest.fn().mockResolvedValue({
      events: [],
      olderCursor: null,
      resumableSubagents: [],
    });
    const { pageHandler, attachmentGuard } = registeredPageHandler(readPage);
    await pageHandler({ sessionId: SESSION_ID, cursor: 'h1:u2' });
    expect(readPage).toHaveBeenCalled();
    expect(attachmentGuard.isAttached).not.toHaveBeenCalled();
  });

  it.each([
    { sessionId: SESSION_ID, cursor: 'h1:u2', maxEvents: 0 },
    { sessionId: SESSION_ID, cursor: 'h1:u2', maxEvents: 2001 },
    { sessionId: SESSION_ID, cursor: 'h1:u2', extra: true },
    { sessionId: SESSION_ID, cursor: 'x'.repeat(4097) },
  ])('rejects invalid page params %#', (params) => {
    expect(() => ChatHistoryPageParamsSchema.parse(params)).toThrow();
  });
});
