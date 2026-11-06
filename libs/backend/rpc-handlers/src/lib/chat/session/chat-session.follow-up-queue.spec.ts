import { createFakeDriverLockCoordinator } from '../../../test-utils/fake-driver-lock-coordinator';
/**
 * ChatSessionService — backend-owned follow-up queue (TASK_2026_884).
 *
 * `chat:continue` with `queueIntent: 'next-turn'` hands the follow-up to the
 * adapter at once, while a turn runs: never refused as busy, never
 * interrupting that turn. `chat:abort` withdraws every held item, FIFO,
 * BEFORE it interrupts, and returns the confirmed withdrawals.
 *
 * Uses the REAL `ChatFollowUpQueueService` over a fake adapter whose
 * `sendMessageToSession` holds a queued send the way a busy provider does.
 */

import 'reflect-metadata';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Same reason as the sibling specs: the cli-agent-runtime barrel pulls
// workspace-intelligence, whose `import.meta.url` ts-jest cannot parse.
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
  AIMessageOptions,
  ChatContinueParams,
  QueuedFollowUpSnapshot,
  QueuedFollowUpStateChange,
  SessionId,
} from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';

import { createMockModelSettings } from '../../../test-utils/mock-settings';
import { ChatFollowUpQueueService } from '../follow-up/chat-follow-up-queue.service';
import { ChatSessionService } from './chat-session.service';
import { SessionMcpStatusRegistry } from './session-mcp-status.registry';

const TEST_ROOT = mkdtempSync(join(tmpdir(), 'ptah-follow-up-queue-'));
afterAll(() => rmSync(TEST_ROOT, { recursive: true, force: true }));
mkdirSync(join(TEST_ROOT, 'project'), { recursive: true });
const WORKSPACE = `${TEST_ROOT}/project`;
const SESSION_ID = '0d4c3f0e-6a51-4c55-9a8e-2d3f8c1b7a10' as SessionId;
const TAB_ID = '5b0f6c2e-1d7a-4f3b-8e9c-a1b2c3d4e5f6';
const OTHER_TAB = '6c1a7d3f-2e8b-4a4c-9f0d-b2c3d4e5f6a7';
const ID_1 = '33333333-4444-4555-8666-777777777777';
const ID_2 = '44444444-5555-4666-8777-888888888888';

interface HarnessOptions {
  /** A turn runs: a queued send is held instead of admitted. */
  busy?: boolean;
  /** Tab of the live Claude registration of SESSION_ID, if any. */
  registeredTab?: string;
  /** Autopilot at `yolo`, so a stop-intent prompt would interrupt. */
  autopilot?: boolean;
  sendMessageToSession?: jest.Mock;
  interruptSession?: jest.Mock;
}

function makeHarness(opts: HarnessOptions = {}) {
  const logger = createMockLogger();
  const held: QueuedFollowUpSnapshot[] = [];
  let listener: ((change: QueuedFollowUpStateChange) => void) | null = null;
  const broadcastMessage = jest.fn().mockResolvedValue(undefined);
  const sendMessageToSession =
    opts.sendMessageToSession ??
    jest.fn(
      async (sessionId: SessionId, content: string, options?: AIMessageOptions) => {
        if (opts.busy && options?.queueIntent && options.clientMessageId) {
          held.push({ clientMessageId: options.clientMessageId, content });
          listener?.({
            sessionId,
            clientMessageId: options.clientMessageId,
            state: 'queued',
          });
        } else if (options?.queueIntent && options.clientMessageId) {
          listener?.({ sessionId, clientMessageId: options.clientMessageId, state: 'delivered' });
        }
      },
    );
  const withdrawQueuedFollowUp = jest.fn(
    async (_sessionId: SessionId, clientMessageId: string) => {
      const index = held.findIndex((i) => i.clientMessageId === clientMessageId);
      if (index < 0) return false;
      held.splice(index, 1);
      return true;
    },
  );
  const interruptSession =
    opts.interruptSession ?? jest.fn().mockResolvedValue(undefined);
  const interruptCurrentTurn = jest.fn().mockResolvedValue(true);
  const adapter = {
    resumeSession: jest.fn(),
    isSessionActive: jest.fn().mockReturnValue(true),
    sendMessageToSession,
    interruptSession,
    interruptCurrentTurn,
    endSession: jest.fn().mockResolvedValue(undefined),
    onQueuedFollowUpState: (next: (change: QueuedFollowUpStateChange) => void) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
    listQueuedFollowUps: () => held,
    withdrawQueuedFollowUp,
  };
  const followUpQueue = new ChatFollowUpQueueService(
    logger as never,
    { sendMessage: jest.fn(), broadcastMessage },
    adapter as never,
    {
      find: (id: string) =>
        opts.registeredTab !== undefined && id === SESSION_ID
          ? { tabId: opts.registeredTab, realSessionId: SESSION_ID }
          : undefined,
    } as never,
  );
  const driverLock = createFakeDriverLockCoordinator();

  const service = new ChatSessionService(
    logger as never,
    { broadcastMessage: jest.fn().mockResolvedValue(undefined) } as never,
    {
      get: jest.fn(),
      getWithDefault: jest.fn((key: string, fallback: unknown) => {
        if (!opts.autopilot) return fallback;
        if (key === 'autopilot.enabled') return true;
        if (key === 'autopilot.permissionLevel') return 'yolo';
        return fallback;
      }),
    } as never,
    adapter as never,
    { captureException: jest.fn() } as never,
    { getPort: jest.fn().mockReturnValue(0) } as never,
    { resolveSessionFolder: jest.fn().mockResolvedValue(WORKSPACE) } as never,
    {
      hydrateResumeState: jest.fn().mockReturnValue(0),
      isResumeStateHydrated: jest.fn().mockReturnValue(true),
      getResumableBySession: jest.fn().mockReturnValue([]),
      getInterruptedBySession: jest.fn().mockReturnValue([]),
    } as never,
    { intercept: jest.fn().mockReturnValue({ action: 'passthrough' }) } as never,
    {
      get: jest.fn().mockResolvedValue(null),
      saveResumeState: jest.fn().mockResolvedValue(undefined),
    } as never,
    createMockWorkspaceProvider({ folders: [WORKSPACE] }) as never,
    {
      type: 'cli',
      extensionPath: '/tmp/ptah',
      globalStoragePath: '/tmp/storage',
      workspaceStoragePath: '/tmp/workspace',
    } as never,
    { isMcpServerRunning: jest.fn().mockReturnValue(false) } as never,
    {
      handleContinue: jest.fn().mockResolvedValue({ error: '__NOT_PTAH_CLI__' }),
      handleAbort: jest.fn().mockResolvedValue({ error: '__NOT_PTAH_CLI__' }),
    } as never,
    {
      streamEventsToWebview: jest.fn(),
      // A live broadcast loop: the session is mid-turn or idle-but-attached.
      isStreaming: jest.fn().mockReturnValue(true),
    } as never,
    {
      injectInterruptedAgentsContext: jest
        .fn()
        .mockImplementation(async (prompt: string) => ({
          prompt,
          injected: false,
          commit: async () => undefined,
          release: () => undefined,
        })),
    } as never,
    { routeFollowUpSlashCommand: jest.fn().mockResolvedValue(null) } as never,
    createMockModelSettings() as never,
    { getProviderKey: jest.fn().mockResolvedValue(undefined) } as never,
    {
      resolveStoredModel: jest.fn((_p: string, model: string) => model || 'default'),
      resolveProviderProfileForWorkspace: jest.fn().mockResolvedValue(undefined),
    } as never,
    { resolveSessionFields: jest.fn().mockResolvedValue({}) } as never,
    new SessionMcpStatusRegistry(),
    { register: jest.fn().mockReturnValue(() => undefined) } as never,
    { register: jest.fn().mockReturnValue(() => undefined) } as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    driverLock as never,
    undefined,
    followUpQueue,
  );
  const bind = jest.spyOn(followUpQueue, 'bind');
  const withdrawAll = jest.spyOn(followUpQueue, 'withdrawAllForStop');
  return {
    service,
    followUpQueue,
    held,
    broadcastMessage,
    sendMessageToSession,
    interruptSession,
    interruptCurrentTurn,
    withdrawQueuedFollowUp,
    driverLock,
    bind,
    withdrawAll,
  };
}

function queued(prompt: string, clientMessageId = ID_1): ChatContinueParams {
  return {
    tabId: TAB_ID,
    sessionId: SESSION_ID,
    prompt,
    clientMessageId,
    queueIntent: 'next-turn',
  };
}

describe('ChatSessionService — backend-owned follow-up queue', () => {
  it('refuses a follow-up whose preparation crosses Stop', async () => {
    const h = makeHarness({ busy: true });
    let releaseDrive: ((value: string) => void) | undefined;
    jest.spyOn(h.driverLock, 'beginDrive').mockImplementationOnce(
      () => new Promise<string>((resolve) => { releaseDrive = resolve; }),
    );
    const send = h.service.continueSession(queued('late'));
    await Promise.resolve();
    await h.service.abortSession({ sessionId: SESSION_ID });
    releaseDrive?.('drive');
    await expect(send).resolves.toMatchObject({ success: false, cancelled: true });
    expect(h.sendMessageToSession).not.toHaveBeenCalled();
  });
  it('accepts a queued follow-up while a turn runs and reports it held', async () => {
    const h = makeHarness({ busy: true });

    await expect(h.service.continueSession(queued('then add tests'))).resolves.toEqual({
      success: true,
      sessionId: SESSION_ID,
      queueState: 'queued',
      queuedMessageId: ID_1,
    });

    expect(h.sendMessageToSession).toHaveBeenCalledWith(
      SESSION_ID,
      'then add tests',
      expect.objectContaining({ clientMessageId: ID_1, queueIntent: 'next-turn' }),
    );
    // Bound before the send, so the adapter's `queued` push found its tab.
    expect(h.bind.mock.invocationCallOrder[0]).toBeLessThan(
      h.sendMessageToSession.mock.invocationCallOrder[0],
    );
    expect(h.broadcastMessage).toHaveBeenCalledWith('chat:queued-message-state', {
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      clientMessageId: ID_1,
      state: 'queued',
    });
    expect(h.interruptSession).not.toHaveBeenCalled();
    expect(h.interruptCurrentTurn).not.toHaveBeenCalled();
  });

  it('never interrupts the running turn for a stop-like queued text', async () => {
    const h = makeHarness({ busy: true, autopilot: true });

    await expect(h.service.continueSession(queued('stop'))).resolves.toMatchObject({
      success: true,
      queueState: 'queued',
    });
    expect(h.interruptCurrentTurn).not.toHaveBeenCalled();
  });

  it('reports admitted when the idle session started the turn at once', async () => {
    const h = makeHarness({ busy: false });

    await expect(h.service.continueSession(queued('next'))).resolves.toEqual({
      success: true,
      sessionId: SESSION_ID,
      enqueued: true,
      queueState: 'admitted',
    });
    expect(h.followUpQueue.list(SESSION_ID, TAB_ID)).toEqual([]);
  });

  it('keeps the pre-queue contract for a send without queueIntent', async () => {
    const h = makeHarness({ busy: true });
    await expect(
      h.service.continueSession({ tabId: TAB_ID, sessionId: SESSION_ID, prompt: 'more' }),
    ).resolves.toEqual({ success: true, sessionId: SESSION_ID, enqueued: true });
    expect(h.sendMessageToSession.mock.calls[0][2]).not.toHaveProperty('queueIntent');
  });

  it('refuses a session registered to another tab without sending', async () => {
    const h = makeHarness({ busy: true, registeredTab: OTHER_TAB });

    await expect(h.service.continueSession(queued('next'))).resolves.toMatchObject({
      success: false,
      errorCode: 'SESSION_NOT_FOUND',
    });
    expect(h.sendMessageToSession).not.toHaveBeenCalled();
    expect(h.driverLock.beginDrive).not.toHaveBeenCalled();
  });

  it('refuses to queue a slash command', async () => {
    const h = makeHarness({ busy: true });

    await expect(h.service.continueSession(queued('/compact'))).resolves.toMatchObject({
      success: false,
      errorCode: 'INVALID_PARAMS',
    });
    expect(h.sendMessageToSession).not.toHaveBeenCalled();
  });

  it('drops the binding when the send fails', async () => {
    const h = makeHarness({
      busy: true,
      sendMessageToSession: jest.fn().mockRejectedValue(new Error('closed')),
    });

    await expect(h.service.continueSession(queued('next'))).resolves.toMatchObject({
      success: false,
    });
    // An unbound id is unowned again: another tab may now queue on the session.
    expect(() => h.followUpQueue.assertTabOwnsSession(SESSION_ID, OTHER_TAB)).not.toThrow();
  });

  it('Stop withdraws every held item FIFO before it interrupts', async () => {
    const h = makeHarness({ busy: true });
    await h.service.continueSession(queued('first', ID_1));
    await h.service.continueSession(queued('second', ID_2));

    await expect(h.service.abortSession({ sessionId: SESSION_ID })).resolves.toEqual({
      success: true,
      withdrawn: [
        { clientMessageId: ID_1, content: 'first', tabId: TAB_ID },
        { clientMessageId: ID_2, content: 'second', tabId: TAB_ID },
      ],
    });
    expect(h.withdrawQueuedFollowUp.mock.calls.map((call) => call[1])).toEqual([ID_1, ID_2]);
    const lastWithdraw = Math.max(...h.withdrawQueuedFollowUp.mock.invocationCallOrder);
    expect(lastWithdraw).toBeLessThan(h.interruptSession.mock.invocationCallOrder[0]);
    expect(h.held).toEqual([]);
  });

  it('Stop leaves out an item a turn already claimed', async () => {
    const h = makeHarness({ busy: true });
    await h.service.continueSession(queued('first', ID_1));
    await h.service.continueSession(queued('second', ID_2));
    h.withdrawQueuedFollowUp.mockImplementationOnce(async () => false);

    await expect(h.service.abortSession({ sessionId: SESSION_ID })).resolves.toEqual({
      success: true,
      withdrawn: [{ clientMessageId: ID_2, content: 'second', tabId: TAB_ID }],
    });
  });

  it('a failed interrupt still returns the withdrawn text', async () => {
    const h = makeHarness({
      busy: true,
      interruptSession: jest.fn().mockRejectedValue(new Error('interrupt failed')),
    });
    await h.service.continueSession(queued('first', ID_1));

    await expect(h.service.abortSession({ sessionId: SESSION_ID })).resolves.toMatchObject({
      success: false,
      withdrawn: [{ clientMessageId: ID_1, content: 'first' }],
    });
  });

  it('Stop with nothing held keeps the pre-queue reply', async () => {
    const h = makeHarness({ busy: true });
    await expect(h.service.abortSession({ sessionId: SESSION_ID })).resolves.toEqual({
      success: true,
    });
    expect(h.withdrawAll).toHaveBeenCalledWith(SESSION_ID);
  });
});
